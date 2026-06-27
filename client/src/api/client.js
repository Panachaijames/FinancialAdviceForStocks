// REST API client. All calls hit the server under /api and throw on !res.ok.

async function request(path) {
  const res = await fetch(path, {
    headers: { Accept: 'application/json' },
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
