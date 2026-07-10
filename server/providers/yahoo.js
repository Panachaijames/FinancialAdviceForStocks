import yahooFinance from 'yahoo-finance2';
import { classify } from '../util/assetType.js';
import { createLimiter } from '../util/limit.js';

// Cap concurrent upstream Yahoo calls. Opening the app with many holdings fans
// out into one quote + candles + dividend fetch per card all at once; that
// burst trips Yahoo's per-IP rate limit and prices/charts come back empty. The
// limiter serializes the burst (every Yahoo call flows through withRetry below)
// so requests succeed instead of being throttled. Shared across all callers.
const yfLimit = createLimiter(3);

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
      return await yfLimit(fn);
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
    preMarketPrice: num(q.preMarketPrice),
    preMarketChangePct: num(q.preMarketChangePercent),
    postMarketPrice: num(q.postMarketPrice),
    postMarketChangePct: num(q.postMarketChangePercent),
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

// Yahoo's public search endpoint (v1) needs NO crumb/cookie. By contrast the
// crumb token endpoint (/v1/test/getcrumb) and quote() (v7) are aggressively
// rate-limited per IP — they return 429 "Too Many Requests" / 401, which recurs
// intermittently from any one machine. yahoo-finance2 v2's search() fetches a
// crumb *first*, so it breaks whenever that token endpoint is throttled, even
// though the search endpoint itself is perfectly healthy. We therefore call the
// search endpoint directly (no crumb) — this keeps symbol search and news
// working regardless of crumb throttling.
const SEARCH_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Call Yahoo's crumb-free search endpoint directly and return the raw payload.
 * Tries query1 then query2; transient rate limits are retried via withRetry.
 * @param {string} q
 * @param {{ quotesCount?: number, newsCount?: number }} [opts]
 * @returns {Promise<{ quotes: any[], news: any[] }>}
 */
async function searchYahooDirect(q, { quotesCount = 12, newsCount = 0 } = {}) {
  const params = new URLSearchParams({
    q,
    quotesCount: String(quotesCount),
    newsCount: String(newsCount),
    enableFuzzyQuery: 'false',
    lang: 'en-US',
    region: 'US',
  });
  return withRetry(async () => {
    let lastErr;
    for (const host of SEARCH_HOSTS) {
      try {
        const res = await fetch(`${host}/v1/finance/search?${params.toString()}`, {
          headers: { 'user-agent': BROWSER_UA, accept: 'application/json' },
        });
        // Non-2xx: surface the status (incl. 429) so withRetry can back off and
        // the loop can also try the other host.
        if (!res.ok) {
          lastErr = new Error(`Yahoo search HTTP ${res.status}`);
          continue;
        }
        const data = await res.json();
        return { quotes: (data && data.quotes) || [], news: (data && data.news) || [] };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Yahoo search request failed');
  });
}

/**
 * Search for symbols.
 * @param {string} q
 * @returns {Promise<import('../../types.js').SearchResult[]>}
 */
export async function searchSymbols(q) {
  if (!q || !q.trim()) return [];
  try {
    const { quotes } = await searchYahooDirect(q.trim(), { quotesCount: 12, newsCount: 0 });
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

/**
 * Fetch the raw chart (v8) payload directly (crumb-free, like searchYahooDirect).
 * This is the ONE Yahoo data path that works everywhere — including cloud IPs,
 * where the yahoo-finance2 library's chart()/quoteSummary() (which do a crumb
 * step) fail. Used for quotes, candles, and dividend history. Gated + retried.
 * @param {string} symbol
 * @param {{ range?: string, interval?: string, includePrePost?: boolean,
 *           period1?: Date|number, period2?: Date|number, events?: string }} [opts]
 * @returns {Promise<any>} chart result ({ meta, timestamp, indicators, events })
 */
async function fetchChartJSON(symbol, opts = {}) {
  const { range, interval = '1d', includePrePost = false, period1, period2, events } = opts;
  const params = new URLSearchParams({ interval });
  if (period1 != null && period2 != null) {
    const toSec = (v) => Math.floor((v instanceof Date ? v.getTime() : Number(v)) / 1000);
    params.set('period1', String(toSec(period1)));
    params.set('period2', String(toSec(period2)));
  } else {
    params.set('range', range || '1d');
  }
  if (includePrePost) params.set('includePrePost', 'true');
  if (events) params.set('events', events);
  return withRetry(async () => {
    let lastErr;
    for (const host of SEARCH_HOSTS) {
      try {
        const res = await fetch(
          `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${params.toString()}`,
          { headers: { 'user-agent': BROWSER_UA, accept: 'application/json' } }
        );
        if (!res.ok) {
          lastErr = new Error(`Yahoo chart HTTP ${res.status}`);
          continue;
        }
        const data = await res.json();
        const result = data && data.chart && data.chart.result && data.chart.result[0];
        if (!result) {
          lastErr = new Error('Yahoo chart: empty result');
          continue;
        }
        return result;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Yahoo chart request failed');
  });
}

/**
 * Build a Quote (incl. pre-market / after-hours) from a raw chart result that was
 * fetched with includePrePost. marketState is derived from meta.currentTradingPeriod
 * (Yahoo only covers pre [~4am] → regular → post [~8pm ET]; there is no overnight
 * session). The latest close inside the pre/post window gives the extended price.
 * @param {string} symbol
 * @param {any} result raw chart result
 * @returns {import('../../types.js').Quote|null}
 */
function quoteFromChartJSON(symbol, result) {
  const m = (result && result.meta) || {};
  const price = num(m.regularMarketPrice);
  if (price == null) return null;
  const prevClose = num(m.chartPreviousClose) ?? num(m.previousClose) ?? price;
  const ts = (result && result.timestamp) || [];
  const q0 = result && result.indicators && result.indicators.quote && result.indicators.quote[0];
  const closes = (q0 && q0.close) || [];
  const cp = m.currentTradingPeriod || {};
  const inWin = (t, w) => !!w && t >= w.start && t < w.end;

  let lastPre = null;
  let lastPost = null;
  for (let i = 0; i < ts.length && i < closes.length; i += 1) {
    const c = num(closes[i]);
    if (c == null) continue;
    const t = ts[i];
    if (inWin(t, cp.pre)) lastPre = c;
    else if (inWin(t, cp.post)) lastPost = c;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  let marketState = 'CLOSED';
  if (inWin(nowSec, cp.pre)) marketState = 'PRE';
  else if (inWin(nowSec, cp.regular)) marketState = 'REGULAR';
  else if (inWin(nowSec, cp.post)) marketState = 'POST';

  const change = price - prevClose;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;

  // Both pre- and after-hours are quoted vs the MOST RECENT regular close, which
  // in the chart meta is `regularMarketPrice` (= yesterday's close during pre-
  // market, today's close during after-hours) — NOT `chartPreviousClose`, which
  // is the close before that and gave a wrong pre-market % on big-move days.
  const preMarketChangePct =
    lastPre != null && price ? ((lastPre - price) / price) * 100 : null;
  const postMarketChangePct =
    lastPost != null && price ? ((lastPost - price) / price) * 100 : null;

  return {
    symbol,
    type: refineType(symbol, m.instrumentType),
    name: m.shortName || m.longName || m.symbol || symbol,
    currency: m.currency || guessCurrency(symbol),
    price,
    prevClose,
    change,
    changePct,
    dayHigh: num(m.regularMarketDayHigh) ?? 0,
    dayLow: num(m.regularMarketDayLow) ?? 0,
    open: 0,
    volume: num(m.regularMarketVolume) ?? 0,
    marketState,
    preMarketPrice: lastPre,
    preMarketChangePct,
    postMarketPrice: lastPost,
    postMarketChangePct,
    ts: m.regularMarketTime ? toMs(m.regularMarketTime) : Date.now(),
  };
}

/** Fetch a single quote (incl. pre/after-hours) via the lenient chart endpoint. */
async function getQuoteViaChart(symbol) {
  // 1-day intraday with pre/post: meta carries the regular price reliably (even
  // when the market is closed) and the series yields the extended-hours price.
  try {
    const result = await fetchChartJSON(symbol, { range: '1d', interval: '5m', includePrePost: true });
    const q = quoteFromChartJSON(symbol, result);
    if (q && q.price != null) return q;
  } catch {
    /* fall through to the daily-close fallback */
  }
  // Fallback: a 5-day daily chart, robust across long market closures.
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

/** Parse OHLCV candles from a raw chart result (timestamp[] + indicators.quote[0]). */
function candlesFromChartJSON(result) {
  const ts = (result && result.timestamp) || [];
  const q0 =
    (result && result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const opens = q0.open || [];
  const highs = q0.high || [];
  const lows = q0.low || [];
  const closes = q0.close || [];
  const vols = q0.volume || [];
  const out = [];
  for (let i = 0; i < ts.length; i += 1) {
    const close = num(closes[i]);
    if (close == null) continue;
    const time = Math.floor(Number(ts[i])); // raw timestamps are epoch seconds
    if (!Number.isFinite(time)) continue;
    out.push({
      time,
      open: num(opens[i]) ?? close,
      high: num(highs[i]) ?? close,
      low: num(lows[i]) ?? close,
      close,
      volume: num(vols[i]) ?? 0,
    });
  }
  out.sort((a, b) => a.time - b.time);
  const deduped = [];
  let prev = -1;
  for (const c of out) {
    if (c.time === prev) deduped[deduped.length - 1] = c;
    else {
      deduped.push(c);
      prev = c.time;
    }
  }
  return deduped;
}

/**
 * Get OHLCV candles via the crumb-free direct chart endpoint (so Thai .BK and
 * everything else load on cloud IPs, where the library's chart() fails).
 * @param {string} symbol
 * @param {string} range
 * @param {string} interval
 * @returns {Promise<import('../../types.js').Candle[]>}
 */
export async function getCandles(symbol, range = '6mo', interval = 'auto') {
  if (!symbol) return [];
  const { period1, period2, interval: iv } = resolveRange(range, interval);
  try {
    const result = await fetchChartJSON(symbol, { period1, period2, interval: iv });
    return candlesFromChartJSON(result);
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
    // Crumb-free direct fetch with dividend events (works on cloud IPs).
    const result = await fetchChartJSON(symbol, {
      period1,
      period2,
      interval: '1mo',
      events: 'div',
    });
    const divs = (result && result.events && result.events.dividends) || {};
    const list = [];
    for (const d of Object.values(divs)) {
      if (!d) continue;
      const amount = num(d.amount);
      if (amount == null) continue;
      // raw endpoint: d.date is epoch seconds
      const t = Number(d.date);
      if (!Number.isFinite(t)) continue;
      const date = new Date(t < 1e12 ? t * 1000 : t);
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

  // Prefer quoteSummary's dividendRate; fall back to the trailing-12-month sum of
  // the (crumb-free) history so dividends work on cloud where quoteSummary fails.
  let perShareAnnual = num(summaryDetail.dividendRate);
  if (perShareAnnual == null && history.length) {
    const cutoff = Date.now() - 366 * DAY_MS;
    let sum = 0;
    let n = 0;
    for (const h of history) {
      const t = Date.parse(h.date);
      if (Number.isFinite(t) && t >= cutoff) {
        sum += h.amount;
        n += 1;
      }
    }
    if (n > 0) perShareAnnual = sum;
  }

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
        // Crumb-free direct search (see searchYahooDirect) — yahooFinance.search()
        // would fail whenever Yahoo's crumb endpoint is throttled.
        const { news } = await searchYahooDirect(sym, { newsCount: 8, quotesCount: 0 });
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
