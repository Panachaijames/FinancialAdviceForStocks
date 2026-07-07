// Unit tests for the Thai personal income tax calculator (ปีภาษี 2568).
// Run with:  npm test   (node --test client/test/)
//
// Every expected value below is hand-computed from the statutory rules:
//   - Progressive brackets per the Revenue Code tariff (มาตรา 48(1)) with the
//     first 150,000 exempt (พระราชกฤษฎีกา ฉบับที่ 470 พ.ศ. 2551).
//   - 50% expenses capped at 100,000 for 40(1) income (มาตรา 42 ทวิ).
//   - Allowance caps per มาตรา 47 and the 2568 investment/stimulus measures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcThaiTax2568, applyBrackets, TAX_BRACKETS, TAX_LIMITS } from '../src/lib/thaiTax.js';

// ── applyBrackets: the progressive ladder itself ────────────────────────────

test('brackets: boundary values at every statutory step', () => {
  const cases = [
    [0, 0],
    [150000, 0], // first 150k exempt
    [300000, 7500], // + 150k @ 5%
    [500000, 27500], // + 200k @ 10%
    [750000, 65000], // + 250k @ 15%
    [1000000, 115000], // + 250k @ 20%
    [2000000, 365000], // + 1M @ 25%
    [5000000, 1265000], // + 3M @ 30%
    [6000000, 1615000], // + 1M @ 35%
  ];
  for (const [taxable, expected] of cases) {
    assert.equal(applyBrackets(taxable).tax, expected, `taxable ${taxable}`);
  }
});

test('brackets: per-step detail sums to the total', () => {
  const { tax, steps } = applyBrackets(3456789);
  const sum = steps.reduce((s, x) => s + x.tax, 0);
  assert.ok(Math.abs(sum - tax) < 1e-6);
  // slices must partition the taxable income exactly
  const covered = steps.reduce((s, x) => s + x.taxable, 0);
  assert.equal(covered, 3456789);
});

test('brackets: table matches the statutory rates', () => {
  assert.deepEqual(
    TAX_BRACKETS.map((b) => b.rate),
    [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35]
  );
});

// ── calcThaiTax2568: whole-return scenarios ─────────────────────────────────

test('salary 800,000, no extras: expenses 100k + personal 60k -> tax 48,500', () => {
  const r = calcThaiTax2568({ income: 800000 });
  assert.equal(r.expenses, 100000); // min(50% of 800k, 100k)
  assert.equal(r.incomeAfterExpenses, 700000);
  assert.equal(r.totalDeductions, 60000); // personal allowance only
  assert.equal(r.taxableIncome, 640000);
  // 27,500 (to 500k) + 140,000 * 15% = 48,500
  assert.equal(r.tax, 48500);
  assert.equal(r.netTax, 48500);
  assert.ok(Math.abs(r.effectiveRate - 6.0625) < 1e-9);
});

test('low income 300,000: expenses + personal allowance wipe out the tax', () => {
  const r = calcThaiTax2568({ income: 300000 });
  assert.equal(r.expenses, 100000);
  assert.equal(r.taxableIncome, 140000); // 200,000 - 60,000
  assert.equal(r.tax, 0); // inside the exempt 150k band
});

test('income 100,000: 50% expense rule (not the cap) applies', () => {
  const r = calcThaiTax2568({ income: 100000 });
  assert.equal(r.expenses, 50000); // 50% < 100k cap
  assert.equal(r.taxableIncome, 0); // 50,000 - 60,000 clamps at 0
  assert.equal(r.tax, 0);
});

test('withholding beyond the liability yields a refund (negative net)', () => {
  const r = calcThaiTax2568({ income: 800000, withholding: 60000 });
  assert.equal(r.tax, 48500);
  assert.equal(r.netTax, -11500);
});

test('per-field caps: SS 9k, health 25k, life+health 100k, parent health 15k, maternity 60k', () => {
  const r = calcThaiTax2568({
    income: 1000000,
    socialSecurity: 20000, // cap 9,000
    healthInsurance: 50000, // cap 25,000
    lifeInsurance: 90000, // 90k + 25k = 115k -> combined cap 100,000
    parentHealthInsurance: 30000, // cap 15,000
    maternity: 100000, // cap 60,000
  });
  const byLabel = Object.fromEntries(r.deductionItems.map((it) => [it.label, it.value]));
  assert.equal(byLabel['ประกันสังคม'], TAX_LIMITS.socialSecurity);
  assert.equal(byLabel['เบี้ยประกันชีวิต + สุขภาพตนเอง'], TAX_LIMITS.lifeAndHealthCombined);
  assert.equal(byLabel['เบี้ยประกันสุขภาพบิดามารดา'], TAX_LIMITS.parentHealthInsurance);
  assert.equal(byLabel['ค่าฝากครรภ์และคลอดบุตร'], TAX_LIMITS.maternity);
  // 60k personal + 9k + 100k + 15k + 60k = 244,000
  assert.equal(r.deductionsBeforeDonation, 244000);
  assert.equal(r.taxableIncome, 900000 - 244000); // 656,000
  assert.equal(r.tax, 27500 + 156000 * 0.15); // 50,900
});

test('retirement group: annuity limited to 200k with life insurance present; group capped at 500k', () => {
  const r = calcThaiTax2568({
    income: 2000000,
    lifeInsurance: 50000,
    annuity: 300000, // 15% = 300k but annuityMax 200k -> 200,000
    rmf: 700000, // min(30% = 600k, cap 500k) -> 500,000
    pvd: 100000,
    // 200k + 500k + 100k = 800k -> combined retirement cap 500,000
  });
  const byLabel = Object.fromEntries(r.deductionItems.map((it) => [it.label, it.value]));
  assert.equal(byLabel['กลุ่มเกษียณ (บำนาญ, RMF, PVD/กบข.)'], TAX_LIMITS.retirementCombined);
  // personal 60k + life 50k + retirement 500k = 610,000
  assert.equal(r.deductionsBeforeDonation, 610000);
  assert.equal(r.taxableIncome, 1900000 - 610000); // 1,290,000
  assert.equal(r.tax, 115000 + 290000 * 0.25); // 187,500
});

test('annuity edge case: with NO life/health premiums the annuity ceiling rises to 300k', () => {
  const r = calcThaiTax2568({ income: 2000000, annuity: 300000 });
  const byLabel = Object.fromEntries(r.deductionItems.map((it) => [it.label, it.value]));
  assert.equal(byLabel['กลุ่มเกษียณ (บำนาญ, RMF, PVD/กบข.)'], 300000);
  assert.equal(r.taxableIncome, 1900000 - 360000); // 1,540,000
  assert.equal(r.tax, 115000 + 540000 * 0.25); // 250,000
});

test('donations: special counts double, both bounded by the 10% cap', () => {
  const r = calcThaiTax2568({
    income: 1000000,
    donationGeneral: 100000,
    donationSpecial: 30000,
  });
  // after expenses 900k - personal 60k = 840k -> cap 84,000
  // special 30k x2 = 60,000; remaining cap 24,000 limits general to 24,000
  assert.equal(r.totalDonation, 84000);
  assert.equal(r.taxableIncome, 840000 - 84000); // 756,000
  assert.equal(r.tax, 65000 + 6000 * 0.2); // 66,200
});

test('family counts: children, parents capped at 4, disabled, spouse', () => {
  const r = calcThaiTax2568({
    income: 1000000,
    spouse: true,
    child1: 1, // 30,000
    child2: 2, // 2 x 60,000
    parents: 5, // capped at 4 x 30,000
    disabled: 1, // 60,000
  });
  // 60k + 60k + 30k + 120k + 120k + 60k = 450,000
  assert.equal(r.deductionsBeforeDonation, 450000);
  assert.equal(r.taxableIncome, 450000);
  assert.equal(r.tax, 7500 + 15000); // 22,500
});

test('Thai ESG / ESGX: each capped at 30% of income and 300k', () => {
  const r = calcThaiTax2568({
    income: 1000000,
    thaiEsg: 400000, // -> 300,000
    thaiEsgxNew: 350000, // -> 300,000
    thaiEsgxLtf: 350000, // -> 300,000 (no income-% test on the LTF switch)
  });
  const byLabel = Object.fromEntries(r.deductionItems.map((it) => [it.label, it.value]));
  assert.equal(byLabel['กองทุน Thai ESG'], 300000);
  assert.equal(byLabel['Thai ESGX (ลงทุนใหม่)'], 300000);
  assert.equal(byLabel['Thai ESGX (จาก LTF)'], 300000);
});

test('RMF alone: 30% of income binds before the 500k cap', () => {
  const r = calcThaiTax2568({ income: 1000000, rmf: 500000 });
  const byLabel = Object.fromEntries(r.deductionItems.map((it) => [it.label, it.value]));
  assert.equal(byLabel['กลุ่มเกษียณ (บำนาญ, RMF, PVD/กบข.)'], 300000); // 30% of 1M
});

test('garbage inputs are treated as zero', () => {
  const r = calcThaiTax2568({ income: 'abc', rmf: -5, withholding: null });
  assert.equal(r.income, 0);
  assert.equal(r.tax, 0);
  assert.equal(r.netTax, 0);
  assert.equal(r.effectiveRate, 0);
});

test('Easy E-Receipt 2.0: general spending alone caps at 30,000 (MR 397)', () => {
  const r = calcThaiTax2568({ income: 1000000, easyEReceipt: 80000 });
  const byLabel = Object.fromEntries(r.deductionItems.map((it) => [it.label, it.value]));
  assert.equal(byLabel['Easy E-Receipt 2.0'], TAX_LIMITS.easyEReceiptGeneral); // 30,000
});

test('Easy E-Receipt 2.0: OTOP tops up to the 50,000 total (and can fill the general bucket)', () => {
  // general 25k + OTOP 30k -> 25k + min(30k, remaining) = 50,000 total
  const r1 = calcThaiTax2568({ income: 1000000, easyEReceipt: 25000, easyEReceiptOtop: 30000 });
  const b1 = Object.fromEntries(r1.deductionItems.map((it) => [it.label, it.value]));
  assert.equal(b1['Easy E-Receipt 2.0'], TAX_LIMITS.easyEReceipt); // 50,000
  // OTOP-only spending may occupy both buckets: capped at 50,000
  const r2 = calcThaiTax2568({ income: 1000000, easyEReceiptOtop: 60000 });
  const b2 = Object.fromEntries(r2.deductionItems.map((it) => [it.label, it.value]));
  assert.equal(b2['Easy E-Receipt 2.0'], TAX_LIMITS.easyEReceipt); // 50,000
  // small amounts pass through un-capped
  const r3 = calcThaiTax2568({ income: 1000000, easyEReceipt: 10000, easyEReceiptOtop: 5000 });
  const b3 = Object.fromEntries(r3.deductionItems.map((it) => [it.label, it.value]));
  assert.equal(b3['Easy E-Receipt 2.0'], 15000);
});

test('home loan interest caps at 100,000', () => {
  const r = calcThaiTax2568({ income: 1000000, homeLoan: 150000 });
  const byLabel = Object.fromEntries(r.deductionItems.map((it) => [it.label, it.value]));
  assert.equal(byLabel['ดอกเบี้ยกู้ยืมเพื่อที่อยู่อาศัย'], TAX_LIMITS.homeLoan); // 100,000
});
