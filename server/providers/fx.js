import yahooFinance from 'yahoo-finance2';

try {
  yahooFinance.suppressNotices(['yahooSurvey', 'ripHistorical']);
} catch {
  /* ignore */
}

const DEFAULT_RATE = 36;

// Last successfully-fetched rate per pair ("USD/THB" -> { rate, ts }). Preferred
// over the hardcoded DEFAULT_RATE when both live sources fail, so a transient
// double-outage holds the real rate (~32–38) instead of jumping to a constant
// that can move totals percent-level and even record a bogus all-time-high.
const lastGood = new Map();

/**
 * Get an FX rate. Currently optimized for USD->THB but works for any pair by
 * building the Yahoo pair symbol and using the open.er-api.com fallback.
 *
 * Always resolves to a valid Fx object — never throws. The `source` field tells
 * the client how trustworthy the rate is:
 *   'yahoo' | 'erapi' — live      'lastGood' — cached real rate      'default' — hardcoded fallback
 * The client treats 'default' as "not ready" (e.g. gates all-time-high writes).
 *
 * @param {string} base
 * @param {string} quote
 * @returns {Promise<import('../../types.js').Fx>}
 */
export async function getFx(base = 'USD', quote = 'THB') {
  const b = (base || 'USD').toUpperCase();
  const q = (quote || 'THB').toUpperCase();
  const key = `${b}/${q}`;

  // 1) Primary: Yahoo FX quote, e.g. USDTHB=X
  const yahooRate = await fromYahoo(b, q);
  if (yahooRate != null) {
    const ts = Date.now();
    lastGood.set(key, { rate: yahooRate, ts });
    return { base: b, quote: q, rate: yahooRate, source: 'yahoo', ts };
  }

  // 2) Fallback: open.er-api.com (free, no key)
  const apiRate = await fromErApi(b, q);
  if (apiRate != null) {
    const ts = Date.now();
    lastGood.set(key, { rate: apiRate, ts });
    return { base: b, quote: q, rate: apiRate, source: 'erapi', ts };
  }

  // 3) Last good rate for this pair (still real, just stale)
  const lg = lastGood.get(key);
  if (lg != null) {
    return { base: b, quote: q, rate: lg.rate, source: 'lastGood', ts: lg.ts };
  }

  // 4) Safe default — never had a real rate this process
  return { base: b, quote: q, rate: DEFAULT_RATE, source: 'default', ts: Date.now() };
}

async function fromYahoo(base, quote) {
  try {
    const sym = `${base}${quote}=X`;
    const res = await yahooFinance.quote(sym);
    const row = Array.isArray(res) ? res[0] : res;
    const rate = Number(row && (row.regularMarketPrice ?? row.ask ?? row.bid));
    if (Number.isFinite(rate) && rate > 0) return rate;
  } catch {
    /* fall through */
  }
  return null;
}

async function fromErApi(base, quote) {
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rate = Number(data && data.rates && data.rates[quote]);
    if (Number.isFinite(rate) && rate > 0) return rate;
  } catch {
    /* fall through */
  }
  return null;
}

export default { getFx };
