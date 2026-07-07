// Thai personal income tax calculator — ปีภาษี 2568 (2025).
//
// Pure, framework-free port of the user-provided calculator so it can be unit
// tested and reused. Mirrors the official progressive brackets and the common
// allowances/deductions for a salaried filer (เงินได้ประเภท 40(1)). Amounts in THB.
//
// Every rule here is unit-tested (client/test/thaiTax.test.mjs) and mapped to
// its statutory basis in ./thaiTaxLaw.js (Revenue Code sections, royal decrees,
// ministerial regulations — web-verified against rd.go.th in July 2026). This
// is an estimate to help planning — always confirm against the Revenue Department.

/** Progressive brackets (อัตราก้าวหน้า). `upTo` is the cumulative ceiling. */
export const TAX_BRACKETS = [
  { upTo: 150000, rate: 0.0 },
  { upTo: 300000, rate: 0.05 },
  { upTo: 500000, rate: 0.1 },
  { upTo: 750000, rate: 0.15 },
  { upTo: 1000000, rate: 0.2 },
  { upTo: 2000000, rate: 0.25 },
  { upTo: 5000000, rate: 0.3 },
  { upTo: Infinity, rate: 0.35 },
];

/** Per-field caps so the UI can show "สูงสุด …" hints and warn on overflow. */
export const TAX_LIMITS = {
  maternity: 60000,
  socialSecurity: 9000,
  healthInsurance: 25000,
  parentHealthInsurance: 15000,
  lifeAndHealthCombined: 100000,
  annuityMax: 200000,
  annuityRate: 0.15,
  rmfMax: 500000,
  rmfRate: 0.3,
  retirementCombined: 500000,
  thaiEsgMax: 300000,
  thaiEsgRate: 0.3,
  thaiEsgxNewMax: 300000,
  thaiEsgxLtfMax: 300000,
  easyEReceipt: 50000, // total cap
  easyEReceiptGeneral: 30000, // general goods/services sub-cap within the total
  homeLoan: 100000,
  expensesMax: 100000,
  donationRate: 0.1,
};

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};

/**
 * Compute Thai income tax for tax year 2568.
 * @param {object} input — all amounts in THB; `spouse` is boolean, the *count*
 *   fields (child1, child2, parents, disabled) are integer counts.
 * @returns {object} full breakdown: expenses, deduction line items, taxable
 *   income, progressive tax, withholding, net, and per-bracket steps.
 */
export function calcThaiTax2568(input = {}) {
  const income = n(input.income);
  const withholding = n(input.withholding);
  const L = TAX_LIMITS;

  // 1) Expenses — 50% of income, capped at 100,000.
  const expenses = Math.min(income * 0.5, L.expensesMax);
  const incomeAfterExpenses = income - expenses;

  // 2) Allowances & deductions (ค่าลดหย่อน) — before donations.
  const items = [];
  const add = (label, value) => {
    if (value > 0) items.push({ label, value });
    return value;
  };

  const personal = add('ค่าลดหย่อนส่วนตัว', 60000);
  const spouse = add('คู่สมรส (ไม่มีเงินได้)', input.spouse ? 60000 : 0);
  const child1 = add('บุตรคนแรก', Math.max(0, Math.floor(n(input.child1))) * 30000);
  const child2 = add('บุตรคนที่ 2 ขึ้นไป (เกิดปี 2561+)', Math.max(0, Math.floor(n(input.child2))) * 60000);
  const parents = add('อุปการะบิดามารดา', Math.min(Math.floor(n(input.parents)), 4) * 30000);
  const disabled = add('อุปการะผู้พิการ/ทุพพลภาพ', Math.max(0, Math.floor(n(input.disabled))) * 60000);
  const maternity = add('ค่าฝากครรภ์และคลอดบุตร', Math.min(n(input.maternity), L.maternity));

  const socialSecurity = add('ประกันสังคม', Math.min(n(input.socialSecurity), L.socialSecurity));

  // Life + own-health insurance share one 100,000 cap (health alone ≤ 25,000).
  const lifeIns = n(input.lifeInsurance);
  const healthIns = Math.min(n(input.healthInsurance), L.healthInsurance);
  const lifeAndHealth = add('เบี้ยประกันชีวิต + สุขภาพตนเอง', Math.min(lifeIns + healthIns, L.lifeAndHealthCombined));

  const parentHealth = add('เบี้ยประกันสุขภาพบิดามารดา', Math.min(n(input.parentHealthInsurance), L.parentHealthInsurance));

  // Retirement group — annuity (≤15% & ≤200k), RMF (≤30% & ≤500k), PVD/GPF;
  // the three together are capped at 500,000.
  // Edge case: if NO general life/health insurance is claimed, annuity premiums
  // may fill the unused 100,000 general-life slot, raising the ceiling to 300,000.
  const annuityMax = lifeIns + healthIns === 0 ? L.annuityMax + L.lifeAndHealthCombined : L.annuityMax;
  const annuity = Math.min(n(input.annuity), income * L.annuityRate, annuityMax);
  const rmf = Math.min(n(input.rmf), income * L.rmfRate, L.rmfMax);
  const pvd = n(input.pvd);
  const retirement = add(
    'กลุ่มเกษียณ (บำนาญ, RMF, PVD/กบข.)',
    Math.min(annuity + rmf + pvd, L.retirementCombined)
  );

  const thaiEsg = add('กองทุน Thai ESG', Math.min(n(input.thaiEsg), income * L.thaiEsgRate, L.thaiEsgMax));
  const thaiEsgxNew = add('Thai ESGX (ลงทุนใหม่)', Math.min(n(input.thaiEsgxNew), income * L.thaiEsgRate, L.thaiEsgxNewMax));
  const thaiEsgxLtf = add('Thai ESGX (จาก LTF)', Math.min(n(input.thaiEsgxLtf), L.thaiEsgxLtfMax));

  // Easy E-Receipt 2.0 (16 ม.ค. – 28 ก.พ. 2568): general goods/services cap
  // 30,000; OTOP/community/social-enterprise spending may add up to the 50,000
  // total (and may also fill the general bucket) — กฎกระทรวง ฉบับที่ 397 (พ.ศ. 2568).
  const eReceiptGeneral = Math.min(n(input.easyEReceipt), L.easyEReceiptGeneral);
  const easyEReceipt = add(
    'Easy E-Receipt 2.0',
    Math.min(eReceiptGeneral + n(input.easyEReceiptOtop), L.easyEReceipt)
  );
  const homeLoan = add('ดอกเบี้ยกู้ยืมเพื่อที่อยู่อาศัย', Math.min(n(input.homeLoan), L.homeLoan));

  const deductionsBeforeDonation =
    personal + spouse + child1 + child2 + parents + disabled + maternity +
    socialSecurity + lifeAndHealth + parentHealth + retirement +
    thaiEsg + thaiEsgxNew + thaiEsgxLtf + easyEReceipt + homeLoan;

  // 3) Donations — capped at 10% of income after expenses & deductions.
  // Special (education/sports/public hospitals) counts double, within the cap.
  const taxableBeforeDonation = Math.max(0, incomeAfterExpenses - deductionsBeforeDonation);
  const donationCap = taxableBeforeDonation * L.donationRate;
  const deductibleSpecial = Math.min(n(input.donationSpecial) * 2, donationCap);
  const remainingCap = Math.max(0, donationCap - deductibleSpecial);
  const deductibleGeneral = Math.min(n(input.donationGeneral), remainingCap);
  const totalDonation = deductibleSpecial + deductibleGeneral;
  add('เงินบริจาค (หลังคำนวณสิทธิ)', totalDonation);

  // 4) Net taxable income → progressive tax.
  const totalDeductions = deductionsBeforeDonation + totalDonation;
  const taxableIncome = Math.max(0, incomeAfterExpenses - totalDeductions);

  const { tax, steps } = applyBrackets(taxableIncome);
  const netTax = tax - withholding;

  return {
    income,
    expenses,
    incomeAfterExpenses,
    deductionItems: items,
    deductionsBeforeDonation,
    totalDonation,
    totalDeductions,
    taxableIncome,
    tax,
    withholding,
    netTax, // > 0 owe more, < 0 refund, 0 settled
    steps,
    effectiveRate: income > 0 ? (tax / income) * 100 : 0,
  };
}

/** Apply the progressive brackets, returning total tax + per-bracket detail. */
export function applyBrackets(taxableIncome) {
  let tax = 0;
  let lower = 0;
  const steps = [];
  for (const b of TAX_BRACKETS) {
    if (taxableIncome <= lower) break;
    const slice = Math.min(taxableIncome, b.upTo) - lower;
    const taxInBracket = slice * b.rate;
    tax += taxInBracket;
    steps.push({
      from: lower,
      to: b.upTo,
      rate: b.rate,
      taxable: slice,
      tax: taxInBracket,
    });
    lower = b.upTo;
  }
  return { tax, steps };
}
