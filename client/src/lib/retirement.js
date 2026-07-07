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
  // Tax drag on investment gains (% of total return). ~8% reflects a US
  // buy-and-hold Thai resident: the US doesn't tax foreigners' capital gains,
  // only ~15% on dividends, plus some Thai tax on remitted income. Lower for a
  // SET/fund-heavy mix (RMF/Thai ESG gains are tax-free if held).
  investmentTaxPct: 8,
  // Optional refinements (all no-ops at their defaults):
  contributionGrowthPct: 0, // yearly raise applied to the monthly contribution
  retireSpendPct: 100, // % of today's spending the retired lifestyle needs
  careFromAge: 75, // late-life care: spending bump starts at this age…
  careBumpPct: 0, // …adding this % on top of the (inflated) spending need
};

// Effective planning tax rate on investment GAINS (% of total return) by asset
// type for a Thai resident buy-and-hold retiree, re-verified against primary
// sources in July 2026; used to auto-suggest a blended rate from the holdings
// mix. Legal basis per rule:
//   - SET capital gains exempt: กฎกระทรวง 126 ข้อ 2(23) under มาตรา 42(17).
//   - Thai dividends: 10% final WHT option (มาตรา 50(2)(จ) + 48(3)).
//   - US side (Thai NRA): no US CGT (IRC §871(a)(2)); dividends 15% under the
//     US-Thai treaty Art. 10(2)(b). Thai tax applies when gains are REMITTED:
//     Por. 161/162/2566 still operative as of Jul 2026 — the 2025 draft easing
//     (remit in year earned or next year = exempt) was never gazetted.
//   - Crypto via SEC-licensed Thai exchanges: gains exempt 2568-2572 per
//     กฎกระทรวง ฉบับที่ 399 (พ.ศ. 2568) (a ministerial regulation, not a decree).
//   - Deposit interest: 15% final WHT (มาตรา 48(3)(ก)).
export const ASSET_TAX_RATES = {
  us_stock: 8, // US: no CGT for foreigners, ~15% div WHT; Thai tax on remittance
  etf: 8, // US-listed ETF, treated like US stocks
  th_stock: 3.5, // SET capital gains exempt; only ~10% dividend WHT
  crypto: 2, // licensed-exchange gains exempt 2568-2572 (small residual)
  gold: 0, // physical gold gains untaxed in practice (มาตรา 42(9) personal asset)
  thai_fund: 0, // RMF / Thai ESG / SSF gains tax-free if held to conditions
  cash: 15, // bank deposit interest 15% final WHT (small vs balance)
};

/**
 * Blend a suggested investment-tax rate from market values by asset type.
 * Value-weighted average of ASSET_TAX_RATES. Returns null if no value.
 * @param {Record<string, number>} valuesByType
 * @returns {number|null} percent, one decimal
 */
export function suggestInvestmentTax(valuesByType = {}) {
  let total = 0;
  let weighted = 0;
  for (const [type, value] of Object.entries(valuesByType)) {
    const v = Number(value) || 0;
    if (v <= 0) continue;
    const rate = ASSET_TAX_RATES[type] != null ? ASSET_TAX_RATES[type] : 10;
    total += v;
    weighted += v * rate;
  }
  if (total <= 0) return null;
  return Math.round((weighted / total) * 10) / 10;
}

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
 * The retirement spending need grows with inflation each year.
 *
 * Optional refinements (each a no-op at its default):
 *   contributionGrowthPct — contributions rise this % per year (salary raises /
 *     DCA step-ups) instead of staying flat.
 *   retireSpendPct — the retired lifestyle costs this % of today's spending
 *     (e.g. 80 = paid-off house / fewer obligations; 120 = more travel).
 *   pensionStartAge — pension income begins at this age (default: retirement;
 *     clamped to the drawdown phase — e.g. Thai SSO starts paying at 55+ but
 *     only matters here once spending starts).
 *   lumpSumAmount / lumpSumAge — a one-time addition at a given age
 *     (inheritance, property sale, PVD payout).
 *   careFromAge / careBumpPct — late-life care: from careFromAge the yearly
 *     spending need is (1 + careBumpPct/100) × the inflated base.
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
  const monthlyPensionToday = num(p.monthlyPensionToday);

  // Refinement inputs (defaults keep the old behavior exactly).
  const contribGrowth = (Number(p.contributionGrowthPct) || 0) / 100;
  const spendPct = Number(p.retireSpendPct) > 0 ? Number(p.retireSpendPct) / 100 : 1;
  const pensionStartAge = clampInt(p.pensionStartAge, retireAge, endAge, retireAge);
  const lumpSumAmount = num(p.lumpSumAmount);
  const lumpAgeRaw = Math.round(Number(p.lumpSumAge));
  const lumpSumAge =
    Number.isFinite(lumpAgeRaw) && lumpAgeRaw >= currentAge && lumpAgeRaw <= endAge ? lumpAgeRaw : null;
  const careFromAge = clampInt(p.careFromAge, retireAge, 120, RETIREMENT_DEFAULTS.careFromAge);
  const careBump = Math.max(0, Number(p.careBumpPct) || 0) / 100;

  // Spending base: today's spend scaled by the retirement replacement rate.
  const monthlyExpenseToday = num(p.monthlyExpenseToday) * spendPct;

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

    // One-time lump sum (inheritance / property sale / PVD payout) lands at the
    // start of its year, so it shows in this year's balance and growth.
    if (lumpSumAge != null && age === lumpSumAge && lumpSumAmount > 0) {
      balance += lumpSumAmount;
    }

    series.push({ age, balance: Math.max(0, balance), phase });

    // Earliest age at which assets could sustain the (inflated) lifestyle at the
    // SWR forever = "financial freedom" age. Pension offsets only once it pays.
    if (freedomAge == null && monthlyExpenseToday > 0) {
      const pensionNow = age >= pensionStartAge ? monthlyPensionToday : 0;
      const netMonthly = Math.max(0, monthlyExpenseToday - pensionNow);
      const fiNumberNow = (netMonthly * inflFactor * 12) / swr;
      if (fiNumberNow > 0 && balance >= fiNumberNow) freedomAge = age;
    }

    if (age === retireAge) {
      nestEggAtRetirement = Math.max(0, balance);
      monthlyExpenseAtRetirement = monthlyExpenseToday * inflFactor;
    }

    if (age >= endAge) break;

    if (phase === 'accumulate') {
      // Contributions step up each year with raises (flat when growth = 0).
      const contribThisYear = monthly * 12 * Math.pow(1 + contribGrowth, age - currentAge);
      balance = balance * (1 + rPreNet) + contribThisYear;
    } else {
      const careFactor = age >= careFromAge ? 1 + careBump : 1;
      const expenseThisYear = monthlyExpenseToday * inflFactor * 12 * careFactor;
      const pensionThisYear = age >= pensionStartAge ? monthlyPensionToday * inflFactor * 12 : 0;
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
  // Pension offsets the freedom number only if it is already paying at retirement.
  const annualPensionAtRetirement =
    pensionStartAge <= retireAge ? monthlyPensionToday * Math.pow(1 + infl, retireAge - currentAge) * 12 : 0;
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
