// Asset classification + symbol convention helpers. Mirrors server/util/assetType.js.

const CURRENCY_USD_PAIRS = new Set([
  'EUR-USD',
  'GBP-USD',
  'JPY-USD',
  'AUD-USD',
  'CAD-USD',
  'CHF-USD',
  'CNY-USD',
  'THB-USD',
]);

/**
 * Classify a Yahoo-style symbol into an AssetType.
 * @param {string} symbol
 * @returns {'us_stock'|'th_stock'|'crypto'|'gold'|'etf'|'index'|'other'}
 */
export function classify(symbol) {
  if (!symbol || typeof symbol !== 'string') return 'other';
  const s = symbol.trim().toUpperCase();
  if (!s) return 'other';
  // Gold first (so XAUUSD=X doesn't get caught elsewhere).
  if (s === 'GC=F' || s === 'XAUUSD=X' || s.includes('XAU')) return 'gold';
  // Crypto: COIN-USD, but not a fiat currency pair.
  if (s.endsWith('-USD') && !CURRENCY_USD_PAIRS.has(s)) return 'crypto';
  if (s.endsWith('.BK')) return 'th_stock';
  if (s.startsWith('^')) return 'index';
  return 'us_stock';
}

const META = {
  us_stock: { label: 'US Stock', color: '#3b82f6', emoji: '🇺🇸' },
  th_stock: { label: 'Thai Stock', color: '#22c55e', emoji: '🇹🇭' },
  crypto: { label: 'Crypto', color: '#a78bfa', emoji: '🪙' },
  gold: { label: 'Gold', color: '#f59e0b', emoji: '🥇' },
  etf: { label: 'ETF', color: '#06b6d4', emoji: '📊' },
  index: { label: 'Index', color: '#64748b', emoji: '📈' },
  other: { label: 'Other', color: '#94a3b8', emoji: '💠' },
};

/**
 * Display metadata for an asset type.
 */
export function assetMeta(type) {
  return META[type] || META.other;
}

// Common name/alias => canonical Yahoo symbol map.
const ALIAS = {
  bitcoin: 'BTC-USD',
  btc: 'BTC-USD',
  xbt: 'BTC-USD',
  ethereum: 'ETH-USD',
  eth: 'ETH-USD',
  solana: 'SOL-USD',
  sol: 'SOL-USD',
  ripple: 'XRP-USD',
  xrp: 'XRP-USD',
  cardano: 'ADA-USD',
  ada: 'ADA-USD',
  dogecoin: 'DOGE-USD',
  doge: 'DOGE-USD',
  litecoin: 'LTC-USD',
  ltc: 'LTC-USD',
  bnb: 'BNB-USD',
  gold: 'GC=F',
  xau: 'GC=F',
  xauusd: 'XAUUSD=X',
  sp500: '^GSPC',
  spx: '^GSPC',
  nasdaq: '^IXIC',
  dow: '^DJI',
};

/**
 * Best-guess a canonical symbol from free text.
 * @param {string} text
 * @returns {string}
 */
export function normalizeInput(text) {
  if (!text || typeof text !== 'string') return '';
  const raw = text.trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (ALIAS[lower]) return ALIAS[lower];

  // If it already looks like a fully-qualified symbol, normalize case sensibly.
  const upper = raw.toUpperCase();
  if (
    upper.endsWith('.BK') ||
    upper.endsWith('-USD') ||
    upper.endsWith('=X') ||
    upper.endsWith('=F') ||
    upper.startsWith('^')
  ) {
    return upper;
  }
  // Bare crypto ticker (e.g. "sol") handled by ALIAS; otherwise treat as a plain ticker.
  return upper;
}

/**
 * Whether a symbol is a crypto asset.
 */
export function isCrypto(symbol) {
  return classify(symbol) === 'crypto';
}

/**
 * Convert a Yahoo crypto symbol to a Binance stream symbol.
 * 'BTC-USD' -> 'btcusdt'
 */
export function toBinanceSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') return '';
  const s = symbol.trim().toUpperCase();
  const base = s.endsWith('-USD') ? s.slice(0, -4) : s;
  return `${base.toLowerCase()}usdt`;
}

/**
 * Convert a Binance stream symbol back to a Yahoo crypto symbol.
 * 'btcusdt' -> 'BTC-USD'
 */
export function fromBinanceSymbol(binanceSymbol) {
  if (!binanceSymbol || typeof binanceSymbol !== 'string') return '';
  const s = binanceSymbol.trim().toUpperCase();
  let base = s;
  if (base.endsWith('USDT')) base = base.slice(0, -4);
  else if (base.endsWith('USD')) base = base.slice(0, -3);
  return `${base}-USD`;
}
