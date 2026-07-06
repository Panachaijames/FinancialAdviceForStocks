import React, { useMemo, useState } from 'react';
import { Palmtree } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { fmtMoney } from '../../lib/format.js';
import { useSettingsStore } from '../../store/settingsStore.js';
import { projectRetirement, RETIREMENT_DEFAULTS } from '../../lib/retirement.js';
import useNetWorth from '../../hooks/useNetWorth.js';
import ProjectionChart from '../ProjectionChart.jsx';
import { PanelHeader } from './SavingsPanel.jsx';

const fieldLabel = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: theme.colors.textDim,
  fontWeight: 600,
  display: 'block',
  marginBottom: 4,
};

const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
  gap: theme.space(2),
  alignItems: 'start',
};

function Stat({ label, value, color, sub }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: theme.colors.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: theme.mono, color: color || theme.colors.text, lineHeight: 1.15 }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: theme.colors.textFaint }}>{sub}</div> : null}
    </div>
  );
}

function Num({ label, value, onChange, step = 'any', integer = false }) {
  return (
    <label>
      <span style={fieldLabel}>{label}</span>
      <input
        className="input"
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        step={integer ? '1' : step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/**
 * Retirement / financial-freedom planner with Thailand-oriented defaults.
 * Accounts for the factors that drive the outcome — inflation, expected returns
 * (separate before/after retiring), contributions, and an inflation-growing
 * spending need — then simulates year by year whether the money lasts.
 */
export default function RetirementPlanner() {
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const { investments, cash, funds, net } = useNetWorth();

  const [currentAge, setCurrentAge] = useState('30');
  const [retireAge, setRetireAge] = useState(String(RETIREMENT_DEFAULTS.retireAge));
  const [endAge, setEndAge] = useState(String(RETIREMENT_DEFAULTS.endAge));
  const [useNet, setUseNet] = useState(true);
  const [startManual, setStartManual] = useState('');
  const [monthly, setMonthly] = useState('15000');
  const [expense, setExpense] = useState('30000');
  const [pension, setPension] = useState('');
  const [preReturn, setPreReturn] = useState(String(RETIREMENT_DEFAULTS.preReturnPct));
  const [postReturn, setPostReturn] = useState(String(RETIREMENT_DEFAULTS.postReturnPct));
  const [inflation, setInflation] = useState(String(RETIREMENT_DEFAULTS.inflationPct));
  const [swr, setSwr] = useState(String(RETIREMENT_DEFAULTS.swrPct));
  const [invTax, setInvTax] = useState(String(RETIREMENT_DEFAULTS.investmentTaxPct));

  const start = useNet ? net : Number(startManual) || 0;

  const r = useMemo(
    () =>
      projectRetirement({
        currentAge: Number(currentAge),
        retireAge: Number(retireAge),
        endAge: Number(endAge),
        currentSavings: start,
        monthlyContribution: Number(monthly) || 0,
        monthlyExpenseToday: Number(expense) || 0,
        monthlyPensionToday: Number(pension) || 0,
        preReturnPct: Number(preReturn) || 0,
        postReturnPct: Number(postReturn) || 0,
        inflationPct: Number(inflation) || 0,
        swrPct: Number(swr) || 0,
        investmentTaxPct: Number(invTax) || 0,
      }),
    [currentAge, retireAge, endAge, start, monthly, expense, pension, preReturn, postReturn, inflation, swr, invTax]
  );

  const cur = displayCurrency;
  const chart = [{ values: r.series.map((p) => p.balance), color: theme.colors.accent, area: true }];

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
      <PanelHeader icon={<Palmtree size={16} />} title="Retirement & Financial Freedom" />

      <div style={grid}>
        <Num label="Current age" value={currentAge} onChange={setCurrentAge} integer />
        <Num label="Retire at" value={retireAge} onChange={setRetireAge} integer />
        <Num label="Plan to age" value={endAge} onChange={setEndAge} integer />
        <div>
          <span style={fieldLabel}>Current savings</span>
          {useNet ? (
            <button type="button" className="btn" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => setUseNet(false)} title="Click to enter a custom amount">
              <span style={{ fontFamily: theme.mono }}>{fmtMoney(net, cur)}</span>
              <span style={{ fontSize: 10, color: theme.colors.textFaint }}>net worth</span>
            </button>
          ) : (
            <input className="input" type="number" inputMode="decimal" step="any" min="0" placeholder="0" value={startManual} onChange={(e) => setStartManual(e.target.value)} onBlur={(e) => { if (!e.target.value) setUseNet(true); }} />
          )}
        </div>
        <Num label={`Monthly invest (${cur})`} value={monthly} onChange={setMonthly} />
        <Num label={`Monthly spend now (${cur})`} value={expense} onChange={setExpense} />
        <Num label={`Monthly pension (${cur})`} value={pension} onChange={setPension} />
        <Num label="Return %/yr (pre)" value={preReturn} onChange={setPreReturn} />
        <Num label="Return %/yr (retired)" value={postReturn} onChange={setPostReturn} />
        <Num label="Inflation %/yr" value={inflation} onChange={setInflation} />
        <Num label="Withdrawal rate %" value={swr} onChange={setSwr} />
        <Num label="Investment tax %" value={invTax} onChange={setInvTax} />
      </div>

      <div style={{ fontSize: 11, color: theme.colors.textFaint, marginTop: -theme.space(1) }}>
        💸 Investment tax reduces your yearly gains (default 15% ≈ US dividend withholding). Lower it for
        a Thai SET / RMF-heavy mix — SET capital gains are exempt and RMF/Thai ESG gains are tax-free if held.
      </div>

      {/* Make it explicit that the starting nest egg is your live portfolio:
          stocks + Thai funds (incl. RMF) + cash. */}
      {useNet && net > 0 && (
        <div style={{ fontSize: 12, color: theme.colors.textDim, background: theme.colors.bgElev, borderRadius: theme.radius.sm, padding: theme.space(2), borderLeft: `3px solid ${theme.colors.accent}` }}>
          Starting from your live portfolio:{' '}
          <b style={{ color: theme.colors.accent }}>📈 {fmtMoney(investments, cur)}</b> stocks
          {funds > 0 && (<> · <b style={{ color: theme.colors.crypto }}>🇹🇭 {fmtMoney(funds, cur)}</b> funds / RMF</>)}
          {cash > 0 && (<> · <b style={{ color: theme.colors.up }}>💵 {fmtMoney(cash, cur)}</b> cash</>)}
          {' = '}<b style={{ color: theme.colors.text }}>{fmtMoney(net, cur)}</b>
        </div>
      )}

      {/* Headline — does the money last? */}
      <div
        style={{
          padding: theme.space(3),
          borderRadius: theme.radius.md,
          background: theme.colors.bgElev,
          borderLeft: `3px solid ${r.onTrack ? theme.colors.up : theme.colors.down}`,
          fontSize: 14,
          color: theme.colors.text,
        }}
      >
        {r.onTrack ? (
          <>✅ <b>On track.</b> Your savings last through age <b>{r.endAge}</b> with about{' '}
            <b style={{ color: theme.colors.up }}>{fmtMoney(r.balanceAtEnd, cur)}</b> to spare (nominal).</>
        ) : (
          <>⚠️ <b style={{ color: theme.colors.down }}>Money runs out at age {r.depletionAge}</b> — before your plan-to age of {r.endAge}.
            {r.requiredMonthly ? (
              <> To be safe, invest about <b style={{ color: theme.colors.accent }}>{fmtMoney(r.requiredMonthly, cur)}/mo</b> (or retire later / spend less).</>
            ) : null}</>
        )}
      </div>

      <ProjectionChart series={chart} height={150} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: theme.space(2) }}>
        <Stat
          label={`Nest egg at ${r.retireAge}`}
          value={fmtMoney(r.nestEggAtRetirement, cur)}
          color={theme.colors.up}
          sub={`≈ ${fmtMoney(r.realNestEgg, cur)} in today's money`}
        />
        <Stat
          label="Freedom number"
          value={fmtMoney(r.freedomNumber, cur)}
          sub={`to fund ${fmtMoney(r.monthlyExpenseAtRetirement, cur)}/mo at ${swr}%`}
        />
        <Stat
          label="Spend at retirement"
          value={`${fmtMoney(r.monthlyExpenseAtRetirement, cur)}/mo`}
          sub={`${fmtMoney(Number(expense) || 0, cur)}/mo today + inflation`}
        />
        <Stat
          label="Financial freedom age"
          value={r.freedomAge != null ? String(r.freedomAge) : '—'}
          color={r.freedomAge != null ? theme.colors.up : theme.colors.textDim}
          sub={r.freedomAge != null ? 'could stop working' : 'not reached by plan-to age'}
        />
      </div>

      {r.freedomGap > 0 ? (
        <div style={{ fontSize: 12.5, color: theme.colors.textDim }}>
          Projected nest egg is <b style={{ color: theme.colors.warn }}>{fmtMoney(r.freedomGap, cur)}</b> short of the freedom number.
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: theme.colors.textDim }}>
          Projected nest egg <b style={{ color: theme.colors.up }}>exceeds</b> the freedom number by{' '}
          <b style={{ color: theme.colors.up }}>{fmtMoney(-r.freedomGap, cur)}</b>.
        </div>
      )}

      <div style={{ display: 'flex', gap: theme.space(3), fontSize: 11, color: theme.colors.textFaint, flexWrap: 'wrap' }}>
        <span><span style={{ color: theme.colors.accent }}>▬</span> Balance rises to age {r.retireAge}, then is drawn down to {r.endAge}</span>
        <span style={{ marginLeft: 'auto' }}>🇹🇭 Defaults: 2.5% inflation, 7%/4% returns, retire 60 — all editable · estimate, not a guarantee</span>
      </div>
    </div>
  );
}
