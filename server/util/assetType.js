/**
 * Asset-type classification and symbol helpers.
 * This is a server-side mirror of client/src/lib/assetType.js so the same
 * symbol conventions are applied on both ends of the wire.
 *
 * AssetType = 'us_stock' | 'th_stock' | 'crypto' | 'gold' | 'etf' | 'index' | 'other'
 */

const FIAT = new Set(['USD', 'THB', 'EUR', 'GBP', 'JPY', 'CNY', 'AUD', 'CAD', 'CHF', 'HKD', 'SGD']);

/**
 * Classify a Yahoo-style symbol into an AssetType.
 * @param {string} symbol
 * @returns {string}
 */
export function classify(symbol) {
  if (!symbol || typeof symbol !== 'string') return 'other';
  const s = symbol.trim().toUpperCase();
  if (!s) return 'other';

  // Gold
  if (s === 'GC=F' || s === 'XAUUSD=X' || s.includes('XAU')) return 'gold';

  // Crypto: ends with -USD and the left side is not a fiat currency
  if (s.endsWith('-USD')) {
    const base = s.slice(0, -4);
    if (base && !FIAT.has(base)) return 'crypto';
  }

  // Thai SET
  if (s.endsWith('.BK')) return 'th_stock';

  // Index
  if (s.startsWith('^')) return 'index';

  // FX pairs like USDTHB=X -> treat as other (not a portfolio holding type)
  if (s.endsWith('=X')) return 'other';

  return 'us_stock';
}

/**
 * @param {string} symbol
 * @returns {boolean}
 */
export function isCrypto(symbol) {
  return classify(symbol) === 'crypto';
}

/**
 * Convert a Yahoo crypto symbol ('BTC-USD') to a Binance stream symbol ('btcusdt').
 * Binance quotes crypto in USDT, which we treat as USD.
 * @param {string} symbol
 * @returns {string}
 */
export function toBinanceSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') return '';
  const s = symbol.trim().toUpperCase();
  if (!s.endsWith('-USD')) return '';
  const base = s.slice(0, -4);
  if (!base) return '';
  return `${base}usdt`.toLowerCase();
}

/**
 * Convert a Binance stream symbol ('btcusdt' / 'BTCUSDT') to a Yahoo crypto symbol ('BTC-USD').
 * @param {string} binanceSymbol
 * @returns {string}
 */
export function fromBinanceSymbol(binanceSymbol) {
  if (!binanceSymbol || typeof binanceSymbol !== 'string') return '';
  const s = binanceSymbol.trim().toUpperCase();
  let base = s;
  if (s.endsWith('USDT')) base = s.slice(0, -4);
  else if (s.endsWith('USD')) base = s.slice(0, -3);
  if (!base) return '';
  return `${base}-USD`;
}

const ALIAS = {
  bitcoin: 'BTC-USD',
  btc: 'BTC-USD',
  xbt: 'BTC-USD',
  ethereum: 'ETH-USD',
  eth: 'ETH-USD',
  ether: 'ETH-USD',
  solana: 'SOL-USD',
  sol: 'SOL-USD',
  cardano: 'ADA-USD',
  ada: 'ADA-USD',
  ripple: 'XRP-USD',
  xrp: 'XRP-USD',
  dogecoin: 'DOGE-USD',
  doge: 'DOGE-USD',
  bnb: 'BNB-USD',
  litecoin: 'LTC-USD',
  ltc: 'LTC-USD',
  polkadot: 'DOT-USD',
  dot: 'DOT-USD',
  avalanche: 'AVAX-USD',
  avax: 'AVAX-USD',
  gold: 'GC=F',
  xau: 'GC=F',
  xauusd: 'XAUUSD=X',
  silver: 'SI=F',
  sp500: '^GSPC',
  spx: '^GSPC',
  nasdaq: '^IXIC',
  dow: '^DJI',
  set: '^SET.BK',
};

const KNOWN_CRYPTO = new Set([
  'BTC', 'ETH', 'SOL', 'ADA', 'XRP', 'DOGE', 'BNB', 'LTC', 'DOT', 'AVAX',
  'MATIC', 'LINK', 'UNI', 'ATOM', 'XLM', 'TRX', 'NEAR', 'APT', 'ARB', 'OP',
  'SHIB', 'PEPE', 'FIL', 'ETC', 'BCH', 'ALGO', 'VET', 'ICP', 'HBAR', 'SUI',
]);

/**
 * Best-guess a canonical Yahoo symbol from free-form user text.
 * @param {string} text
 * @returns {string}
 */
export function normalizeInput(text) {
  if (!text || typeof text !== 'string') return '';
  const raw = text.trim();
  if (!raw) return '';

  const lower = raw.toLowerCase();
  if (ALIAS[lower]) return ALIAS[lower];

  let s = raw.toUpperCase();

  // Already a fully-qualified symbol — keep as-is.
  if (s.includes('.') || s.includes('=') || s.includes('-') || s.startsWith('^')) {
    return s;
  }

  // Bare known crypto ticker -> -USD pair.
  if (KNOWN_CRYPTO.has(s)) return `${s}-USD`;

  // Otherwise assume a plain US ticker.
  return s;
}

export default {
  classify,
  isCrypto,
  toBinanceSymbol,
  fromBinanceSymbol,
  normalizeInput,
};
