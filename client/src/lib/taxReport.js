// Yearly investment-tax report built from the trade ledger — groups realized
// P/L by asset class and attaches the Thai tax treatment of each class (same
// legal bases as thaiTaxLaw.js / retirement.js, verified July 2026). Amounts
// stay in each transaction's native currency; the UI converts for display.
// Informational only — not tax advice.

import { classify } from './assetType.js';

/**
 * Thai tax treatment per asset class for a Thai tax-resident INDIVIDUAL
 * investor. `taxable`: 'no' | 'conditional' | 'yes' drives the badge color.
 */
export const TAX_TREATMENT = {
  th_stock: {
    label: 'หุ้นไทย (SET)',
    taxable: 'no',
    note: 'กำไรจากการขายหุ้นในตลาดหลักทรัพย์ฯ ได้รับยกเว้นภาษี (ขายผ่านตลาดเท่านั้น — ขายนอกตลาดไม่ยกเว้น)',
    law: 'กฎกระทรวง ฉบับที่ 126 ข้อ 2(23) ตามมาตรา 42(17)',
    url: 'https://www.rd.go.th/2502.html',
  },
  us_stock: {
    label: 'หุ้นสหรัฐฯ',
    taxable: 'conditional',
    note: 'สหรัฐฯ ไม่เก็บ capital gains จากผู้ลงทุนต่างชาติ แต่ไทยเก็บเมื่อ "นำเงินได้กลับเข้าไทย" (ป. 161/162/2566 — เงินได้ตั้งแต่ปี 2567 เสียภาษีเมื่อนำเข้า ไม่ว่าปีใด)',
    law: 'มาตรา 41 วรรคสอง; คำสั่งกรมสรรพากร ป. 161/2566 และ ป. 162/2566',
    url: 'https://www.rd.go.th/21221.html',
  },
  etf: {
    label: 'ETF สหรัฐฯ',
    taxable: 'conditional',
    note: 'เช่นเดียวกับหุ้นสหรัฐฯ — ไทยเก็บภาษีเมื่อนำเงินได้กลับเข้าไทย (ป. 161/162/2566)',
    law: 'มาตรา 41 วรรคสอง; ป. 161/2566, ป. 162/2566',
    url: 'https://www.rd.go.th/21221.html',
  },
  crypto: {
    label: 'คริปโทฯ',
    taxable: 'conditional',
    note: 'กำไรจากการขายผ่าน exchange ไทยที่ได้รับใบอนุญาต ก.ล.ต. ยกเว้นภาษี ปี 2568–2572 — ขายผ่านแพลตฟอร์มต่างประเทศ/P2P ยังต้องเสีย',
    law: 'กฎกระทรวง ฉบับที่ 399 (พ.ศ. 2568)',
    url: 'https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/mr399.pdf',
  },
  gold: {
    label: 'ทองคำ',
    taxable: 'no',
    note: 'ทองคำแท่ง/รูปพรรณที่ถือเป็นทรัพย์สินส่วนตัว ตามแนวปฏิบัติทั่วไปไม่ถูกเก็บภาษีกำไร (การเทรดถี่เชิงธุรกิจอาจเป็นเงินได้ 40(8))',
    law: 'มาตรา 42(9) แห่งประมวลรัษฎากร',
    url: 'https://www.rd.go.th/5937.html',
  },
  thai_fund: {
    label: 'กองทุนไทย',
    taxable: 'conditional',
    note: 'RMF / Thai ESG / SSF ขายตามเงื่อนไขครบ = ยกเว้นภาษี; ผิดเงื่อนไขต้องคืนสิทธิและเสียภาษีกำไร',
    law: 'กฎกระทรวง ฉบับที่ 126 ข้อ 2(55) และประกาศอธิบดีฯ ที่เกี่ยวข้อง',
    url: 'https://www.rd.go.th/28369.html',
  },
  other: {
    label: 'อื่น ๆ',
    taxable: 'conditional',
    note: 'ตรวจสอบประเภทเงินได้กับกรมสรรพากร',
    law: '—',
    url: 'https://www.rd.go.th',
  },
};

/** Static notes on dividend withholding (not computed from the ledger). */
export const DIVIDEND_NOTES = [
  {
    label: 'เงินปันผลหุ้นไทย',
    note: 'หัก ณ ที่จ่าย 10% เลือกเป็น final ได้ (ไม่ต้องรวมคำนวณปลายปี) หรือรวมคำนวณเพื่อใช้เครดิตภาษีเงินปันผล',
    law: 'มาตรา 50(2)(จ), 48(3) วรรคสอง, 47 ทวิ',
  },
  {
    label: 'เงินปันผลหุ้นสหรัฐฯ',
    note: 'สหรัฐฯ หัก 15% ตามอนุสัญญาภาษีซ้อนไทย–สหรัฐฯ (ยื่น W-8BEN กับโบรกเกอร์) — ฝั่งไทยเก็บเมื่อนำกลับเข้าไทย',
    law: 'US–Thai DTA Art. 10(2)(b); ป. 161/2566',
  },
];

const yearOf = (iso) => {
  const y = Number(String(iso || '').slice(0, 4));
  return Number.isFinite(y) && y > 1970 ? y : null;
};

/** Distinct years (desc) that have at least one SELL in the ledger. */
export function sellYears(transactions = []) {
  const years = new Set();
  for (const t of transactions || []) {
    if (t && t.side === 'sell') {
      const y = yearOf(t.at);
      if (y) years.add(y);
    }
  }
  return Array.from(years).sort((a, b) => b - a);
}

/**
 * Build the report for one calendar year.
 * @param {Array} transactions — ledger entries ({ side, symbol, type?, realized, currency, at })
 * @param {number} year
 * @returns {{ year:number, groups:Array, sellCount:number }}
 *   groups: [{ type, treatment, sellCount, byCurrency: {USD: n}, }] sorted by |realized| desc
 */
export function buildTaxReport(transactions = [], year) {
  const groups = new Map();
  let sellCount = 0;
  for (const t of transactions || []) {
    if (!t || t.side !== 'sell' || yearOf(t.at) !== year) continue;
    const r = Number(t.realized);
    if (!Number.isFinite(r)) continue;
    sellCount += 1;
    // Older ledger entries predate the `type` field — classify by symbol.
    const type = t.type || classify(t.symbol);
    const key = TAX_TREATMENT[type] ? type : 'other';
    if (!groups.has(key)) groups.set(key, { type: key, treatment: TAX_TREATMENT[key], sellCount: 0, byCurrency: {} });
    const g = groups.get(key);
    g.sellCount += 1;
    const cur = t.currency || 'USD';
    g.byCurrency[cur] = (g.byCurrency[cur] || 0) + r;
  }
  const list = Array.from(groups.values()).sort((a, b) => {
    const mag = (g) => Object.values(g.byCurrency).reduce((s, v) => s + Math.abs(v), 0);
    return mag(b) - mag(a);
  });
  return { year, groups: list, sellCount };
}

export default { TAX_TREATMENT, DIVIDEND_NOTES, sellYears, buildTaxReport };
