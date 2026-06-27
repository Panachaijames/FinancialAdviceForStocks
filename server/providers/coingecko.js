/**
 * CoinGecko provider (free, no API key) for crypto quotes and candles.
 *
 * Used as the PRIMARY source for crypto so the app does not depend on Yahoo for
 * crypto data (Binance WS handles realtime ticks separately; Yahoo is only a
 * fallback). All functions are defensive: they never throw and return [] / null
 * on any failure so callers can fall back gracefully.
 */

const BASE = 'https://api.coingecko.com/api/v3';

// Static map of common crypto tickers -> CoinGecko coin ids (avoids a lookup call).
const ID_MAP = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  ADA: 'cardano',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  BNB: 'binancecoin',
  LTC: 'litecoin',
  DOT: 'polkadot',
  AVAX: 'avalanche-2',
  MATIC: 'matic-network',
  LINK: 'chainlink',
  UNI: 'uniswap',
  ATOM: 'cosmos',
  XLM: 'stellar',
  TRX: 'tron',
  NEAR: 'near',
  APT: 'aptos',
  ARB: 'arbitrum',
  OP: 'optimism',
  SHIB: 'shiba-inu',
  PEPE: 'pepe',
  FIL: 'filecoin',
  ETC: 'ethereum-classic',
  BCH: 'bitcoin-cash',
  ALGO: 'algorand',
  VET: 'vechain',
  ICP: 'internet-computer',
  HBAR: 'hedera-hashgraph',
  SUI: 'sui',
  TON: 'the-open-network',
};

const idCache = new Map(); // ticker -> id (resolved via /search)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 'BTC-USD' -> 'BTC' */
function baseTicker(symbol) {
  const s = String(symbol || '').trim().toUpperCase();
  return s.endsWith('-USD') ? s.slice(0, -4) : s;
}

async function fetchJson(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.status === 429) {
        await sleep(700 * (i + 1));
        continue;
      }
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(400 * (i + 1));
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('CoinGecko request failed');
}

/**
 * Resolve a crypto symbol ('BTC-USD') to a CoinGecko coin id ('bitcoin').
 * @param {string} symbol
 * @returns {Promise<string|null>}
 */
export async function resolveId(symbol) {
  const ticker = baseTicker(symbol);
  if (!ticker) return null;
  if (ID_MAP[ticker]) return ID_MAP[ticker];
  if (idCache.has(ticker)) return idCache.get(ticker);
  try {
    const data = await fetchJson(`${BASE}/search?query=${encodeURIComponent(ticker)}`);
    const coins = (data && data.coins) || [];
    // Prefer an exact ticker match, else the first (CoinGecko ranks by market cap).
    const exact = coins.find((c) => String(c.symbol || '').toUpperCase() === ticker);
    const id = (exact && exact.id) || (coins[0] && coins[0].id) || null;
    idCache.set(ticker, id);
    return id;
  } catch {
    return null;
  }
}

function marketToQuote(m, symbol) {
  if (!m) return null;
  const price = Number(m.current_price);
  if (!Number.isFinite(price)) return null;
  const change = Number(m.price_change_24h);
  const changePct = Number(m.price_change_percentage_24h);
  const prevClose = Number.isFinite(change) ? price - change : price;
  return {
    symbol,
    type: 'crypto',
    name: m.name || symbol,
    currency: 'USD',
    price,
    prevClose,
    change: Number.isFinite(change) ? change : 0,
    changePct: Number.isFinite(changePct) ? changePct : 0,
    dayHigh: Number(m.high_24h) || 0,
    dayLow: Number(m.low_24h) || 0,
    open: prevClose,
    volume: Number(m.total_volume) || 0,
    marketState: 'REGULAR', // crypto trades 24/7
    ts: m.last_updated ? new Date(m.last_updated).getTime() : Date.now(),
  };
}

/**
 * Get quotes for crypto symbols ('BTC-USD', ...).
 * @param {string[]} symbols
 * @returns {Promise<import('../../types.js').Quote[]>}
 */
export async function getCryptoQuotes(symbols) {
  const list = (symbols || []).filter(Boolean);
  if (list.length === 0) return [];
  try {
    const idToSymbol = new Map();
    const ids = [];
    for (const sym of list) {
      const id = await resolveId(sym);
      if (id) {
        idToSymbol.set(id, sym);
        ids.push(id);
      }
    }
    if (ids.length === 0) return [];
    const url = `${BASE}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(
      ids.join(',')
    )}&price_change_percentage=24h`;
    const rows = await fetchJson(url);
    const out = [];
    for (const m of rows || []) {
      const sym = idToSymbol.get(m.id) || `${String(m.symbol || '').toUpperCase()}-USD`;
      const q = marketToQuote(m, sym);
      if (q) out.push(q);
    }
    return out;
  } catch {
    return [];
  }
}

const RANGE_TO_DAYS = {
  '1d': 1,
  '5d': 7,
  '1mo': 30,
  '3mo': 90,
  '6mo': 180,
  '1y': 365,
  '2y': 'max',
  '5y': 'max',
  max: 'max',
};

/**
 * Get OHLC candles for a crypto symbol. CoinGecko's /ohlc endpoint returns
 * [ms, open, high, low, close]; it does not include volume, so volume is 0.
 * @param {string} symbol
 * @param {string} range
 * @returns {Promise<import('../../types.js').Candle[]>}
 */
export async function getCryptoCandles(symbol, range = '6mo') {
  const id = await resolveId(symbol);
  if (!id) return [];
  const days = RANGE_TO_DAYS[range] || 30;
  try {
    const url = `${BASE}/coins/${encodeURIComponent(id)}/ohlc?vs_currency=usd&days=${days}`;
    const rows = await fetchJson(url);
    if (!Array.isArray(rows)) return [];
    const out = [];
    let prev = -1;
    for (const r of rows) {
      if (!Array.isArray(r) || r.length < 5) continue;
      const time = Math.floor(Number(r[0]) / 1000);
      const close = Number(r[4]);
      if (!Number.isFinite(time) || !Number.isFinite(close)) continue;
      const candle = {
        time,
        open: Number(r[1]) || close,
        high: Number(r[2]) || close,
        low: Number(r[3]) || close,
        close,
        volume: 0,
      };
      if (time === prev) out[out.length - 1] = candle;
      else {
        out.push(candle);
        prev = time;
      }
    }
    out.sort((a, b) => a.time - b.time);
    return out;
  } catch {
    return [];
  }
}

export default { resolveId, getCryptoQuotes, getCryptoCandles };
