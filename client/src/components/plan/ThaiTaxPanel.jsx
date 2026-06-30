import React, { useMemo, useState } from 'react';
import { Calculator, ChevronDown, ChevronUp, Download } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { fmtMoney } from '../../lib/format.js';
import { calcThaiTax2568, TAX_LIMITS } from '../../lib/thaiTax.js';
import useFunds from '../../hooks/useFunds.js';
import { PanelHeader } from './SavingsPanel.jsx';

/**
 * Classify a tracked Thai fund into a tax-deduction bucket by its name/abbr.
 * SSF is intentionally excluded — new SSF purchases are not deductible for 2568.
 */
function fundBucket(f) {
  const s = `${f.abbr || ''} ${f.name || ''}`.toUpperCase();
  if (s.includes('ESGX')) return 'thaiEsgxNew';
  if (s.includes('ESG')) return 'thaiEsg';
  if (s.includes('RMF')) return 'rmf';
  return null;
}

const baht = (v) => fmtMoney(v, 'THB');

const labelStyle = {
  fontSize: 12,
  color: theme.colors.textDim,
  fontWeight: 600,
  display: 'block',
  marginBottom: 4,
};
const hintStyle = { fontSize: 10.5, color: theme.colors.textFaint, marginTop: 3 };
const sectionTitle = {
  fontSize: 12,
  fontWeight: 700,
  color: theme.colors.accent,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  marginBottom: theme.space(1),
};

/** A labelled number input with an optional cap hint + over-cap warning. */
function Field({ label, value, onChange, placeholder = 'กรอกจำนวนเงิน', hint, max, step = 'any', integer = false }) {
  const num = Number(value);
  const over = max != null && Number.isFinite(num) && num > max;
  return (
    <label style={{ display: 'block' }}>
      <span style={labelStyle}>{label}</span>
      <input
        className="input"
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        step={integer ? '1' : step}
        min="0"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={over ? { borderColor: theme.colors.down } : undefined}
      />
      {over ? (
        <div style={{ ...hintStyle, color: theme.colors.down }}>
          เกินสิทธิ — ใช้ได้สูงสุด {Number(max).toLocaleString('en-US')} บาท
        </div>
      ) : hint ? (
        <div style={hintStyle}>{hint}</div>
      ) : null}
    </label>
  );
}

const grid3 = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: theme.space(2),
  alignItems: 'start',
};

const EMPTY = {
  income: '', withholding: '',
  child1: '', child2: '', parents: '', disabled: '', maternity: '',
  socialSecurity: '', lifeInsurance: '', healthInsurance: '', parentHealthInsurance: '',
  annuity: '', rmf: '', pvd: '', thaiEsg: '', thaiEsgxNew: '', thaiEsgxLtf: '',
  easyEReceipt: '', homeLoan: '', donationGeneral: '', donationSpecial: '',
};

/**
 * Thai personal income tax estimator (ปีภาษี 2568). A native, themed rebuild of
 * the user's standalone calculator — live results, deduction breakdown, and the
 * progressive-bracket steps. Estimate only; not tax advice.
 */
export default function ThaiTaxPanel() {
  const [f, setF] = useState(EMPTY);
  const [spouse, setSpouse] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  const { funds } = useFunds();
  const set = (k) => (v) => setF((prev) => ({ ...prev, [k]: v }));

  const income = Number(f.income) || 0;
  const r = useMemo(() => calcThaiTax2568({ ...f, spouse }), [f, spouse]);
  const hasIncome = income > 0;

  // Pre-fill RMF / Thai ESG / ESGX fields from tracked funds (cost basis). The
  // cost is total tracked investment, not necessarily this tax year's purchase —
  // it's a starting estimate to adjust.
  const fundTotals = useMemo(() => {
    const t = { rmf: 0, thaiEsg: 0, thaiEsgxNew: 0 };
    for (const fund of funds) {
      const bucket = fundBucket(fund);
      if (bucket && t[bucket] != null) t[bucket] += Number(fund.costThb) || 0;
    }
    return t;
  }, [funds]);
  const canPrefill = fundTotals.rmf + fundTotals.thaiEsg + fundTotals.thaiEsgxNew > 0;

  function prefillFromFunds() {
    setF((prev) => ({
      ...prev,
      rmf: fundTotals.rmf > 0 ? String(Math.round(fundTotals.rmf)) : prev.rmf,
      thaiEsg: fundTotals.thaiEsg > 0 ? String(Math.round(fundTotals.thaiEsg)) : prev.thaiEsg,
      thaiEsgxNew: fundTotals.thaiEsgxNew > 0 ? String(Math.round(fundTotals.thaiEsgxNew)) : prev.thaiEsgxNew,
    }));
    setPrefilled(true);
  }

  // Net-result presentation (owe more / refund / settled).
  let resultColor = theme.colors.textDim;
  let resultLabel = 'ยอดสุทธิ';
  let resultValue = baht(0);
  if (r.netTax > 0.005) {
    resultColor = theme.colors.down;
    resultLabel = 'ภาษีที่ต้องชำระเพิ่ม';
    resultValue = baht(r.netTax);
  } else if (r.netTax < -0.005) {
    resultColor = theme.colors.up;
    resultLabel = 'ขอคืนภาษีได้';
    resultValue = baht(Math.abs(r.netTax));
  } else {
    resultLabel = 'พอดี — ไม่ต้องจ่ายเพิ่ม/ไม่ได้คืน';
    resultValue = baht(0);
  }

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
      <PanelHeader
        icon={<Calculator size={16} />}
        title="คำนวณภาษีเงินได้บุคคลธรรมดา ปี 2568"
        right={
          canPrefill ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={prefillFromFunds}
              title="เติม RMF / Thai ESG / ESGX จากกองทุนที่ติดตาม (ใช้ต้นทุนรวม)"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: theme.colors.accent }}
            >
              <Download size={14} /> ดึงจากพอร์ต
            </button>
          ) : null
        }
      />

      {prefilled && (
        <div style={{ fontSize: 11.5, color: theme.colors.textDim, background: theme.colors.bgElev, borderRadius: theme.radius.sm, padding: theme.space(2), borderLeft: `3px solid ${theme.colors.accent}` }}>
          เติมจากกองทุนที่ติดตามแล้ว (ใช้ <b>ต้นทุนรวม</b>) — โปรดปรับเป็น <b>ยอดที่ซื้อจริงในปีภาษี 2568</b> เท่านั้น
        </div>
      )}

      {/* 1. Income */}
      <div>
        <div style={sectionTitle}>1. เงินได้</div>
        <div style={grid3}>
          <Field label="เงินได้ทั้งปี (เงินเดือน/40(1))" value={f.income} onChange={set('income')} placeholder="เช่น 800000" />
          <Field label="ภาษีหัก ณ ที่จ่าย (ทั้งปี)" value={f.withholding} onChange={set('withholding')} hint="กรอกยอดที่ถูกหักไว้แล้ว (ถ้ามี)" />
        </div>
      </div>

      {/* 2. Personal & family */}
      <div>
        <div style={sectionTitle}>2. ส่วนตัวและครอบครัว</div>
        <div style={grid3}>
          <div>
            <span style={labelStyle}>ค่าลดหย่อนส่วนตัว</span>
            <input className="input" value="60,000" disabled style={{ color: theme.colors.textFaint }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: theme.space(1), alignSelf: 'center', marginTop: 18 }}>
            <input type="checkbox" checked={spouse} onChange={(e) => setSpouse(e.target.checked)} style={{ width: 16, height: 16, accentColor: theme.colors.accent }} />
            <span style={{ fontSize: 13, color: theme.colors.text }}>คู่สมรส (ไม่มีเงินได้) +60,000</span>
          </label>
          <Field label="บุตรคนแรก (คน)" value={f.child1} onChange={set('child1')} integer placeholder="0 หรือ 1" hint="คนละ 30,000" />
          <Field label="บุตรคนที่ 2 ขึ้นไป (คน)" value={f.child2} onChange={set('child2')} integer placeholder="จำนวนคน" hint="คนละ 60,000 (เกิดปี 2561+)" />
          <Field label="อุปการะบิดามารดา (คน)" value={f.parents} onChange={set('parents')} integer placeholder="0–4" hint="คนละ 30,000 สูงสุด 4 คน" />
          <Field label="อุปการะผู้พิการ (คน)" value={f.disabled} onChange={set('disabled')} integer placeholder="จำนวนคน" hint="คนละ 60,000" />
          <Field label="ค่าฝากครรภ์และคลอดบุตร" value={f.maternity} onChange={set('maternity')} max={TAX_LIMITS.maternity} hint="สูงสุด 60,000" />
        </div>
      </div>

      {/* 3. Insurance & investment */}
      <div>
        <div style={sectionTitle}>3. ประกันและการลงทุน</div>
        <div style={grid3}>
          <Field label="ประกันสังคม" value={f.socialSecurity} onChange={set('socialSecurity')} max={TAX_LIMITS.socialSecurity} hint="สูงสุด 9,000" />
          <Field label="เบี้ยประกันชีวิต" value={f.lifeInsurance} onChange={set('lifeInsurance')} hint="รวมสุขภาพ ≤ 100,000" />
          <Field label="เบี้ยประกันสุขภาพตนเอง" value={f.healthInsurance} onChange={set('healthInsurance')} max={TAX_LIMITS.healthInsurance} hint="สูงสุด 25,000" />
          <Field label="ประกันสุขภาพบิดามารดา" value={f.parentHealthInsurance} onChange={set('parentHealthInsurance')} max={TAX_LIMITS.parentHealthInsurance} hint="สูงสุด 15,000" />
          <Field label="ประกันชีวิตแบบบำนาญ" value={f.annuity} onChange={set('annuity')} hint="15% ของเงินได้ สูงสุด 200,000" />
          <Field label="RMF" value={f.rmf} onChange={set('rmf')} hint="30% ของเงินได้ สูงสุด 500,000" />
          <Field label="กบข. / PVD / กองทุนสงเคราะห์ฯ" value={f.pvd} onChange={set('pvd')} hint="รวมกลุ่มเกษียณ ≤ 500,000" />
          <Field label="กองทุน Thai ESG" value={f.thaiEsg} onChange={set('thaiEsg')} hint="30% ของเงินได้ สูงสุด 300,000" />
          <Field label="Thai ESGX (ลงทุนใหม่)" value={f.thaiEsgxNew} onChange={set('thaiEsgxNew')} hint="30% ของเงินได้ สูงสุด 300,000" />
          <Field label="Thai ESGX (จาก LTF)" value={f.thaiEsgxLtf} onChange={set('thaiEsgxLtf')} max={TAX_LIMITS.thaiEsgxLtfMax} hint="สูงสุด 300,000" />
        </div>
      </div>

      {/* 4. Stimulus + home loan */}
      <div>
        <div style={sectionTitle}>4. มาตรการรัฐและที่อยู่อาศัย</div>
        <div style={grid3}>
          <Field label="Easy E-Receipt 2.0" value={f.easyEReceipt} onChange={set('easyEReceipt')} max={TAX_LIMITS.easyEReceipt} hint="สูงสุด 50,000" />
          <Field label="ดอกเบี้ยกู้ยืมเพื่อที่อยู่อาศัย" value={f.homeLoan} onChange={set('homeLoan')} max={TAX_LIMITS.homeLoan} hint="สูงสุด 100,000" />
        </div>
      </div>

      {/* 5. Donations */}
      <div>
        <div style={sectionTitle}>5. เงินบริจาค</div>
        <div style={grid3}>
          <Field label="บริจาคทั่วไป" value={f.donationGeneral} onChange={set('donationGeneral')} hint="ไม่เกิน 10% ของเงินได้หลังหักค่าลดหย่อน" />
          <Field label="บริจาคการศึกษา/กีฬา/รพ.รัฐ (2 เท่า)" value={f.donationSpecial} onChange={set('donationSpecial')} hint="ลดได้ 2 เท่า (ภายในเพดาน 10%)" />
        </div>
      </div>

      {/* ── Results ── */}
      {hasIncome ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(2), marginTop: theme.space(1) }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: theme.space(2) }}>
            <Stat label="เงินได้สุทธิ (ฐานภาษี)" value={baht(r.taxableIncome)} />
            <Stat label="ภาษีที่คำนวณได้" value={baht(r.tax)} />
            <Stat label="หัก ณ ที่จ่าย" value={`- ${baht(r.withholding)}`} color={theme.colors.textDim} />
            <Stat label="อัตราภาษีเฉลี่ย" value={`${r.effectiveRate.toFixed(2)}%`} />
          </div>

          <div
            style={{
              padding: theme.space(3),
              borderRadius: theme.radius.md,
              background: theme.colors.bgElev,
              borderLeft: `3px solid ${resultColor}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: theme.space(2),
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontWeight: 700, color: resultColor }}>{resultLabel}</span>
            <span style={{ fontSize: 26, fontWeight: 800, fontFamily: theme.mono, color: resultColor }}>{resultValue}</span>
          </div>

          <button
            type="button"
            className="btn-ghost"
            onClick={() => setShowDetail((s) => !s)}
            style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: theme.colors.accent }}
          >
            {showDetail ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showDetail ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียดค่าลดหย่อนและขั้นภาษี'}
          </button>

          {showDetail && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
              <DetailTable
                title="รายการลดหย่อนที่ใช้คำนวณ"
                head={['รายการ', 'จำนวน (บาท)']}
                rows={r.deductionItems.map((it) => [it.label, baht(it.value)])}
                foot={['รวมค่าลดหย่อน', baht(r.totalDeductions)]}
              />
              <DetailTable
                title="ขั้นบันไดภาษี"
                head={['เงินได้สุทธิช่วง', 'จำนวนในขั้น', 'อัตรา', 'ภาษี']}
                rows={r.steps.map((s) => [
                  `${s.from.toLocaleString('en-US')}–${s.to === Infinity ? 'ขึ้นไป' : s.to.toLocaleString('en-US')}`,
                  baht(s.taxable),
                  `${(s.rate * 100).toFixed(0)}%`,
                  baht(s.tax),
                ])}
                foot={['รวมภาษีก่อนหัก ณ ที่จ่าย', '', '', baht(r.tax)]}
              />
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: theme.colors.textDim }}>
          กรอก “เงินได้ทั้งปี” เพื่อดูประมาณการภาษีและค่าลดหย่อน
        </div>
      )}

      <div style={{ fontSize: 10.5, color: theme.colors.textFaint, lineHeight: 1.5 }}>
        * ประมาณการตามเกณฑ์ปี 2568 โดยสมมติเป็น <b>เงินเดือน (40(1))</b> — ไม่รวมเงินได้ประเภทอื่น และคิดเฉพาะปีภาษีเดียว
        (เช่น สิทธิ ESGX จาก LTF ที่ทยอยใช้หลายปี จะคิดเฉพาะปีแรก). บุตรบุญธรรมคนที่ 2+ ใช้ช่อง “บุตรคนแรก” (30,000).
        ไม่ใช่คำแนะนำทางภาษี โปรดตรวจสอบกับกรมสรรพากร
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: theme.colors.textDim }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: theme.mono, color: color || theme.colors.text }}>{value}</div>
    </div>
  );
}

function DetailTable({ title, head, rows, foot }) {
  const td = { padding: `${theme.space(1)}px ${theme.space(2)}px`, borderTop: `1px solid ${theme.colors.border}`, fontSize: 12.5 };
  const numCol = (i) => (i === 0 ? {} : { textAlign: 'right', fontFamily: theme.mono });
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: theme.colors.text, marginBottom: theme.space(1) }}>{title}</div>
      <div style={{ overflowX: 'auto', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.sm }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: theme.colors.bgElev }}>
              {head.map((h, i) => (
                <th key={i} style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, fontSize: 11, color: theme.colors.textDim, textAlign: i === 0 ? 'left' : 'right', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{ ...td, ...numCol(ci), color: theme.colors.text }}>{cell}</td>
                ))}
              </tr>
            ))}
            <tr style={{ background: theme.colors.bgElev, fontWeight: 700 }}>
              {foot.map((cell, ci) => (
                <td key={ci} style={{ ...td, ...numCol(ci), color: theme.colors.text }}>{cell}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
