// Financial-planning math — pure functions.
// All amounts are assumed to already be in ONE currency (caller converts to the
// display currency first). Returns are simple deterministic projections, not
// guarantees — the UI labels them as estimates.

/**
 * Project a lump sum + recurring monthly contributions with monthly compounding.
 * @param {{principal?:number, monthly?:number, annualReturnPct?:number, years?:number}} p
 * @returns {{series:{t:number,value:number,invested:number}[], finalValue:number, totalInvested:number, gain:number}}
 */
export function projectFutureValue({ principal = 0, monthly = 0, annualReturnPct = 0, years = 0 } = {}) {
  const P = Math.max(0, Number(principal) || 0);
  const m = Math.max(0, Number(monthly) || 0);
  const yrs = Math.max(0, Number(years) || 0);
  const r = (Number(annualReturnPct) || 0) / 100 / 12;
  const months = Math.round(yrs * 12);
  let value = P;
  let invested = P;
  const series = [{ t: 0, value, invested }];
  for (let i = 1; i <= months; i += 1) {
    value = value * (1 + r) + m;
    invested += m;
    series.push({ t: i / 12, value, invested });
  }
  const last = series[series.length - 1];
  return {
    series,
    finalValue: last.value,
    totalInvested: last.invested,
    gain: last.value - last.invested,
  };
}

/**
 * Monthly contribution needed to reach `target` in `years` (monthly compounding).
 * Returns 0 if the principal alone already gets there, null if years <= 0.
 * @param {{principal?:number, target?:number, annualReturnPct?:number, years?:number}} p
 * @returns {number|null}
 */
export function requiredMonthly({ principal = 0, target = 0, annualReturnPct = 0, years = 0 } = {}) {
  const P = Math.max(0, Number(principal) || 0);
  const T = Math.max(0, Number(target) || 0);
  const yrs = Math.max(0, Number(years) || 0);
  const n = Math.round(yrs * 12);
  if (n <= 0) return null;
  const r = (Number(annualReturnPct) || 0) / 100 / 12;
  const growth = Math.pow(1 + r, n);
  const fvPrincipal = P * growth;
  if (T <= fvPrincipal) return 0;
  if (r === 0) return (T - P) / n;
  const annuityFactor = (growth - 1) / r;
  return Math.max(0, (T - fvPrincipal) / annuityFactor);
}

/**
 * Project annual dividend income forward. With reinvestment (DRIP) the income-
 * producing capital compounds at the yield; `dividendGrowthPct` adds payout growth.
 * @param {{annualIncome?:number, yieldPct?:number, dividendGrowthPct?:number, years?:number, reinvest?:boolean}} p
 * @returns {{series:{t:number,income:number,cumulative:number}[], finalIncome:number, cumulative:number}}
 */
export function projectDividends({
  annualIncome = 0,
  yieldPct = 0,
  dividendGrowthPct = 0,
  years = 10,
  reinvest = true,
} = {}) {
  const D = Math.max(0, Number(annualIncome) || 0);
  const y = (Number(yieldPct) || 0) / 100;
  const g = (Number(dividendGrowthPct) || 0) / 100;
  const yrs = Math.max(0, Number(years) || 0);
  const factor = reinvest ? (1 + y) * (1 + g) : 1 + g;
  const series = [];
  let cumulative = 0;
  for (let n = 0; n <= yrs; n += 1) {
    const income = D * Math.pow(factor, n);
    if (n > 0) cumulative += income;
    series.push({ t: n, income, cumulative });
  }
  const last = series[series.length - 1] || { income: D, cumulative: 0 };
  return { series, finalIncome: last.income, cumulative: last.cumulative };
}

/**
 * Backtest cost-averaging a fixed amount once per calendar month into a price series.
 * @param {{candles?:{time:number,close:number}[], monthlyAmount?:number}} p
 * @returns {{series:{t:number,invested:number,value:number}[], invested:number, value:number, shares:number, returnPct:number}}
 */
export function dcaBacktest({ candles = [], monthlyAmount = 0 } = {}) {
  const amt = Math.max(0, Number(monthlyAmount) || 0);
  const rows = (candles || []).filter(
    (c) => c && Number.isFinite(c.close) && c.close > 0 && Number.isFinite(c.time)
  );
  if (rows.length === 0 || amt <= 0) {
    return { series: [], invested: 0, value: 0, shares: 0, returnPct: 0 };
  }
  rows.sort((a, b) => a.time - b.time);
  const series = [];
  let shares = 0;
  let invested = 0;
  let lastMonthKey = null;
  for (const c of rows) {
    const d = new Date(c.time * 1000);
    const monthKey = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (monthKey !== lastMonthKey) {
      shares += amt / c.close;
      invested += amt;
      lastMonthKey = monthKey;
    }
    series.push({ t: c.time, invested, value: shares * c.close });
  }
  const last = rows[rows.length - 1];
  const value = shares * last.close;
  const returnPct = invested > 0 ? ((value - invested) / invested) * 100 : 0;
  return { series, invested, value, shares, returnPct };
}
