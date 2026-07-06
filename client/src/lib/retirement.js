// Retirement / financial-freedom projection — pure functions.
//
// Currency-agnostic: the caller passes every amount in ONE currency (the app
// uses the active display currency). Models the two phases of a retirement plan
// with the factors that actually drive the outcome — inflation, expected
// returns (different before vs after retiring), contributions, and a spending
// need that grows with inflation — then simulates year by year whether the
// money lasts. Deterministic estimate, not a guarantee.
//
// Thailand-oriented defaults (editable in the UI):
//   inflation 2.5%  — Bank of Thailand target band is 1-3%; long-run CPI ~2%.
//   pre-return 7%   — balanced growth (SET + global) during accumulation.
//   post-return 4%  — more conservative allocation while drawing down.
//   retire age 60   — Thailand's standard retirement age.
//   end age 85      — plan-to age (Thai life expectancy ~77-80; plan longer).
//   SWR 4%          — safe withdrawal rate (Trinity-style rule of thumb).

import { requiredMonthly } from './planning.js';

export const RETIREMENT_DEFAULTS = {
  inflationPct: 2.5,
  preReturnPct: 7,
  postReturnPct: 4,
  retireAge: 60,
  endAge: 85,
  swrPct: 4,
  // Tax drag on investment gains. 15% ≈ US dividend withholding (treaty rate).
  // Thai SET capital gains are exempt and RMF/Thai ESG gains are tax-free if
  // held, so lower it for a SET/fund-heavy mix (0 = fully tax-sheltered).
  investmentTaxPct: 15,
};

const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};
const pct = (v) => (Number(v) || 0) / 100;
const clampInt = (v, lo, hi, dflt) => {
  let x = Math.round(Number(v));
  if (!Number.isFinite(x)) x = dflt;
  return Math.min(hi, Math.max(lo, x));
};

/**
 * Project accumulation → drawdown, year by year, with inflation.
 * Contributions are flat (nominal), consistent with the app's other planners;
 * the retirement spending need grows with inflation each year.
 *
 * @param {object} p
 * @returns {{
 *   series: {age:number, balance:number, phase:'accumulate'|'draw'}[],
 *   currentAge:number, retireAge:number, endAge:number,
 *   nestEggAtRetirement:number, realNestEgg:number,
 *   monthlyExpenseAtRetirement:number, annualExpenseAtRetirement:number,
 *   freedomNumber:number, freedomGap:number, onTrack:boolean,
 *   depletionAge:number|null, balanceAtEnd:number, freedomAge:number|null,
 *   requiredMonthly:number|null
 * }}
 */
export function projectRetirement(p = {}) {
  const currentAge = clampInt(p.currentAge, 15, 90, 30);
  const retireAge = clampInt(p.retireAge, currentAge + 1, 95, 60);
  const endAge = clampInt(p.endAge, retireAge + 1, 110, 85);
  const start = num(p.currentSavings);
  const monthly = num(p.monthlyContribution);
  const rPre = pct(p.preReturnPct);
  const rPost = pct(p.postReturnPct);
  const infl = pct(p.inflationPct);
  const swr = pct(p.swrPct) || 0.04;
  const monthlyExpenseToday = num(p.monthlyExpenseToday);
  const monthlyPensionToday = num(p.monthlyPensionToday);

  // Tax drag: investment gains are taxed at `investmentTaxPct`, so each year's
  // growth is kept only net of tax (principal is never taxed). Effective return
  // = r * (1 - taxRate). Captures e.g. 15% US dividend withholding / Thai tax on
  // remitted gains; set to 0 for tax-sheltered holdings (RMF, SET gains).
  const invTax = Math.min(1, Math.max(0, pct(p.investmentTaxPct)));
  const rPreNet = rPre * (1 - invTax);
  const rPostNet = rPost * (1 - invTax);
  const preReturnNetPct = (Number(p.preReturnPct) || 0) * (1 - invTax);

  const series = [];
  let balance = start;
  let depletionAge = null;
  let freedomAge = null;
  let nestEggAtRetirement = null;
  let monthlyExpenseAtRetirement = monthlyExpenseToday * Math.pow(1 + infl, retireAge - currentAge);

  for (let age = currentAge; age <= endAge; age += 1) {
    const inflFactor = Math.pow(1 + infl, age - currentAge);
    const phase = age < retireAge ? 'accumulate' : 'draw';
    series.push({ age, balance: Math.max(0, balance), phase });

    // Earliest age at which assets could sustain the (inflated) lifestyle at the
    // SWR forever = "financial freedom" age.
    if (freedomAge == null && monthlyExpenseToday > 0) {
      const netMonthly = Math.max(0, monthlyExpenseToday - monthlyPensionToday);
      const fiNumberNow = (netMonthly * inflFactor * 12) / swr;
      if (fiNumberNow > 0 && balance >= fiNumberNow) freedomAge = age;
    }

    if (age === retireAge) {
      nestEggAtRetirement = Math.max(0, balance);
      monthlyExpenseAtRetirement = monthlyExpenseToday * inflFactor;
    }

    if (age >= endAge) break;

    if (phase === 'accumulate') {
      balance = balance * (1 + rPreNet) + monthly * 12;
    } else {
      const expenseThisYear = monthlyExpenseToday * inflFactor * 12;
      const pensionThisYear = monthlyPensionToday * inflFactor * 12;
      const netNeed = Math.max(0, expenseThisYear - pensionThisYear);
      balance = (balance - netNeed) * (1 + rPostNet);
      if (balance <= 0 && depletionAge == null) {
        depletionAge = age + 1;
        balance = 0;
      }
    }
  }

  if (nestEggAtRetirement == null) nestEggAtRetirement = Math.max(0, balance);

  const annualExpenseAtRetirement = monthlyExpenseAtRetirement * 12;
  const annualPensionAtRetirement = monthlyPensionToday * Math.pow(1 + infl, retireAge - currentAge) * 12;
  const netAnnualNeed = Math.max(0, annualExpenseAtRetirement - annualPensionAtRetirement);
  const freedomNumber = swr > 0 ? netAnnualNeed / swr : 0;
  const freedomGap = freedomNumber - nestEggAtRetirement;

  const balanceAtEnd = Math.max(0, balance);
  const onTrack = depletionAge == null; // money lasts through the whole retirement
  const realNestEgg = nestEggAtRetirement / Math.pow(1 + infl, retireAge - currentAge);

  const reqMonthly =
    freedomGap > 0
      ? requiredMonthly({
          principal: start,
          target: freedomNumber,
          annualReturnPct: preReturnNetPct,
          years: retireAge - currentAge,
        })
      : 0;

  return {
    series,
    currentAge,
    retireAge,
    endAge,
    nestEggAtRetirement,
    realNestEgg,
    monthlyExpenseAtRetirement,
    annualExpenseAtRetirement,
    freedomNumber,
    freedomGap,
    onTrack,
    depletionAge,
    balanceAtEnd,
    freedomAge,
    requiredMonthly: reqMonthly,
  };
}
