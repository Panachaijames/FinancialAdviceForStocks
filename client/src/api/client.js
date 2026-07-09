// REST API client. All calls hit the server under /api and throw on !res.ok.
//
// API_BASE is empty by default, so requests are relative (`/api/...`). This is
// correct when the Node server serves the client (single-origin deploy) and for
// local dev via the Vite proxy. To point a separately-hosted frontend (e.g.
// Vercel) at a remote backend, set VITE_API_BASE=https://your-backend at build.
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');

async function request(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json', ...(options && options.headers) },
    ...options,
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body && body.error ? `: ${body.error}` : '';
    } catch {
      // ignore parse errors
    }
    throw new Error(`Request failed (${res.status})${detail}`);
  }
  return res.json();
}

/**
 * Search Thai mutual funds (RMF/LTF/SSF/...) via the SEC OpenAPI.
 * @param {string} q
 * @returns {Promise<Array<{projId,abbr,nameTh,nameEn,amc}>>}
 */
export async function searchFunds(q) {
  const query = (q || '').trim();
  if (!query) return [];
  return request(`/api/funds/search?q=${encodeURIComponent(query)}`);
}

/**
 * Latest NAV (+ day change) for a Thai fund by SEC proj_id. Returns null if none.
 * @param {string} projId
 */
export async function getFundNav(projId) {
  if (!projId) return null;
  try {
    return await request(`/api/funds/nav?id=${encodeURIComponent(projId)}`);
  } catch {
    return null; // 404/no-NAV -> treat as unavailable
  }
}

/**
 * Request an AI insight for the current portfolio (Gemini-backed, analysis only).
 * @param {{ holdings: Array, displayCurrency?: string }} payload
 * @returns {Promise<{ text: string }>}
 */
export async function getAnalysis(payload) {
  return request('/api/analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

/**
 * Deep-research AI retirement path plan (Gemini + Google Search grounding).
 * Slow by design (multi-round research) — expect ~30-90s.
 * @param {{ plan:object, projection:object, holdings:Array, displayCurrency?:string, depth?:'fast'|'deep' }} payload
 * @returns {Promise<{ text:string, sources:{title:string,url:string}[], rounds:number }>}
 */
export async function getRetirementAdvice(payload) {
  return request('/api/analysis/retirement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

/**
 * Deep-research short-term trade dossier for one symbol.
 * @param {{ symbol:string, depth?:'fast'|'deep' }} payload
 * @returns {Promise<{ text:string, sources:{title:string,url:string}[], rounds:number }>}
 */
export async function getTradeIdea(payload) {
  return request('/api/analysis/trade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

/**
 * Historical daily news-sentiment series for the Forecast lab (Finnhub-backed).
 * Returns { supported:false, daily:[] } when unavailable (no key / unsupported
 * asset) so the caller can just skip the news feature.
 * @param {string} symbol
 * @param {number} days lookback (<= ~370 on the free tier)
 */
export async function getNewsSentiment(symbol, days = 365) {
  const sym = (symbol || '').trim();
  if (!sym) return { symbol: '', supported: false, daily: [], articles: 0, coverageDays: 0 };
  try {
    return await request(`/api/forecast/news-sentiment?symbol=${encodeURIComponent(sym)}&days=${days}`);
  } catch {
    return { symbol: sym, supported: false, daily: [], articles: 0, coverageDays: 0 };
  }
}

/** Server health + which providers/features are configured. */
export async function getHealth() {
  return request('/api/health');
}

/**
 * Read a cross-device sync blob by code. Returns null if none stored yet.
 * @param {string} code
 * @returns {Promise<{data:object, updatedAt:number}|null>}
 */
export async function getSyncBlob(code) {
  try {
    return await request(`/api/sync/${encodeURIComponent(code)}`);
  } catch (e) {
    if (/\(404\)/.test(e.message)) return null;
    throw e;
  }
}

/**
 * Write a cross-device sync blob by code.
 * @param {string} code
 * @param {object} data — { holdings, savings, funds }
 * @param {number} updatedAt — epoch ms
 */
export async function putSyncBlob(code, data, updatedAt) {
  return request(`/api/sync/${encodeURIComponent(code)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, updatedAt }),
  });
}

/** Delete a transfer blob (called after a successful receive). */
export async function deleteSyncBlob(code) {
  return request(`/api/sync/${encodeURIComponent(code)}`, { method: 'DELETE' });
}

/**
 * Search for symbols.
 * @param {string} q
 * @returns {Promise<Array>}
 */
export async function searchSymbols(q) {
  const query = (q || '').trim();
  if (!query) return [];
  return request(`/api/search?q=${encodeURIComponent(query)}`);
}

/**
 * Fetch quotes for a list of symbols.
 * @param {string[]} symbols
 * @returns {Promise<Array>}
 */
export async function getQuotes(symbols) {
  const list = Array.isArray(symbols)
    ? symbols.filter(Boolean)
    : [];
  if (list.length === 0) return [];
  return request(`/api/quote?symbols=${encodeURIComponent(list.join(','))}`);
}

/**
 * Fetch candles for a symbol.
 * @param {string} symbol
 * @param {string} range
 * @param {string} interval
 * @returns {Promise<Array>}
 */
export async function getCandles(symbol, range = '6mo', interval = 'auto') {
  if (!symbol) return [];
  const params = new URLSearchParams({
    symbol,
    range: range || '6mo',
    interval: interval || 'auto',
  });
  return request(`/api/candles?${params.toString()}`);
}

/**
 * Fetch dividend data for a symbol.
 * @param {string} symbol
 * @returns {Promise<object>}
 */
export async function getDividend(symbol) {
  if (!symbol) {
    throw new Error('getDividend requires a symbol');
  }
  return request(`/api/dividends?symbol=${encodeURIComponent(symbol)}`);
}

/**
 * Fetch news for a set of symbols.
 * @param {string[]} symbols
 * @returns {Promise<Array>}
 */
export async function getNews(symbols) {
  const list = Array.isArray(symbols) ? symbols.filter(Boolean) : [];
  const qs = list.length
    ? `?symbols=${encodeURIComponent(list.join(','))}`
    : '';
  return request(`/api/news${qs}`);
}

/**
 * Fetch the FX rate.
 * @param {string} base
 * @param {string} quote
 * @returns {Promise<object>}
 */
export async function getFx(base = 'USD', quote = 'THB') {
  const params = new URLSearchParams({ base, quote });
  return request(`/api/fx?${params.toString()}`);
}
