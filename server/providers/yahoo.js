import yahooFinance from 'yahoo-finance2';
import { classify } from '../util/assetType.js';

// Silence yahoo-finance2 notices (survey + historical deprecation) at load.
try {
  yahooFinance.suppressNotices(['yahooSurvey', 'ripHistorical']);
} catch {
  /* ignore — older/newer versions may not expose this */
}

const DAY_MS = 24 * 60 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry a Yahoo call on transient rate-limit (429 / "Too Many Requests") with
 * exponential backoff. Non-rate-limit errors are rethrown immediately.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withRetry(fn, tries = 3, baseMs = 600) {
  let lastErr;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e);
      const isRateLimited = msg.includes('Too Many Requests') || msg.includes('429');
      if (!isRateLimited || i === tries - 1) throw e;
      await sleep(baseMs * 2 ** i + Math.floor(Math.random() * 250));
    }
  }
  throw lastErr;
}

/**
 * Refine an asset type using Yahoo's quoteType when we have it.
 * @param {string} symbol
 * @param {string} [quoteType]
 * @returns {string}
 */
function refineType(symbol, quoteType) {
  const base = classify(symbol);
  if (!quoteType) return base;
  const qt = String(quoteType).toUpperCase();
  if (base === 'us_stock') {
    if (qt === 'ETF') return 'etf';
    if (qt === 'MUTUALFUND') return 'etf';
    if (qt === 'INDEX') return 'index';
    if (qt === 'CRYPTOCURRENCY') return 'crypto';
    if (qt === 'CURRENCY') return 'other';
    if (qt === 'FUTURE') return 'gold';
  }
  return base;
}

/**
 * Build a clean Quote object from a Yahoo quote row.
 * @param {any} q
 * @returns {import('../../types.js').Quote|null}
 */
function mapQuote(q) {
  if (!q || !q.symbol) return null;
  const symbol = q.symbol;
  const price = num(q.regularMarketPrice);
  const prevClose = num(q.regularMarketPreviousClose ?? q.previousClose);
  let change = num(q.regularMarketChange);
  let changePct = num(q.regularMarketChangePercent);
  if (change == null && price != null && prevClose != null) {
    change = price - prevClose;
  }
  if (changePct == null && change != null && prevClose) {
    changePct = (change / prevClose) * 100;
  }
  return {
    symbol,
    type: refineType(symbol, q.quoteType),
    name: q.shortName || q.longName || q.displayName || symbol,
    currency: q.currency || 'USD',
    price: price ?? 0,
    prevClose: prevClose ?? 0,
    change: change ?? 0,
    changePct: changePct ?? 0,
    dayHigh: num(q.regularMarketDayHigh) ?? 0,
    dayLow: num(q.regularMarketDayLow) ?? 0,
    open: num(q.regularMarketOpen) ?? 0,
    volume: num(q.regularMarketVolume) ?? 0,
    marketState: q.marketState || 'UNKNOWN',
    ts: q.regularMarketTime ? toMs(q.regularMarketTime) : Date.now(),
  };
}

function num(v) {
  if (v == null) return null;
  const n = typeof v === 'object' && 'raw' in v ? v.raw : v;
  const f = Number(n);
  return Number.isFinite(f) ? f : null;
}

function toMs(t) {
  if (t == null) return Date.now();
  if (t instanceof Date) return t.getTime();
  const n = Number(t);
  if (!Number.isFinite(n)) return Date.now();
  // Yahoo sometimes returns seconds, sometimes ms.
  return n < 1e12 ? n * 1000 : n;
}

/**
 * Search for symbols.
 * @param {string} q
 * @returns {Promise<import('../../types.js').SearchResult[]>}
 */
export async function searchSymbols(q) {
  if (!q || !q.trim()) return [];
  try {
    const res = await withRetry(() =>
      yahooFinance.search(q.trim(), { newsCount: 0, quotesCount: 12 })
    );
    const quotes = (res && res.quotes) || [];
    const out = [];
    for (const item of quotes) {
      const symbol = item.symbol;
      if (!symbol) continue;
      if (item.isYahooFinance === false) continue;
      out.push({
        symbol,
        name: item.shortname || item.longname || item.shortName || symbol,
        type: refineType(symbol, item.quoteType || item.typeDisp),
        exchange: item.exchange || item.exchDisp || '',
        currency: item.currency || guessCurrency(symbol),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function guessCurrency(symbol) {
  const t = classify(symbol);
  return t === 'th_stock' ? 'THB' : 'USD';
}

/**
 * Build a Quote from the chart() endpoint's `meta`. Yahoo's quote (v7) endpoint
 * is crumb-protected and aggressively rate-limited, but chart (v8) is lenient and
 * its meta carries the current price — so this works (no key, no quota) when
 * quote() is throttled. Pure mapper, exported for testing.
 * @param {string} symbol
 * @param {any} res chart() response
 * @returns {import('../../types.js').Quote|null}
 */
export function chartToQuote(symbol, res) {
  const m = (res && res.meta) || {};
  const price = num(m.regularMarketPrice);
  if (price == null) return null;
  const prevClose = num(m.chartPreviousClose) ?? num(m.previousClose) ?? price;
  const quotes = (res && res.quotes) || [];
  const last = quotes.length ? quotes[quotes.length - 1] : null;
  const change = price - prevClose;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;
  return {
    symbol,
    type: refineType(symbol, m.instrumentType),
    name: m.shortName || m.longName || m.symbol || symbol,
    currency: m.currency || guessCurrency(symbol),
    price,
    prevClose,
    change,
    changePct,
    dayHigh: num(m.regularMarketDayHigh) ?? (last ? num(last.high) : null) ?? 0,
    dayLow: num(m.regularMarketDayLow) ?? (last ? num(last.low) : null) ?? 0,
    open: last ? num(last.open) ?? 0 : 0,
    volume: num(m.regularMarketVolume) ?? (last ? num(last.volume) : null) ?? 0,
    marketState: 'REGULAR',
    ts: m.regularMarketTime ? toMs(m.regularMarketTime) : Date.now(),
  };
}

/** Fetch a single quote via the chart() endpoint (works when quote() is throttled). */
async function getQuoteViaChart(symbol) {
  try {
    const res = await withRetry(() =>
      yahooFinance.chart(symbol, { period1: new Date(Date.now() - 5 * DAY_MS), interval: '1d' })
    );
    return chartToQuote(symbol, res);
  } catch {
    return null;
  }
}

/**
 * Get quotes for a list of symbols. Strategy: one batched quote() call (best when
 * the IP isn't throttled), then derive any still-missing symbols from the lenient
 * chart() endpoint — so prices keep working even when quote() is rate-limited.
 * @param {string[]} symbols
 * @returns {Promise<import('../../types.js').Quote[]>}
 */
export async function getQuotes(symbols) {
  const list = (symbols || []).filter(Boolean);
  if (list.length === 0) return [];

  const out = [];
  const have = new Set();

  // 1) Single batched quote() — cheap and rich when it works.
  try {
    const res = await withRetry(() => yahooFinance.quote(list));
    const rows = Array.isArray(res) ? res : [res];
    for (const row of rows) {
      const mapped = mapQuote(row);
      if (mapped) {
        out.push(mapped);
        have.add(mapped.symbol);
      }
    }
  } catch {
    /* quote() throttled — fall through to chart-derived quotes */
  }

  // 2) Derive any missing symbols from chart() meta (no key, not crumb-limited).
  const missing = list.filter((s) => !have.has(s));
  if (missing.length) {
    const charted = await Promise.all(missing.map((s) => getQuoteViaChart(s)));
    for (const q of charted) {
      if (q) {
        out.push(q);
        have.add(q.symbol);
      }
    }
  }

  return out;
}

/**
 * Map an app range string to a Yahoo period/interval pair.
 * @param {string} range
 * @param {string} interval
 * @returns {{ period1: Date, period2: Date, interval: string }}
 */
function resolveRange(range, interval) {
  const period2 = new Date();
  let days;
  let iv;
  switch (range) {
    case '1d':
      days = 2;
      iv = '5m';
      break;
    case '5d':
      days = 7;
      iv = '15m';
      break;
    case '1mo':
      days = 31;
      iv = '1d';
      break;
    case '3mo':
      days = 93;
      iv = '1d';
      break;
    case '6mo':
      days = 186;
      iv = '1d';
      break;
    case '1y':
      days = 366;
      iv = '1d';
      break;
    case '2y':
      days = 731;
      iv = '1d';
      break;
    case '5y':
      days = 5 * 366;
      iv = '1wk';
      break;
    case 'max':
      days = 40 * 366;
      iv = '1mo';
      break;
    default:
      days = 186;
      iv = '1d';
  }
  if (interval && interval !== 'auto') iv = interval;
  const period1 = new Date(period2.getTime() - days * DAY_MS);
  return { period1, period2, interval: iv };
}

/**
 * Get OHLCV candles.
 * @param {string} symbol
 * @param {string} range
 * @param {string} interval
 * @returns {Promise<import('../../types.js').Candle[]>}
 */
export async function getCandles(symbol, range = '6mo', interval = 'auto') {
  if (!symbol) return [];
  const { period1, period2, interval: iv } = resolveRange(range, interval);
  try {
    const res = await withRetry(() =>
      yahooFinance.chart(symbol, {
        period1,
        period2,
        interval: iv,
        events: 'div',
      })
    );
    const quotes = (res && res.quotes) || [];
    const out = [];
    for (const row of quotes) {
      const close = num(row.close);
      if (close == null) continue;
      const date = row.date instanceof Date ? row.date : new Date(row.date);
      const time = Math.floor(date.getTime() / 1000);
      if (!Number.isFinite(time)) continue;
      out.push({
        time,
        open: num(row.open) ?? close,
        high: num(row.high) ?? close,
        low: num(row.low) ?? close,
        close,
        volume: num(row.volume) ?? 0,
      });
    }
    // Yahoo returns ascending; ensure unique, sorted-by-time ascending.
    out.sort((a, b) => a.time - b.time);
    const deduped = [];
    let prev = -1;
    for (const c of out) {
      if (c.time === prev) {
        deduped[deduped.length - 1] = c;
      } else {
        deduped.push(c);
        prev = c.time;
      }
    }
    return deduped;
  } catch {
    return [];
  }
}

function inferFrequency(history) {
  if (!history || history.length < 2) return 'unknown';
  // Count payments in the trailing ~12 months.
  const cutoff = Date.now() - 366 * DAY_MS;
  const recent = history.filter((h) => new Date(h.date).getTime() >= cutoff);
  const n = recent.length;
  if (n >= 11) return 'monthly';
  if (n >= 3) return 'quarterly';
  if (n === 2) return 'semiannual';
  if (n === 1) return 'annual';
  // Fallback: estimate from average spacing across full history.
  const times = history
    .map((h) => new Date(h.date).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length < 2) return 'unknown';
  let gap = 0;
  for (let i = 1; i < times.length; i += 1) gap += times[i] - times[i - 1];
  gap /= times.length - 1;
  const days = gap / DAY_MS;
  if (days <= 45) return 'monthly';
  if (days <= 135) return 'quarterly';
  if (days <= 250) return 'semiannual';
  return 'annual';
}

async function getDividendHistory(symbol) {
  try {
    const period1 = new Date(Date.now() - 3 * 366 * DAY_MS);
    const period2 = new Date();
    const res = await withRetry(() =>
      yahooFinance.chart(symbol, {
        period1,
        period2,
        interval: '1mo',
        events: 'div',
      })
    );
    const divs = (res && res.events && res.events.dividends) || {};
    const list = [];
    // events.dividends can be a keyed object or an array depending on version.
    const entries = Array.isArray(divs) ? divs : Object.values(divs);
    for (const d of entries) {
      if (!d) continue;
      const amount = num(d.amount);
      if (amount == null) continue;
      const rawDate = d.date;
      let date;
      if (rawDate instanceof Date) date = rawDate;
      else if (typeof rawDate === 'number') date = new Date(rawDate < 1e12 ? rawDate * 1000 : rawDate);
      else date = new Date(rawDate);
      if (Number.isNaN(date.getTime())) continue;
      list.push({ date: date.toISOString(), amount });
    }
    list.sort((a, b) => new Date(a.date) - new Date(b.date));
    return list;
  } catch {
    return [];
  }
}

/**
 * Get dividend information for a symbol.
 * @param {string} symbol
 * @returns {Promise<import('../../types.js').Dividend>}
 */
export async function getDividend(symbol) {
  const empty = {
    symbol: symbol || '',
    currency: 'USD',
    perShareAnnual: null,
    yieldPct: null,
    frequency: 'unknown',
    exDate: null,
    payDate: null,
    history: [],
  };
  if (!symbol) return empty;

  let summaryDetail = {};
  let priceMod = {};
  let calendarEvents = {};
  try {
    const summary = await withRetry(() =>
      yahooFinance.quoteSummary(symbol, {
        modules: ['price', 'summaryDetail', 'calendarEvents'],
      })
    );
    summaryDetail = (summary && summary.summaryDetail) || {};
    priceMod = (summary && summary.price) || {};
    calendarEvents = (summary && summary.calendarEvents) || {};
  } catch {
    summaryDetail = {};
  }

  const history = await getDividendHistory(symbol);

  const currency = summaryDetail.currency || priceMod.currency || guessCurrency(symbol);

  const perShareAnnual = num(summaryDetail.dividendRate);

  const yieldRaw = num(summaryDetail.dividendYield) ?? num(summaryDetail.trailingAnnualDividendYield);
  const yieldPct = yieldRaw == null ? null : yieldRaw * 100;

  const exDateRaw =
    (calendarEvents && calendarEvents.exDividendDate) || summaryDetail.exDividendDate || null;
  const payDateRaw = (calendarEvents && calendarEvents.dividendDate) || null;

  return {
    symbol,
    currency,
    perShareAnnual,
    yieldPct,
    frequency: inferFrequency(history),
    exDate: toIso(exDateRaw),
    payDate: toIso(payDateRaw),
    history,
  };
}

function toIso(v) {
  if (!v) return null;
  let d;
  if (v instanceof Date) d = v;
  else if (typeof v === 'number') d = new Date(v < 1e12 ? v * 1000 : v);
  else d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Get a deduplicated news feed across the given symbols.
 * @param {string[]} symbols
 * @returns {Promise<import('../../types.js').NewsItem[]>}
 */
export async function getNews(symbols) {
  const list = (symbols || []).filter(Boolean).slice(0, 6);
  if (list.length === 0) return [];

  const byId = new Map();

  await Promise.all(
    list.map(async (sym) => {
      try {
        const res = await withRetry(() =>
          yahooFinance.search(sym, { newsCount: 8, quotesCount: 0 })
        );
        const news = (res && res.news) || [];
        for (const n of news) {
          const id = n.uuid || n.link || n.title;
          if (!id) continue;
          if (byId.has(id)) {
            const existing = byId.get(id);
            if (!existing.relatedSymbols.includes(sym)) existing.relatedSymbols.push(sym);
            continue;
          }
          byId.set(id, {
            id,
            title: n.title || '',
            url: n.link || '',
            source: n.publisher || '',
            publishedAt: toIso(n.providerPublishTime) || new Date().toISOString(),
            summary: n.summary || '',
            thumbnail: pickThumb(n),
            relatedSymbols: [sym],
          });
        }
      } catch {
        /* skip this symbol */
      }
    })
  );

  const items = Array.from(byId.values());
  items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return items;
}

function pickThumb(n) {
  try {
    const res = n.thumbnail && n.thumbnail.resolutions;
    if (Array.isArray(res) && res.length > 0) {
      // Prefer a mid-size resolution.
      const sorted = [...res].sort((a, b) => (a.width || 0) - (b.width || 0));
      const mid = sorted[Math.min(1, sorted.length - 1)];
      return (mid && mid.url) || sorted[0].url || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export default {
  searchSymbols,
  getQuotes,
  getCandles,
  getDividend,
  getNews,
};
