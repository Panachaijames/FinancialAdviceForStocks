// Historical daily news-sentiment series for the Forecast lab's optional
// "news" feature. Pulls Finnhub company-news over a date range (chunked by
// month to stay within per-request limits), scores each article's tone with
// the shared finance sentiment lexicon, and returns a compact per-day series
// [{ date, score, count }].
//
// Honest limitations (surfaced in the UI): Finnhub company-news covers US
// stocks/ETFs (+ some indices) only, the free tier holds roughly the last
// year, and — obviously — there is no news for future dates, so the forecast
// decays sentiment toward neutral in its recursive rollout.
import { config } from '../config.js';
import { classify } from '../util/assetType.js';
// Reuse the ONE sentiment implementation the client also uses (pure ESM, no
// browser globals) so scoring stays identical across the app.
import { scoreText } from '../../client/src/lib/forecast/sentiment.js';

const BASE = 'https://finnhub.io/api/v1';
const KEY = config.keys.finnhub;
const DAY_MS = 24 * 60 * 60 * 1000;
const ymd = (d) => d.toISOString().slice(0, 10);

export function hasKey() {
  return !!KEY;
}

/** Which asset classes Finnhub company-news can cover. */
export function supportsSymbol(symbol) {
  const t = classify(symbol);
  return t === 'us_stock' || t === 'etf' || t === 'index';
}

async function fetchJson(url, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`Finnhub ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw lastErr || new Error('Finnhub request failed');
}

/** Month-aligned [from,to] windows covering the last `days` days (newest last). */
function monthWindows(days) {
  const windows = [];
  const end = new Date();
  const start = new Date(Date.now() - days * DAY_MS);
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur <= end) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    const wEnd = new Date(Math.min(next.getTime() - DAY_MS, end.getTime()));
    windows.push({ from: ymd(cur), to: ymd(wEnd) });
    cur = next;
  }
  return windows;
}

/**
 * Build a daily sentiment series for one symbol.
 * @param {string} symbol
 * @param {number} days lookback (capped at ~370 — the free-tier horizon)
 * @returns {Promise<{ symbol:string, supported:boolean, daily:{date:string,score:number,count:number}[], articles:number, coverageDays:number }>}
 */
export async function getNewsSentiment(symbol, days = 365) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!KEY || !sym) return { symbol: sym, supported: false, daily: [], articles: 0, coverageDays: 0 };
  if (!supportsSymbol(sym)) return { symbol: sym, supported: false, daily: [], articles: 0, coverageDays: 0 };

  const lookback = Math.min(370, Math.max(30, Math.floor(days) || 365));
  const windows = monthWindows(lookback);

  // Per-day accumulation: sum of article polarities (with signal) + counts.
  const byDay = new Map(); // 'YYYY-MM-DD' -> { sum, signal, count }
  let articles = 0;

  for (const w of windows) {
    let arr;
    try {
      arr = await fetchJson(`${BASE}/company-news?symbol=${encodeURIComponent(sym)}&from=${w.from}&to=${w.to}&token=${KEY}`);
    } catch {
      continue; // skip a failed month, keep the rest
    }
    for (const n of arr || []) {
      if (!n || !n.headline) continue;
      const tsMs = Number(n.datetime) > 0 ? Number(n.datetime) * 1000 : null;
      if (!tsMs) continue;
      const date = ymd(new Date(tsMs));
      const s = scoreText(`${n.headline}. ${n.summary || ''}`);
      const cur = byDay.get(date) || { sum: 0, signal: 0, count: 0 };
      cur.count += 1;
      if (s !== 0) {
        cur.sum += s;
        cur.signal += 1;
      }
      byDay.set(date, cur);
      articles += 1;
    }
  }

  const daily = Array.from(byDay.entries())
    .map(([date, v]) => ({ date, score: v.signal ? v.sum / v.signal : 0, count: v.count }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return { symbol: sym, supported: true, daily, articles, coverageDays: daily.length };
}

export default { hasKey, supportsSymbol, getNewsSentiment };
