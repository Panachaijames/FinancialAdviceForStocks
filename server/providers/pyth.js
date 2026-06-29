/**
 * Pyth Network (Hermes) provider — OVERNIGHT US-equity prices (≈8pm–4am ET,
 * Blue Ocean ATS), which Yahoo does not cover. Free, NO API key, public REST.
 *
 * Pyth publishes per-symbol equity feeds named "AAPL/USD OVERNIGHT" (also PRE
 * MARKET / POST MARKET / regular). We use ONLY the OVERNIGHT feed, to enrich
 * quotes during overnight hours. It is never a primary price source, and we only
 * surface a value when Pyth's tick is FRESH (so a stale snapshot is hidden, not
 * shown as if live).
 */
import { classify } from '../util/assetType.js';
import { createLimiter } from '../util/limit.js';

const HERMES = 'https://hermes.pyth.network';
const limit = createLimiter(3);

// symbol -> overnight feed id (or null). Feed ids are static, cache for the process.
const feedCache = new Map();
// feed id -> { val, ts } short-lived price cache.
const priceCache = new Map();
const PRICE_TTL_MS = 30 * 1000;
// Only treat a Pyth overnight tick as live if it published within this window.
const FRESH_MS = 10 * 60 * 60 * 1000;

/** Current US/Eastern hour (DST-aware), or -1 if unavailable. */
function etHour() {
  try {
    const s = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
    }).format(new Date());
    return parseInt(s, 10) % 24;
  } catch {
    return -1;
  }
}

/** Coarse Blue Ocean overnight window (~8pm–4am ET). */
export function isOvernightHours() {
  const h = etHour();
  return h >= 20 || h < 4;
}

async function lookupOvernightFeed(symbol) {
  if (feedCache.has(symbol)) return feedCache.get(symbol);
  let id = null;
  try {
    const r = await limit(() =>
      fetch(`${HERMES}/v2/price_feeds?query=${encodeURIComponent(symbol)}&asset_type=equity`)
    );
    const feeds = await r.json().catch(() => []);
    if (Array.isArray(feeds)) {
      const want = `${symbol}/USD OVERNIGHT`.toUpperCase();
      const m = feeds.find(
        (f) => String(f?.attributes?.display_symbol || '').toUpperCase() === want
      );
      id = (m && m.id) || null;
    }
  } catch {
    id = null;
  }
  feedCache.set(symbol, id);
  return id;
}

async function latestPrice(feedId) {
  const cached = priceCache.get(feedId);
  if (cached && Date.now() - cached.ts < PRICE_TTL_MS) return cached.val;
  let val = null;
  try {
    const r = await limit(() =>
      fetch(`${HERMES}/v2/updates/price/latest?ids[]=${encodeURIComponent(feedId)}`)
    );
    const d = await r.json().catch(() => null);
    const p = d && d.parsed && d.parsed[0] && d.parsed[0].price;
    if (p && p.price != null && p.expo != null) {
      val = {
        price: Number(p.price) * Math.pow(10, Number(p.expo)),
        publishTime: Number(p.publish_time) * 1000,
      };
    }
  } catch {
    val = null;
  }
  priceCache.set(feedId, { val, ts: Date.now() });
  return val;
}

/**
 * Enrich quotes with overnight prices (mutates + returns). No-op unless it's
 * overnight ET hours; only US stocks/ETFs; only when Pyth has a fresh tick.
 * @param {Array} quotes
 * @returns {Promise<Array>}
 */
export async function attachOvernight(quotes) {
  if (!Array.isArray(quotes) || quotes.length === 0) return quotes;
  if (!isOvernightHours()) return quotes;
  await Promise.all(
    quotes.map(async (q) => {
      if (!q || !q.symbol) return;
      const t = classify(q.symbol);
      if (t !== 'us_stock' && t !== 'etf') return;
      const id = await lookupOvernightFeed(q.symbol);
      if (!id) return;
      const latest = await latestPrice(id);
      if (!latest || latest.price == null) return;
      if (Date.now() - latest.publishTime > FRESH_MS) return; // stale -> hide
      const base = Number.isFinite(q.price) && q.price ? q.price : q.prevClose;
      q.overnightPrice = latest.price;
      q.overnightChangePct = base ? ((latest.price - base) / base) * 100 : null;
      q.marketState = 'OVERNIGHT';
    })
  );
  return quotes;
}

export default { isOvernightHours, attachOvernight };
