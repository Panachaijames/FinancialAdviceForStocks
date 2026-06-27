// Dividend math helpers.

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
