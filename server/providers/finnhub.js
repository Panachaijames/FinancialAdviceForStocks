/**
 * Finnhub provider (keyed) for news. Used as the PRIMARY news source:
 *  - per-symbol company news for equities/ETFs (and Thai/index where available)
 *  - general market news to fill in for crypto/gold-only portfolios
 *
 * Free tier is generous (60 req/min). Defensive: never throws, returns [] on error.
 */
import { config } from '../config.js';
import { classify } from '../util/assetType.js';

const BASE = 'https://finnhub.io/api/v1';
const KEY = config.keys.finnhub;

export function hasKey() {
  return !!KEY;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ymd = (d) => d.toISOString().slice(0, 10);

async function fetchJson(url, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`Finnhub ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('Finnhub request failed');
}

function addItem(byId, n, relatedSymbol) {
  if (!n || !n.headline || !n.url) return;
  const id = String(n.id || n.url);
  if (byId.has(id)) {
    if (relatedSymbol) {
      const ex = byId.get(id);
      if (!ex.relatedSymbols.includes(relatedSymbol)) ex.relatedSymbols.push(relatedSymbol);
    }
    return;
  }
  const tsMs = Number(n.datetime) > 0 ? Number(n.datetime) * 1000 : Date.now();
  byId.set(id, {
    id,
    title: n.headline,
    url: n.url,
    source: n.source || 'Finnhub',
    publishedAt: new Date(tsMs).toISOString(),
    summary: n.summary || '',
    thumbnail: n.image || null,
    relatedSymbols: relatedSymbol ? [relatedSymbol] : [],
  });
}

/**
 * Get a deduplicated news feed across the given symbols.
 * @param {string[]} symbols
 * @returns {Promise<import('../../types.js').NewsItem[]>}
 */
export async function getNews(symbols) {
  if (!KEY) return [];
  const list = (symbols || []).filter(Boolean).slice(0, 8);
  const byId = new Map();

  const to = new Date();
  const from = new Date(Date.now() - 7 * DAY_MS);

  // Company news works for equities/ETFs (and some indices / .BK names).
  const eligible = list.filter((s) => {
    const t = classify(s);
    return t === 'us_stock' || t === 'etf' || t === 'th_stock' || t === 'index';
  });

  await Promise.all(
    eligible.map(async (sym) => {
      try {
        const url = `${BASE}/company-news?symbol=${encodeURIComponent(
          sym
        )}&from=${ymd(from)}&to=${ymd(to)}&token=${KEY}`;
        const arr = await fetchJson(url);
        for (const n of arr || []) addItem(byId, n, sym);
      } catch {
        /* skip this symbol */
      }
    })
  );

  // Fill with general market news if we have little (e.g. crypto/gold-only portfolio).
  if (byId.size < 6) {
    try {
      const arr = await fetchJson(`${BASE}/news?category=general&token=${KEY}`);
      for (const n of (arr || []).slice(0, 25)) addItem(byId, n, null);
    } catch {
      /* ignore */
    }
  }

  const items = Array.from(byId.values());
  items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return items.slice(0, 40);
}

export default { hasKey, getNews };
