// Dividend math helpers.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Number of dividend payments per year for each frequency.
 */
export const FREQ_PER_YEAR = {
  quarterly: 4,
  semiannual: 2,
  annual: 1,
  monthly: 12,
  unknown: 0,
};

/** Typical days between payments for each frequency (fallback when history is thin). */
const FREQ_INTERVAL_DAYS = {
  monthly: 30,
  quarterly: 91,
  semiannual: 182,
  annual: 365,
};

/**
 * Next ex-dividend date for a holding. Prefers the provider's confirmed upcoming
 * ex-date (quoteSummary.calendarEvents); when that's missing — which is the norm
 * on cloud/datacenter IPs where quoteSummary is blocked — it ESTIMATES the next
 * date from the payment history's cadence and flags it `estimated`.
 *
 * Returns null when there's nothing to show: no confirmed date, and either no
 * history or a cadence that has clearly lapsed (the stock likely stopped paying).
 *
 * @param {import('../api/client.js').Dividend} dividend
 * @param {number} [now] epoch ms (injectable for tests)
 * @returns {{ exDate:string, payDate:string|null, estimated:boolean }|null}
 */
export function nextDividendDate(dividend, now = Date.now()) {
  if (!dividend) return null;

  // 1) Confirmed upcoming ex-date from the provider. Treat "today" as upcoming.
  const exMs = Date.parse(dividend.exDate);
  if (Number.isFinite(exMs) && exMs >= now - DAY_MS) {
    const payMs = Date.parse(dividend.payDate);
    return {
      exDate: new Date(exMs).toISOString(),
      payDate: Number.isFinite(payMs) ? new Date(payMs).toISOString() : null,
      estimated: false,
    };
  }

  // 2) Estimate from history cadence (cloud fallback).
  const dates = (Array.isArray(dividend.history) ? dividend.history : [])
    .map((h) => Date.parse(h?.date))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (dates.length === 0) return null;

  let intervalDays;
  if (dates.length >= 2) {
    const gaps = [];
    for (let i = 1; i < dates.length; i += 1) gaps.push((dates[i] - dates[i - 1]) / DAY_MS);
    gaps.sort((a, b) => a - b);
    intervalDays = gaps[Math.floor(gaps.length / 2)]; // median gap resists outliers
  } else {
    intervalDays = FREQ_INTERVAL_DAYS[dividend.frequency];
  }
  if (!Number.isFinite(intervalDays) || intervalDays <= 0) {
    intervalDays = FREQ_INTERVAL_DAYS[dividend.frequency] || 91; // default: quarterly
  }

  const last = dates[dates.length - 1];
  // If payments have lapsed well past two cycles, the cadence is broken — don't
  // invent a phantom upcoming dividend for a stock that likely stopped paying.
  if (now - last > intervalDays * DAY_MS * 2.5) return null;

  let next = last + intervalDays * DAY_MS;
  let guard = 0;
  while (next < now && guard < 64) {
    next += intervalDays * DAY_MS;
    guard += 1;
  }
  if (next < now) return null;

  return { exDate: new Date(next).toISOString(), payDate: null, estimated: true };
}

/**
 * Derive the annual per-share dividend amount.
 * Uses dividend.perShareAnnual if present, otherwise sums the last ~12 months of history.
 * @param {import('../api/client.js').Dividend} dividend
 * @returns {number|null}
 */
export function derivePerShareAnnual(dividend) {
  if (!dividend) return null;
  if (
    dividend.perShareAnnual !== null &&
    dividend.perShareAnnual !== undefined &&
    Number.isFinite(Number(dividend.perShareAnnual)) &&
    Number(dividend.perShareAnnual) > 0
  ) {
    return Number(dividend.perShareAnnual);
  }
  const history = Array.isArray(dividend.history) ? dividend.history : [];
  if (history.length === 0) return null;
  const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
  let sum = 0;
  let counted = 0;
  for (const entry of history) {
    if (!entry) continue;
    const t = Date.parse(entry.date);
    const amt = Number(entry.amount);
    if (!Number.isFinite(amt)) continue;
    if (Number.isFinite(t) && t >= cutoff) {
      sum += amt;
      counted += 1;
    }
  }
  if (counted > 0) return sum;
  // Fallback: estimate from frequency * most recent payment.
  const freq = FREQ_PER_YEAR[dividend.frequency] || 0;
  if (freq > 0) {
    const last = Number(history[history.length - 1]?.amount);
    if (Number.isFinite(last)) return last * freq;
  }
  return null;
}

/**
 * Compute dividend income figures for a holding.
 * @param {object} args
 * @param {number} args.shares
 * @param {import('../api/client.js').Dividend} args.dividend
 * @param {number} args.price - current price in native currency
 * @param {(amountNative:number, fromCurrency:string)=>number} args.fxConvert
 * @returns {{perShareAnnual:number|null, currency:string, annualNative:number,
 *            annual:number, weekly:number, monthly:number, quarterly:number,
 *            yieldOnCostPct:number|null}}
 */
export function computeDividendIncome({ shares, dividend, price, fxConvert }) {
  const currency = dividend?.currency || 'USD';
  const conv =
    typeof fxConvert === 'function' ? fxConvert : (v) => v;
  const sh = Number(shares) || 0;
  const perShareAnnual = derivePerShareAnnual(dividend);

  if (perShareAnnual === null || sh <= 0) {
    return {
      perShareAnnual,
      currency,
      annualNative: 0,
      annual: 0,
      weekly: 0,
      monthly: 0,
      quarterly: 0,
      yieldOnCostPct:
        dividend && Number.isFinite(Number(dividend.yieldPct))
          ? Number(dividend.yieldPct)
          : null,
    };
  }

  const annualNative = perShareAnnual * sh;
  const annual = conv(annualNative, currency);
  const monthly = annual / 12;
  const weekly = annual / 52;
  const quarterly = annual / 4;

  let yieldOnCostPct = null;
  const p = Number(price);
  if (Number.isFinite(p) && p > 0) {
    yieldOnCostPct = (perShareAnnual / p) * 100;
  } else if (dividend && Number.isFinite(Number(dividend.yieldPct))) {
    yieldOnCostPct = Number(dividend.yieldPct);
  }

  return {
    perShareAnnual,
    currency,
    annualNative,
    annual,
    weekly,
    monthly,
    quarterly,
    yieldOnCostPct,
  };
}
