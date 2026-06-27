import yahooFinance from 'yahoo-finance2';

try {
  yahooFinance.suppressNotices(['yahooSurvey', 'ripHistorical']);
} catch {
  /* ignore */
}

const DEFAULT_RATE = 36;

/**
 * Get an FX rate. Currently optimized for USD->THB but works for any pair by
 * building the Yahoo pair symbol and using the open.er-api.com fallback.
 *
 * Always resolves to a valid Fx object — never throws.
 *
 * @param {string} base
 * @param {string} quote
 * @returns {Promise<import('../../types.js').Fx>}
 */
export async function getFx(base = 'USD', quote = 'THB') {
  const b = (base || 'USD').toUpperCase();
  const q = (quote || 'THB').toUpperCase();

  // 1) Primary: Yahoo FX quote, e.g. USDTHB=X
  const yahooRate = await fromYahoo(b, q);
  if (yahooRate != null) {
    return { base: b, quote: q, rate: yahooRate, ts: Date.now() };
  }

  // 2) Fallback: open.er-api.com (free, no key)
  const apiRate = await fromErApi(b, q);
  if (apiRate != null) {
    return { base: b, quote: q, rate: apiRate, ts: Date.now() };
  }

  // 3) Safe default
  return { base: b, quote: q, rate: DEFAULT_RATE, ts: Date.now() };
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
