// Sanity tests for the planning + retirement math (pure functions).
// Run with:  npm test   (node --test client/test/)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectFutureValue, requiredMonthly } from '../src/lib/planning.js';
import { projectRetirement, suggestInvestmentTax, ASSET_TAX_RATES } from '../src/lib/retirement.js';

// ── planning.js ─────────────────────────────────────────────────────────────

test('projectFutureValue: lump sum compounds monthly', () => {
  const { finalValue, totalInvested } = projectFutureValue({
    principal: 1000,
    monthly: 0,
    annualReturnPct: 12, // 1%/month
    years: 1,
  });
  assert.ok(Math.abs(finalValue - 1000 * Math.pow(1.01, 12)) < 1e-9);
  assert.equal(totalInvested, 1000);
});

test('projectFutureValue: zero return is plain accumulation', () => {
  const { finalValue, totalInvested, gain } = projectFutureValue({
    principal: 500,
    monthly: 100,
    annualReturnPct: 0,
    years: 2,
  });
  assert.equal(finalValue, 500 + 100 * 24);
  assert.equal(totalInvested, 2900);
  assert.equal(gain, 0);
});

test('requiredMonthly: zero-rate case is simple division; solved rate reaches target', () => {
  assert.equal(requiredMonthly({ principal: 0, target: 1200, annualReturnPct: 0, years: 1 }), 100);
  assert.equal(requiredMonthly({ principal: 0, target: 100, annualReturnPct: 5, years: 0 }), null);
  // principal alone already covers the target
  assert.equal(requiredMonthly({ principal: 2000, target: 1000, annualReturnPct: 0, years: 1 }), 0);
  // round-trip: contributing the solved amount hits the target
  const m = requiredMonthly({ principal: 10000, target: 100000, annualReturnPct: 7, years: 10 });
  const { finalValue } = projectFutureValue({ principal: 10000, monthly: m, annualReturnPct: 7, years: 10 });
  assert.ok(Math.abs(finalValue - 100000) < 1); // within 1 unit of currency
});

// ── retirement.js ───────────────────────────────────────────────────────────

test('suggestInvestmentTax: value-weighted blend of per-asset rates', () => {
  assert.equal(suggestInvestmentTax({ us_stock: 100 }), ASSET_TAX_RATES.us_stock);
  // 50/50 US (8) + TH (3.5) = 5.75 -> rounded to 5.8
  assert.equal(suggestInvestmentTax({ us_stock: 50, th_stock: 50 }), 5.8);
  assert.equal(suggestInvestmentTax({ mystery_type: 100 }), 10); // unknown type default
  assert.equal(suggestInvestmentTax({}), null);
  assert.equal(suggestInvestmentTax({ us_stock: 0 }), null);
});

test('projectRetirement: money that cannot cover spending depletes and is flagged', () => {
  const r = projectRetirement({
    currentAge: 59,
    retireAge: 60,
    endAge: 62,
    currentSavings: 100000,
    monthlyContribution: 0,
    monthlyExpenseToday: 10000, // 120k/yr from age 60
    preReturnPct: 0,
    postReturnPct: 0,
    inflationPct: 0,
    swrPct: 4,
    investmentTaxPct: 0,
  });
  assert.equal(r.nestEggAtRetirement, 100000);
  assert.equal(r.onTrack, false);
  assert.equal(r.depletionAge, 61); // 100k - 120k goes negative in the first drawdown year
  assert.equal(r.balanceAtEnd, 0);
});

test('projectRetirement: pension covering all spending never depletes', () => {
  const r = projectRetirement({
    currentAge: 50,
    retireAge: 60,
    endAge: 85,
    currentSavings: 1000000,
    monthlyContribution: 0,
    monthlyExpenseToday: 20000,
    monthlyPensionToday: 25000, // pension > spending
    preReturnPct: 0,
    postReturnPct: 0,
    inflationPct: 2,
    swrPct: 4,
  });
  assert.equal(r.onTrack, true);
  assert.equal(r.depletionAge, null);
  assert.equal(r.balanceAtEnd, 1000000); // untouched
});

test('projectRetirement: investment tax drags the effective return', () => {
  const taxed = projectRetirement({
    currentAge: 30, retireAge: 40, endAge: 41,
    currentSavings: 1000000, monthlyContribution: 0,
    monthlyExpenseToday: 0, preReturnPct: 10, postReturnPct: 0,
    inflationPct: 0, swrPct: 4, investmentTaxPct: 50,
  });
  const untaxed = projectRetirement({
    currentAge: 30, retireAge: 40, endAge: 41,
    currentSavings: 1000000, monthlyContribution: 0,
    monthlyExpenseToday: 0, preReturnPct: 10, postReturnPct: 0,
    inflationPct: 0, swrPct: 4, investmentTaxPct: 0,
  });
  // 50% tax on gains => effective 5% vs 10%
  assert.ok(Math.abs(taxed.nestEggAtRetirement - 1000000 * Math.pow(1.05, 10)) < 1);
  assert.ok(Math.abs(untaxed.nestEggAtRetirement - 1000000 * Math.pow(1.10, 10)) < 1);
});

test('projectRetirement: freedom number = net annual need / SWR', () => {
  const r = projectRetirement({
    currentAge: 30, retireAge: 60, endAge: 85,
    currentSavings: 0, monthlyContribution: 0,
    monthlyExpenseToday: 30000, monthlyPensionToday: 0,
    preReturnPct: 0, postReturnPct: 0, inflationPct: 0, swrPct: 4,
  });
  // 30k/mo * 12 / 4% = 9,000,000 (no inflation)
  assert.equal(r.freedomNumber, 9000000);
});

// ── refinement variables (all default to the old behavior) ─────────────────

test('contribution growth: yearly step-up compounds the contributions', () => {
  const r = projectRetirement({
    currentAge: 30, retireAge: 32, endAge: 33,
    currentSavings: 0, monthlyContribution: 1000,
    monthlyExpenseToday: 0, preReturnPct: 0, postReturnPct: 0,
    inflationPct: 0, swrPct: 4, contributionGrowthPct: 10,
  });
  // year 30: 12,000 * 1.1^0; year 31: 12,000 * 1.1^1 -> 25,200 at 32
  assert.ok(Math.abs(r.nestEggAtRetirement - 25200) < 1e-6);
});

test('retireSpendPct scales the retirement lifestyle (and the freedom number)', () => {
  const r = projectRetirement({
    currentAge: 30, retireAge: 60, endAge: 85,
    currentSavings: 0, monthlyContribution: 0,
    monthlyExpenseToday: 20000, retireSpendPct: 50,
    preReturnPct: 0, postReturnPct: 0, inflationPct: 0, swrPct: 4,
  });
  // 20k * 50% = 10k/mo -> 120k/yr / 4% = 3,000,000
  assert.equal(r.freedomNumber, 3000000);
  assert.equal(r.monthlyExpenseAtRetirement, 10000);
});

test('lump sum lands once at its age; unset age is ignored', () => {
  const withLump = projectRetirement({
    currentAge: 30, retireAge: 41, endAge: 42,
    currentSavings: 0, monthlyContribution: 0, monthlyExpenseToday: 0,
    preReturnPct: 0, postReturnPct: 0, inflationPct: 0, swrPct: 4,
    lumpSumAmount: 50000, lumpSumAge: 40,
  });
  assert.equal(withLump.nestEggAtRetirement, 50000);
  const noAge = projectRetirement({
    currentAge: 30, retireAge: 41, endAge: 42,
    currentSavings: 0, monthlyContribution: 0, monthlyExpenseToday: 0,
    preReturnPct: 0, postReturnPct: 0, inflationPct: 0, swrPct: 4,
    lumpSumAmount: 50000, // no lumpSumAge -> never applied
  });
  assert.equal(noAge.nestEggAtRetirement, 0);
});

test('late-life care bump raises spending from careFromAge', () => {
  const r = projectRetirement({
    currentAge: 59, retireAge: 60, endAge: 63,
    currentSavings: 500000, monthlyContribution: 0,
    monthlyExpenseToday: 10000, preReturnPct: 0, postReturnPct: 0,
    inflationPct: 0, swrPct: 4, careFromAge: 61, careBumpPct: 50,
  });
  // draw at 60: 120k; at 61 and 62: 180k each -> 500k - 480k = 20k left
  assert.equal(r.onTrack, true);
  assert.ok(Math.abs(r.balanceAtEnd - 20000) < 1e-6);
});

test('pensionStartAge delays the pension offset', () => {
  const base = {
    currentAge: 59, retireAge: 60, endAge: 63,
    currentSavings: 250000, monthlyContribution: 0,
    monthlyExpenseToday: 10000, monthlyPensionToday: 10000,
    preReturnPct: 0, postReturnPct: 0, inflationPct: 0, swrPct: 4,
  };
  // pension from 62: years 60,61 cost 120k each, year 62 is fully covered
  const delayed = projectRetirement({ ...base, pensionStartAge: 62 });
  assert.equal(delayed.onTrack, true);
  assert.ok(Math.abs(delayed.balanceAtEnd - 10000) < 1e-6);
  // pension from retirement (default): nothing is ever drawn
  const immediate = projectRetirement(base);
  assert.equal(immediate.balanceAtEnd, 250000);
  // a delayed pension must not shrink the freedom number
  assert.ok(delayed.freedomNumber > immediate.freedomNumber);
});
