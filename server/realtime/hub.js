import { WebSocketServer } from 'ws';
import { config } from '../config.js';
import { isCrypto } from '../util/assetType.js';
import { getQuotes } from '../providers/yahoo.js';
import { getFx } from '../providers/fx.js';
import { attachOvernight } from '../providers/pyth.js';
import createBinanceFeed from '../providers/binanceWs.js';

/**
 * Attach the realtime WebSocket hub to an existing HTTP server.
 *
 * WS PROTOCOL (path '/ws'):
 *   client->server: { type:'subscribe', symbols:[...] } | { type:'unsubscribe', symbols:[...] }
 *   server->client: { type:'hello' } | { type:'quote', data:Quote } | { type:'fx', data:Fx }
 *
 * The hub ref-counts subscribed symbols across all connected clients. Crypto symbols are streamed
 * from a single Binance upstream WS; non-crypto symbols are polled from Yahoo every POLL_MS and
 * broadcast only to clients subscribed to that symbol. FX (USDTHB) is polled every FX_POLL_MS and
 * broadcast to all clients.
 *
 * @param {import('http').Server} httpServer
 */
export function attach(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  /** @type {Map<import('ws').WebSocket, Set<string>>} per-client subscribed symbols */
  const clientSymbols = new Map();

  /** @type {Map<string, number>} global symbol -> refcount */
  const refCounts = new Map();

  /**
   * Last-known metadata per crypto symbol so Binance ticks can be enriched into full Quotes.
   * @type {Map<string, { name?:string, currency?:string, prevClose?:number }>}
   */
  const cryptoMeta = new Map();

  /** Most recent FX value to send immediately to new subscribers if available. */
  let lastFx = null;

  // ---- Binance feed (crypto) ------------------------------------------------
  const binanceFeed = createBinanceFeed({
    onTick(yahooSymbol, tick) {
      try {
        const meta = cryptoMeta.get(yahooSymbol) || {};
        const price = num(tick.price);
        const open = num(tick.open);
        const prevClose =
          meta.prevClose != null && Number.isFinite(meta.prevClose)
            ? meta.prevClose
            : open != null
              ? open
              : null;

        let change = null;
        let changePct = null;
        if (price != null && prevClose != null) {
          change = price - prevClose;
          changePct = prevClose !== 0 ? (change / prevClose) * 100 : null;
        }
        if (changePct == null && tick.changePct != null && Number.isFinite(tick.changePct)) {
          changePct = tick.changePct;
        }

        /** @type {Quote} */
        const quote = {
          symbol: yahooSymbol,
          type: 'crypto',
          name: meta.name || yahooSymbol,
          currency: meta.currency || 'USD',
          price,
          prevClose,
          change,
          changePct,
          dayHigh: num(tick.dayHigh),
          dayLow: num(tick.dayLow),
          open,
          volume: num(tick.volume),
          marketState: 'REGULAR',
          ts: Date.now(),
        };
        broadcastQuote(quote);
      } catch {
        // Never let a single malformed tick break the feed.
      }
    },
  });

  // ---- Helpers --------------------------------------------------------------

  function num(v) {
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  }

  function safeSend(ws, obj) {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      // ignore send failures
    }
  }

  function cryptoSubscribedSet() {
    const set = new Set();
    for (const sym of refCounts.keys()) {
      if (isCrypto(sym)) set.add(sym);
    }
    return set;
  }

  function nonCryptoSubscribed() {
    const arr = [];
    for (const sym of refCounts.keys()) {
      if (!isCrypto(sym)) arr.push(sym);
    }
    return arr;
  }

  function recomputeCryptoFeed() {
    try {
      binanceFeed.setSymbols(cryptoSubscribedSet());
    } catch {
      // ignore
    }
  }

  function incRef(symbol) {
    const prev = refCounts.get(symbol) || 0;
    refCounts.set(symbol, prev + 1);
    return prev === 0; // became newly active
  }

  function decRef(symbol) {
    const prev = refCounts.get(symbol) || 0;
    if (prev <= 1) {
      refCounts.delete(symbol);
      return true; // became inactive
    }
    refCounts.set(symbol, prev - 1);
    return false;
  }

  function addSubscriptions(ws, symbols) {
    const own = clientSymbols.get(ws);
    if (!own) return;
    let cryptoChanged = false;
    for (const raw of symbols) {
      const symbol = String(raw || '').trim();
      if (!symbol) continue;
      if (own.has(symbol)) continue; // already subscribed by this client
      own.add(symbol);
      const newlyActive = incRef(symbol);
      if (newlyActive && isCrypto(symbol)) cryptoChanged = true;
    }
    if (cryptoChanged) recomputeCryptoFeed();
  }

  function removeSubscriptions(ws, symbols) {
    const own = clientSymbols.get(ws);
    if (!own) return;
    let cryptoChanged = false;
    for (const raw of symbols) {
      const symbol = String(raw || '').trim();
      if (!symbol) continue;
      if (!own.has(symbol)) continue;
      own.delete(symbol);
      const nowInactive = decRef(symbol);
      if (nowInactive && isCrypto(symbol)) {
        cryptoChanged = true;
        cryptoMeta.delete(symbol);
      }
    }
    if (cryptoChanged) recomputeCryptoFeed();
  }

  /** Broadcast a Quote only to clients subscribed to that symbol. */
  function broadcastQuote(quote) {
    if (!quote || !quote.symbol) return;
    const msg = JSON.stringify({ type: 'quote', data: quote });
    for (const [ws, own] of clientSymbols) {
      if (own.has(quote.symbol) && ws.readyState === ws.OPEN) {
        try {
          ws.send(msg);
        } catch {
          // ignore
        }
      }
    }
  }

  /** Broadcast FX to every connected client. */
  function broadcastFx(fx) {
    if (!fx) return;
    const msg = JSON.stringify({ type: 'fx', data: fx });
    for (const ws of clientSymbols.keys()) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(msg);
        } catch {
          // ignore
        }
      }
    }
  }

  // ---- Polling loops --------------------------------------------------------

  const pollMs = config?.POLL_MS || 5000;
  const fxPollMs = config?.FX_POLL_MS || 15000;

  let quotePollRunning = false;
  const quotePoll = setInterval(async () => {
    if (quotePollRunning) return; // avoid overlapping runs
    const symbols = nonCryptoSubscribed();
    if (symbols.length === 0) return;
    quotePollRunning = true;
    try {
      const quotes = await getQuotes(symbols);
      if (Array.isArray(quotes)) {
        // Enrich US equities with Pyth overnight prices during overnight hours.
        await attachOvernight(quotes);
        for (const q of quotes) {
          if (q && q.symbol) broadcastQuote(q);
        }
      }
    } catch {
      // ignore poll errors; try again next tick
    } finally {
      quotePollRunning = false;
    }
  }, pollMs);

  let fxPollRunning = false;
  async function pollFxOnce() {
    if (fxPollRunning) return;
    fxPollRunning = true;
    try {
      const fx = await getFx('USD', 'THB');
      if (fx) {
        lastFx = fx;
        broadcastFx(fx);
      }
    } catch {
      // ignore
    } finally {
      fxPollRunning = false;
    }
  }
  const fxPoll = setInterval(pollFxOnce, fxPollMs);
  // Prime FX shortly after startup so clients get a value quickly.
  pollFxOnce();

  // ---- Connection handling --------------------------------------------------

  wss.on('connection', (ws) => {
    clientSymbols.set(ws, new Set());
    safeSend(ws, { type: 'hello' });
    if (lastFx) safeSend(ws, { type: 'fx', data: lastFx });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // ignore malformed JSON
      }
      if (!msg || typeof msg !== 'object') return;
      const symbols = Array.isArray(msg.symbols) ? msg.symbols : [];
      if (msg.type === 'subscribe') {
        addSubscriptions(ws, symbols);
      } else if (msg.type === 'unsubscribe') {
        removeSubscriptions(ws, symbols);
      }
    });

    ws.on('close', () => {
      const own = clientSymbols.get(ws);
      if (own) {
        let cryptoChanged = false;
        for (const symbol of own) {
          const nowInactive = decRef(symbol);
          if (nowInactive && isCrypto(symbol)) {
            cryptoChanged = true;
            cryptoMeta.delete(symbol);
          }
        }
        if (cryptoChanged) recomputeCryptoFeed();
      }
      clientSymbols.delete(ws);
    });

    ws.on('error', () => {
      // Swallow socket errors; 'close' will follow and clean up.
    });
  });

  wss.on('close', () => {
    clearInterval(quotePoll);
    clearInterval(fxPoll);
    try {
      binanceFeed.close();
    } catch {
      // ignore
    }
  });

  return wss;
}

export default attach;
