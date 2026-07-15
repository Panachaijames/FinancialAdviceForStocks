import React, { useMemo, useState } from 'react';
import { Calculator, ChevronDown, ChevronUp, Download, Scale } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { fmtMoney } from '../../lib/format.js';
import { calcThaiTax2568, TAX_LIMITS } from '../../lib/thaiTax.js';
import { TAX_LAW_REFERENCES, TAX_LAW_VERIFIED_AT } from '../../lib/thaiTaxLaw.js';
import useFunds from '../../hooks/useFunds.js';
import { useT } from '../../lib/i18n.js';
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
function Field({ label, value, onChange, placeholder, hint, max, step = 'any', integer = false }) {
  const t = useT();
  const num = Number(value);
  const over = max != null && Number.isFinite(num) && num > max;
  const ph = placeholder ?? t('thaitax.field.placeholder');
  return (
    <label style={{ display: 'block' }}>
      <span style={labelStyle}>{label}</span>
      <input
        className="input"
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        step={integer ? '1' : step}
        min="0"
        placeholder={ph}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={over ? { borderColor: theme.colors.down } : undefined}
      />
      {over ? (
        <div style={{ ...hintStyle, color: theme.colors.down }}>
          {t('thaitax.field.overCap', { max: Number(max).toLocaleString('en-US') })}
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
  easyEReceipt: '', easyEReceiptOtop: '', homeLoan: '', donationGeneral: '', donationSpecial: '',
};

/**
 * Thai personal income tax estimator (ปีภาษี 2568). A native, themed rebuild of
 * the user's standalone calculator — live results, deduction breakdown, and the
 * progressive-bracket steps. Estimate only; not tax advice.
 */
export default function ThaiTaxPanel() {
  const t = useT();
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
  let resultLabel = t('thaitax.result.net');
  let resultValue = baht(0);
  if (r.netTax > 0.005) {
    resultColor = theme.colors.down;
    resultLabel = t('thaitax.result.owe');
    resultValue = baht(r.netTax);
  } else if (r.netTax < -0.005) {
    resultColor = theme.colors.up;
    resultLabel = t('thaitax.result.refund');
    resultValue = baht(Math.abs(r.netTax));
  } else {
    resultLabel = t('thaitax.result.settled');
    resultValue = baht(0);
  }

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
      <PanelHeader
        icon={<Calculator size={16} />}
        title={t('thaitax.header.title')}
        right={
          canPrefill ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={prefillFromFunds}
              title={t('thaitax.prefill.buttonTitle')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: theme.colors.accent }}
            >
              <Download size={14} /> {t('thaitax.prefill.button')}
            </button>
          ) : null
        }
      />

      {prefilled && (
        <div style={{ fontSize: 11.5, color: theme.colors.textDim, background: theme.colors.bgElev, borderRadius: theme.radius.sm, padding: theme.space(2), borderLeft: `3px solid ${theme.colors.accent}` }}>
          {t('thaitax.prefillNotice.pre')}<b>{t('thaitax.prefillNotice.bold1')}</b>{t('thaitax.prefillNotice.mid')}<b>{t('thaitax.prefillNotice.bold2')}</b>{t('thaitax.prefillNotice.post')}
        </div>
      )}

      {/* 1. Income */}
      <div>
        <div style={sectionTitle}>{t('thaitax.section1.title')}</div>
        <div style={grid3}>
          <Field label={t('thaitax.field.income.label')} value={f.income} onChange={set('income')} placeholder={t('thaitax.field.income.placeholder')} />
          <Field label={t('thaitax.field.withholding.label')} value={f.withholding} onChange={set('withholding')} hint={t('thaitax.field.withholding.hint')} />
        </div>
      </div>

      {/* 2. Personal & family */}
      <div>
        <div style={sectionTitle}>{t('thaitax.section2.title')}</div>
        <div style={grid3}>
          <div>
            <span style={labelStyle}>{t('thaitax.field.personal.label')}</span>
            <input className="input" value="60,000" disabled style={{ color: theme.colors.textFaint }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: theme.space(1), alignSelf: 'center', marginTop: 18 }}>
            <input type="checkbox" checked={spouse} onChange={(e) => setSpouse(e.target.checked)} style={{ width: 16, height: 16, accentColor: theme.colors.accent }} />
            <span style={{ fontSize: 13, color: theme.colors.text }}>{t('thaitax.spouse.label')}</span>
          </label>
          <Field label={t('thaitax.field.child1.label')} value={f.child1} onChange={set('child1')} integer placeholder={t('thaitax.field.child1.placeholder')} hint={t('thaitax.field.child1.hint')} />
          <Field label={t('thaitax.field.child2.label')} value={f.child2} onChange={set('child2')} integer placeholder={t('thaitax.field.persons.placeholder')} hint={t('thaitax.field.child2.hint')} />
          <Field label={t('thaitax.field.parents.label')} value={f.parents} onChange={set('parents')} integer placeholder="0–4" hint={t('thaitax.field.parents.hint')} />
          <Field label={t('thaitax.field.disabled.label')} value={f.disabled} onChange={set('disabled')} integer placeholder={t('thaitax.field.persons.placeholder')} hint={t('thaitax.field.disabled.hint')} />
          <Field label={t('thaitax.field.maternity.label')} value={f.maternity} onChange={set('maternity')} max={TAX_LIMITS.maternity} hint={t('thaitax.field.maternity.hint')} />
        </div>
      </div>

      {/* 3. Insurance & investment */}
      <div>
        <div style={sectionTitle}>{t('thaitax.section3.title')}</div>
        <div style={grid3}>
          <Field label={t('thaitax.field.socialSecurity.label')} value={f.socialSecurity} onChange={set('socialSecurity')} max={TAX_LIMITS.socialSecurity} hint={t('thaitax.field.socialSecurity.hint')} />
          <Field label={t('thaitax.field.lifeInsurance.label')} value={f.lifeInsurance} onChange={set('lifeInsurance')} hint={t('thaitax.field.lifeInsurance.hint')} />
          <Field label={t('thaitax.field.healthInsurance.label')} value={f.healthInsurance} onChange={set('healthInsurance')} max={TAX_LIMITS.healthInsurance} hint={t('thaitax.field.healthInsurance.hint')} />
          <Field label={t('thaitax.field.parentHealthInsurance.label')} value={f.parentHealthInsurance} onChange={set('parentHealthInsurance')} max={TAX_LIMITS.parentHealthInsurance} hint={t('thaitax.field.parentHealthInsurance.hint')} />
          <Field label={t('thaitax.field.annuity.label')} value={f.annuity} onChange={set('annuity')} hint={t('thaitax.field.annuity.hint')} />
          <Field label="RMF" value={f.rmf} onChange={set('rmf')} hint={t('thaitax.field.rmf.hint')} />
          <Field label={t('thaitax.field.pvd.label')} value={f.pvd} onChange={set('pvd')} hint={t('thaitax.field.pvd.hint')} />
          <Field label={t('thaitax.field.thaiEsg.label')} value={f.thaiEsg} onChange={set('thaiEsg')} hint={t('thaitax.field.esg300.hint')} />
          <Field label={t('thaitax.field.esgxNew.label')} value={f.thaiEsgxNew} onChange={set('thaiEsgxNew')} hint={t('thaitax.field.esg300.hint')} />
          <Field label={t('thaitax.field.esgxLtf.label')} value={f.thaiEsgxLtf} onChange={set('thaiEsgxLtf')} max={TAX_LIMITS.thaiEsgxLtfMax} hint={t('thaitax.field.esgxLtf.hint')} />
        </div>
      </div>

      {/* 4. Stimulus + home loan */}
      <div>
        <div style={sectionTitle}>{t('thaitax.section4.title')}</div>
        <div style={grid3}>
          <Field label={t('thaitax.field.easyEReceipt.label')} value={f.easyEReceipt} onChange={set('easyEReceipt')} max={TAX_LIMITS.easyEReceiptGeneral} hint={t('thaitax.field.easyEReceipt.hint')} />
          <Field label={t('thaitax.field.easyEReceiptOtop.label')} value={f.easyEReceiptOtop} onChange={set('easyEReceiptOtop')} max={TAX_LIMITS.easyEReceipt} hint={t('thaitax.field.easyEReceiptOtop.hint')} />
          <Field label={t('thaitax.field.homeLoan.label')} value={f.homeLoan} onChange={set('homeLoan')} max={TAX_LIMITS.homeLoan} hint={t('thaitax.field.homeLoan.hint')} />
        </div>
      </div>

      {/* 5. Donations */}
      <div>
        <div style={sectionTitle}>{t('thaitax.section5.title')}</div>
        <div style={grid3}>
          <Field label={t('thaitax.field.donationGeneral.label')} value={f.donationGeneral} onChange={set('donationGeneral')} hint={t('thaitax.field.donationGeneral.hint')} />
          <Field label={t('thaitax.field.donationSpecial.label')} value={f.donationSpecial} onChange={set('donationSpecial')} hint={t('thaitax.field.donationSpecial.hint')} />
        </div>
      </div>

      {/* ── Results ── */}
      {hasIncome ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(2), marginTop: theme.space(1) }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: theme.space(2) }}>
            <Stat label={t('thaitax.stat.taxableIncome')} value={baht(r.taxableIncome)} />
            <Stat label={t('thaitax.stat.tax')} value={baht(r.tax)} />
            <Stat label={t('thaitax.stat.withholding')} value={`- ${baht(r.withholding)}`} color={theme.colors.textDim} />
            <Stat label={t('thaitax.stat.effectiveRate')} value={`${r.effectiveRate.toFixed(2)}%`} />
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
            {showDetail ? t('thaitax.detail.hide') : t('thaitax.detail.show')}
          </button>

          {showDetail && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
              <DetailTable
                title={t('thaitax.table.deductions.title')}
                head={[t('thaitax.table.col.item'), t('thaitax.table.col.amountBaht')]}
                rows={r.deductionItems.map((it) => [it.label, baht(it.value)])}
                foot={[t('thaitax.table.deductions.foot'), baht(r.totalDeductions)]}
              />
              <DetailTable
                title={t('thaitax.table.brackets.title')}
                head={[t('thaitax.table.col.incomeRange'), t('thaitax.table.col.amountInStep'), t('thaitax.table.col.rate'), t('thaitax.table.col.tax')]}
                rows={r.steps.map((s) => [
                  `${s.from.toLocaleString('en-US')}–${s.to === Infinity ? t('thaitax.table.brackets.andUp') : s.to.toLocaleString('en-US')}`,
                  baht(s.taxable),
                  `${(s.rate * 100).toFixed(0)}%`,
                  baht(s.tax),
                ])}
                foot={[t('thaitax.table.brackets.foot'), '', '', baht(r.tax)]}
              />
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: theme.colors.textDim }}>
          {t('thaitax.emptyIncome')}
        </div>
      )}

      <LegalReferences />

      <div style={{ fontSize: 10.5, color: theme.colors.textFaint, lineHeight: 1.5 }}>
        {t('thaitax.footnote.pre')}<b>{t('thaitax.footnote.bold')}</b>{t('thaitax.footnote.post')}
      </div>
    </div>
  );
}

/**
 * Collapsible legal-reference table: every rule the calculator applies, mapped
 * to its Revenue Code section / royal decree / ministerial regulation, with a
 * link to the source. Data: thaiTaxLaw.js (web-verified against primary
 * sources; see TAX_LAW_VERIFIED_AT).
 */
function LegalReferences() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        className="btn-ghost"
        onClick={() => setOpen((s) => !s)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: theme.colors.accent }}
      >
        <Scale size={14} />
        {open ? t('thaitax.legal.hide') : t('thaitax.legal.show')}
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(2), marginTop: theme.space(2) }}>
          <div style={{ fontSize: 11.5, color: theme.colors.textDim, lineHeight: 1.5 }}>
            {t('thaitax.legal.desc.pre')}<b>{TAX_LAW_VERIFIED_AT}</b>{t('thaitax.legal.desc.post')}
          </div>
          <div style={{ overflowX: 'auto', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.sm }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: theme.colors.bgElev }}>
                  {[t('thaitax.table.col.item'), t('thaitax.legal.col.rule'), t('thaitax.legal.col.law')].map((h, i) => (
                    <th key={i} style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, fontSize: 11, color: theme.colors.textDim, textAlign: 'left', fontWeight: 600, whiteSpace: i === 0 ? 'nowrap' : undefined }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TAX_LAW_REFERENCES.map((r) => (
                  <tr key={r.id}>
                    <td style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, borderTop: `1px solid ${theme.colors.border}`, fontSize: 12, fontWeight: 600, color: theme.colors.text, verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      {r.label}
                    </td>
                    <td style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, borderTop: `1px solid ${theme.colors.border}`, fontSize: 11.5, color: theme.colors.textDim, verticalAlign: 'top', minWidth: 220, lineHeight: 1.5 }}>
                      {r.rule}
                      {r.note ? <div style={{ color: theme.colors.warn, marginTop: 2 }}>⚠ {r.note}</div> : null}
                    </td>
                    <td style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, borderTop: `1px solid ${theme.colors.border}`, fontSize: 11.5, verticalAlign: 'top', minWidth: 200, lineHeight: 1.5 }}>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: theme.colors.accent, textDecoration: 'none', borderBottom: `1px dotted ${theme.colors.accent}` }}
                      >
                        {r.law}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
