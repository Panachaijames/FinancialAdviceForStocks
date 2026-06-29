/**
 * Twelve Data provider (keyed). Used as a FALLBACK for stock/gold quotes and
 * candles when Yahoo is unavailable/throttled, and is also able to serve FX.
 *
 * Free plan limits (~8 credits/min, 800/day) — that's why this is a fallback,
 * not the high-frequency primary. Thai SET stocks require a paid plan (free
 * returns 404) so those gracefully fall through to Yahoo.
 *
 * All functions are defensive: they never throw and return [] / null on error.
 */
import { config } from '../config.js';
import { classify } from '../util/assetType.js';
import { createLimiter } from '../util/limit.js';

const BASE = 'https://api.twelvedata.com';
const KEY = config.keys.twelveData;

// Twelve Data free tier is quota-limited (~8 req/min). Cap concurrency so a
// burst of fallback lookups (Yahoo misses on app reopen) doesn't fire them all
// at once and get rate-limited. All TD requests flow through fetchJson.
const tdLimit = createLimiter(2);

export function hasKey() {
  return !!KEY;
}

/**
 * Convert a canonical (Yahoo-style) symbol to a Twelve Data symbol + optional exchange.
 * @param {string} symbol
 * @returns {{ symbol: string, exchange?: string }}
 */
function toTd(symbol) {
  const up = String(symbol || '').trim().toUpperCase();
  if (!up) return { symbol: '' };
  if (up === 'GC=F' || up === 'XAUUSD=X' || up.includes('XAU')) return { symbol: 'XAU/USD' };
  if (up.endsWith('-USD')) return { symbol: `${up.slice(0, -4)}/USD` }; // crypto -> BTC/USD
  if (up.endsWith('.BK')) return { symbol: up.slice(0, -3), exchange: 'SET' }; // Thai (Pro plan)
  if (up.endsWith('=X') && up.length === 8) return { symbol: `${up.slice(0, 3)}/${up.slice(3, 6)}` };
  return { symbol: up };
}

async function fetchJson(url, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await tdLimit(() => fetch(url, { headers: { accept: 'application/json' } }));
      const data = await res.json();
      return data;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('Twelve Data request failed');
}

const f = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

function mapQuote(d, originalSymbol) {
  if (!d || d.status === 'error' || d.code) return null;
  const price = f(d.close);
  if (price == null) return null;
  const prevClose = f(d.previous_close);
  const change = f(d.change);
  const changePct = f(d.percent_change);
  const type = classify(originalSymbol);
  return {
    symbol: originalSymbol,
    type,
    name: d.name || originalSymbol,
    currency: d.currency || (type === 'th_stock' ? 'THB' : 'USD'),
    price,
    prevClose: prevClose == null ? price : prevClose,
    change: change == null ? 0 : change,
    changePct: changePct == null ? 0 : changePct,
    dayHigh: f(d.high) ?? 0,
    dayLow: f(d.low) ?? 0,
    open: f(d.open) ?? 0,
    volume: f(d.volume) ?? 0,
    marketState: d.is_market_open ? 'REGULAR' : 'CLOSED',
    ts: d.timestamp ? Number(d.timestamp) * 1000 : Date.now(),
  };
}

/**
 * Get quotes for the given canonical symbols.
 * @param {string[]} symbols
 * @returns {Promise<import('../../types.js').Quote[]>}
 */
export async function getQuotes(symbols) {
  if (!KEY) return [];
  const list = (symbols || []).filter(Boolean);
  if (list.length === 0) return [];
  const results = await Promise.all(
    list.map(async (sym) => {
      try {
        const { symbol, exchange } = toTd(sym);
        if (!symbol) return null;
        const params = new URLSearchParams({ symbol, apikey: KEY });
        if (exchange) params.set('exchange', exchange);
        const data = await fetchJson(`${BASE}/quote?${params.toString()}`);
        return mapQuote(data, sym);
      } catch {
        return null;
      }
    })
  );
  return results.filter(Boolean);
}

const RANGE_TO_TS = {
  '1d': { interval: '5min', outputsize: 120 },
  '5d': { interval: '30min', outputsize: 170 },
  '1mo': { interval: '1day', outputsize: 23 },
  '3mo': { interval: '1day', outputsize: 66 },
  '6mo': { interval: '1day', outputsize: 130 },
  '1y': { interval: '1day', outputsize: 260 },
  '2y': { interval: '1week', outputsize: 110 },
  '5y': { interval: '1week', outputsize: 260 },
  max: { interval: '1month', outputsize: 300 },
};

/**
 * Get OHLCV candles for a symbol.
 * @param {string} symbol
 * @param {string} range
 * @returns {Promise<import('../../types.js').Candle[]>}
 */
export async function getCandles(symbol, range = '6mo') {
  if (!KEY || !symbol) return [];
  const { symbol: tdSym, exchange } = toTd(symbol);
  if (!tdSym) return [];
  const { interval, outputsize } = RANGE_TO_TS[range] || RANGE_TO_TS['6mo'];
  try {
    const params = new URLSearchParams({
      symbol: tdSym,
      interval,
      outputsize: String(outputsize),
      order: 'ASC',
      apikey: KEY,
    });
    if (exchange) params.set('exchange', exchange);
    const data = await fetchJson(`${BASE}/time_series?${params.toString()}`);
    if (!data || data.status === 'error' || !Array.isArray(data.values)) return [];
    const out = [];
    let prev = -1;
    for (const v of data.values) {
      const close = f(v.close);
      const dt = String(v.datetime || '').replace(' ', 'T');
      const time = Math.floor(new Date(dt.length <= 10 ? `${dt}T00:00:00Z` : dt).getTime() / 1000);
      if (close == null || !Number.isFinite(time)) continue;
      const candle = {
        time,
        open: f(v.open) ?? close,
        high: f(v.high) ?? close,
        low: f(v.low) ?? close,
        close,
        volume: f(v.volume) ?? 0,
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

/** Convert a Twelve Data symbol back to our canonical (Yahoo-style) symbol. */
function fromTd(tdSymbol) {
  const s = String(tdSymbol || '').trim().toUpperCase();
  if (!s) return '';
  if (s.includes('/')) {
    const [base, quote] = s.split('/');
    if (quote === 'USD') {
      if (base === 'XAU') return 'GC=F';
      return `${base}-USD`; // crypto pair
    }
    return s;
  }
  return s; // plain US ticker
}

function refineSearchType(symbol, instrumentType) {
  const base = classify(symbol);
  if (base !== 'us_stock') return base; // crypto/gold/etc already resolved by symbol
  const t = String(instrumentType || '').toLowerCase();
  if (t.includes('etf') || t.includes('fund')) return 'etf';
  if (t.includes('index')) return 'index';
  return 'us_stock';
}

const US_EXCH = new Set(['XNAS', 'XNYS', 'XNGS', 'ARCA', 'BATS', 'AMEX', 'NASDAQ', 'NYSE', 'OTC']);

// Allowed instrument types — keep real equities/ETFs/indices, drop the noise
// (warrants, bonds, rights, structured notes, CEDEARs, etc.).
function typeAllowed(instrumentType) {
  const s = String(instrumentType || '').toLowerCase();
  if (!s) return true; // crypto/forex rows often have no type
  return (
    s.includes('common stock') ||
    s === 'stock' ||
    s.includes('etf') ||
    s.includes('fund') ||
    s.includes('index') ||
    s.includes('depositary') ||
    s.includes('reit') ||
    s.includes('digital currency')
  );
}

/**
 * Symbol search fallback (Twelve Data /symbol_search). Yahoo blocks cloud IPs,
 * so this keeps search working on hosts like Render. TD returns the same ticker
 * across dozens of exchanges plus warrants/CEDEARs/etc., so we filter to
 * US-listed equities/ETFs (+ crypto/gold pairs) and rank by relevance.
 * @param {string} q
 * @returns {Promise<import('../../types.js').SearchResult[]>}
 */
export async function searchSymbols(q) {
  if (!KEY) return [];
  const query = String(q || '').trim();
  if (!query) return [];
  const Q = query.toUpperCase();
  try {
    const params = new URLSearchParams({ symbol: query, outputsize: '50', apikey: KEY });
    const data = await fetchJson(`${BASE}/symbol_search?${params.toString()}`);
    const rows = data && Array.isArray(data.data) ? data.data : [];
    const byCanonical = new Map();
    for (const d of rows) {
      const canonical = fromTd(d.symbol);
      if (!canonical) continue;
      const cls = classify(canonical);
      const type = refineSearchType(canonical, d.instrument_type);
      const isUS =
        d.currency === 'USD' ||
        /united states/i.test(d.country || '') ||
        US_EXCH.has(String(d.mic_code || d.exchange || '').toUpperCase());
      // Keep crypto/gold pairs, or US-listed equities/ETFs/indices of a sane type.
      const keep =
        cls === 'crypto' ||
        cls === 'gold' ||
        ((cls === 'us_stock' || type === 'etf' || type === 'index') &&
          isUS &&
          typeAllowed(d.instrument_type));
      if (!keep) continue;

      const name = d.instrument_name || canonical;
      const nameU = name.toUpperCase();
      let score = 0;
      if (canonical === Q) score += 100;
      else if (canonical.startsWith(Q)) score += 50;
      if (nameU === Q) score += 40;
      else if (nameU.startsWith(Q)) score += 30;
      else if (nameU.includes(Q)) score += 12;
      if (/^[A-Z]{1,5}$/.test(canonical)) score += 10; // clean US ticker beats odd codes
      if (type === 'etf') score += 3;

      const entry = {
        symbol: canonical,
        name,
        type,
        exchange: d.exchange || '',
        currency: d.currency || (cls === 'th_stock' ? 'THB' : 'USD'),
        _score: score,
      };
      const ex = byCanonical.get(canonical);
      if (!ex || score > ex._score) byCanonical.set(canonical, entry);
    }
    return Array.from(byCanonical.values())
      .sort((a, b) => b._score - a._score)
      .slice(0, 12)
      // eslint-disable-next-line no-unused-vars
      .map(({ _score, ...r }) => r);
  } catch {
    return [];
  }
}

/**
 * Get an FX rate (1 base = rate quote).
 * @param {string} base
 * @param {string} quote
 * @returns {Promise<import('../../types.js').Fx|null>}
 */
export async function getFx(base = 'USD', quote = 'THB') {
  if (!KEY) return null;
  try {
    const params = new URLSearchParams({ symbol: `${base}/${quote}`, apikey: KEY });
    const data = await fetchJson(`${BASE}/exchange_rate?${params.toString()}`);
    const rate = f(data && data.rate);
    if (rate == null) return null;
    return { base, quote, rate, ts: data.timestamp ? Number(data.timestamp) * 1000 : Date.now() };
  } catch {
    return null;
  }
}

export default { hasKey, getQuotes, getCandles, getFx, searchSymbols };
