// Formatting + conversion helpers. Pure functions.

const CURRENCY_SYMBOL = {
  USD: '$',
  THB: '฿',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
};

/**
 * Format a monetary value with the given currency.
 * @param {number} value
 * @param {string} currency
 */
export function fmtMoney(value, currency = 'USD') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '—';
  }
  const n = Number(value);
  const cur = (currency || 'USD').toUpperCase();
  const sym = CURRENCY_SYMBOL[cur];
  const abs = Math.abs(n);
  // choose decimal places: tiny crypto values get more precision
  let dp = 2;
  if (abs !== 0 && abs < 1) dp = abs < 0.01 ? 6 : 4;
  const body = n.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
  if (sym) return `${n < 0 ? '-' : ''}${sym}${Math.abs(Number(body.replace(/,/g, ''))).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
  return `${body} ${cur}`;
}

/**
 * Format a plain number with fixed decimal places and thousands separators.
 */
export function fmtNumber(value, dp = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '—';
  }
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

/**
 * Format a percent value (already in percent units, e.g. 12.34 => "12.34%").
 */
export function fmtPct(value, dp = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '—';
  }
  return `${Number(value).toFixed(dp)}%`;
}

/**
 * Format a signed percent value, always showing the sign for non-zero values.
 */
export function fmtSignedPct(value, dp = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '—';
  }
  const n = Number(value);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(dp)}%`;
}

/**
 * Compact number formatting (1.2K, 3.4M, 5.6B, 7.8T).
 */
export function fmtCompact(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '—';
  }
  const n = Number(value);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs < 1000) {
    return `${sign}${abs.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  const units = [
    { v: 1e12, s: 'T' },
    { v: 1e9, s: 'B' },
    { v: 1e6, s: 'M' },
    { v: 1e3, s: 'K' },
  ];
  for (const u of units) {
    if (abs >= u.v) {
      const num = abs / u.v;
      const dp = num >= 100 ? 0 : num >= 10 ? 1 : 2;
      return `${sign}${num.toFixed(dp)}${u.s}`;
    }
  }
  return `${sign}${abs}`;
}

/**
 * Human-friendly "time ago" string from an ISO string or ms epoch.
 */
export function timeAgo(isoOrMs) {
  if (isoOrMs === null || isoOrMs === undefined || isoOrMs === '') return '';
  let ms;
  if (typeof isoOrMs === 'number') {
    ms = isoOrMs;
  } else {
    const parsed = Date.parse(isoOrMs);
    ms = Number.isNaN(parsed) ? Number(isoOrMs) : parsed;
  }
  if (!Number.isFinite(ms)) return '';
  const diff = Date.now() - ms;
  const sec = Math.round(diff / 1000);
  if (sec < 0) return 'just now';
  if (sec < 45) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.round(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.round(day / 365);
  return `${yr}y ago`;
}

/**
 * Classify a numeric change as up/down/flat for styling.
 */
export function classForChange(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
}

/**
 * Pure currency conversion handling USD<->THB.
 * usdThbRate is 1 USD = rate THB.
 * Passthrough if currencies equal or rate falsy.
 */
export function convert(value, fromCurrency, toCurrency, usdThbRate) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const from = (fromCurrency || '').toUpperCase();
  const to = (toCurrency || '').toUpperCase();
  if (!from || !to || from === to) return n;
  if (!usdThbRate || !Number.isFinite(Number(usdThbRate))) return n;
  const rate = Number(usdThbRate);
  if (from === 'USD' && to === 'THB') return n * rate;
  if (from === 'THB' && to === 'USD') return n / rate;
  // Unknown currency pair: passthrough.
  return n;
}
