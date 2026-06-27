import { WebSocket } from 'ws';
import { toBinanceSymbol, fromBinanceSymbol } from '../util/assetType.js';

const BINANCE_BASE = 'wss://stream.binance.com:9443/stream';
const MAX_BACKOFF_MS = 15000;
const BASE_BACKOFF_MS = 1000;

/**
 * Create a managed Binance combined-stream feed for crypto miniTickers.
 *
 * @param {{ onTick: (yahooSymbol:string, tick:{ price:number, changePct:number, dayHigh:number, dayLow:number, open:number, volume:number }) => void }} opts
 * @returns {{ setSymbols: (symbols:Iterable<string>) => void, close: () => void }}
 */
export default function createBinanceFeed({ onTick } = {}) {
  /** @type {Set<string>} Yahoo crypto symbols, e.g. 'BTC-USD' */
  let yahooSymbols = new Set();
  /** @type {WebSocket|null} */
  let ws = null;
  let backoff = BASE_BACKOFF_MS;
  let reconnectTimer = null;
  let closed = false;

  function streamsParam() {
    const streams = [];
    for (const sym of yahooSymbols) {
      const b = toBinanceSymbol(sym);
      if (b) streams.push(`${b}@miniTicker`);
    }
    return streams;
  }

  function teardownSocket() {
    if (ws) {
      try {
        ws.removeAllListeners();
      } catch {
        /* ignore */
      }
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      ws = null;
    }
  }

  function scheduleReconnect() {
    if (closed) return;
    if (reconnectTimer) return;
    const delay = Math.min(backoff, MAX_BACKOFF_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      connect();
    }, delay);
  }

  function connect() {
    if (closed) return;

    teardownSocket();

    const streams = streamsParam();
    // Nothing to subscribe to — stay disconnected until symbols arrive.
    if (streams.length === 0) return;

    const url = `${BINANCE_BASE}?streams=${streams.join('/')}`;

    let socket;
    try {
      socket = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.on('open', () => {
      backoff = BASE_BACKOFF_MS;
    });

    socket.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString());
        const payload = parsed && parsed.data ? parsed.data : parsed;
        handleMiniTicker(payload);
      } catch {
        /* ignore malformed frame */
      }
    });

    socket.on('error', () => {
      // 'close' will follow and trigger reconnect.
    });

    socket.on('close', () => {
      if (ws === socket) ws = null;
      scheduleReconnect();
    });
  }

  function handleMiniTicker(d) {
    if (!d || typeof d !== 'object') return;
    // miniTicker fields: s=symbol, c=close, o=open, h=high, l=low, v=base volume
    const binSym = d.s;
    if (!binSym) return;
    const yahooSym = fromBinanceSymbol(binSym);
    if (!yahooSym || !yahooSymbols.has(yahooSym)) return;

    const price = toNum(d.c);
    const open = toNum(d.o);
    const high = toNum(d.h);
    const low = toNum(d.l);
    const volume = toNum(d.v);
    if (price == null) return;

    let changePct = 0;
    if (open != null && open !== 0) {
      changePct = ((price - open) / open) * 100;
    }

    if (typeof onTick === 'function') {
      onTick(yahooSym, {
        price,
        changePct,
        dayHigh: high ?? price,
        dayLow: low ?? price,
        open: open ?? price,
        volume: volume ?? 0,
      });
    }
  }

  function setSymbols(symbols) {
    const next = new Set();
    if (symbols) {
      for (const s of symbols) {
        if (toBinanceSymbol(s)) next.add(s.toUpperCase());
      }
    }

    // Detect change.
    let changed = next.size !== yahooSymbols.size;
    if (!changed) {
      for (const s of next) {
        if (!yahooSymbols.has(s)) {
          changed = true;
          break;
        }
      }
    }

    yahooSymbols = next;
    if (!changed) return;

    // Rebuild the connection with the new combined stream set.
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    backoff = BASE_BACKOFF_MS;
    connect();
  }

  function close() {
    closed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    teardownSocket();
    yahooSymbols = new Set();
  }

  return { setSymbols, close };
}

function toNum(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
