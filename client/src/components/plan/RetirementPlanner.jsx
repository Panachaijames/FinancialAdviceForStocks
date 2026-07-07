import React, { useMemo, useState } from 'react';
import { Palmtree, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { fmtMoney } from '../../lib/format.js';
import { useSettingsStore } from '../../store/settingsStore.js';
import { projectRetirement, RETIREMENT_DEFAULTS, suggestInvestmentTax } from '../../lib/retirement.js';
import useNetWorth from '../../hooks/useNetWorth.js';
import { usePortfolioStore } from '../../store/portfolioStore.js';
import { usePlanStore } from '../../store/planStore.js';
import ProjectionChart from '../ProjectionChart.jsx';
import { PanelHeader } from './SavingsPanel.jsx';
import AiPathAdvisor from './AiPathAdvisor.jsx';

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

function Num({ label, value, onChange, step = 'any', integer = false, placeholder, hint }) {
  return (
    <label>
      <span style={fieldLabel}>{label}</span>
      <input
        className="input"
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        step={integer ? '1' : step}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <div style={{ fontSize: 10.5, color: theme.colors.textFaint, marginTop: 3 }}>{hint}</div> : null}
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
  const { investments, cash, funds, net, byType } = useNetWorth();
  const portfolioHoldings = usePortfolioStore((s) => s.holdings);
  const suggestedTax = useMemo(() => suggestInvestmentTax(byType), [byType]);

  // All inputs live in planStore (persisted to localStorage as "pt-plan" and
  // included in the one-time cross-device transfer) so the plan is never lost
  // on reload. Raw strings, same as the previous local state.
  const plan = usePlanStore();
  const {
    currentAge, retireAge, endAge, useNet, startManual, monthly, expense, pension,
    preReturn, postReturn, inflation, swr, invTax,
    contributionGrowth, retireSpendPct, pensionStartAge, lumpSum, lumpSumAge, careBumpPct, careFromAge,
  } = plan;
  const setF = (key) => (v) => plan.setField(key, v);
  const [moreOpen, setMoreOpen] = useState(false);

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
        // Refinements — the lib applies safe defaults for blank values.
        contributionGrowthPct: contributionGrowth,
        retireSpendPct,
        pensionStartAge,
        lumpSumAmount: lumpSum,
        lumpSumAge,
        careBumpPct,
        careFromAge,
      }),
    [currentAge, retireAge, endAge, start, monthly, expense, pension, preReturn, postReturn, inflation, swr, invTax,
      contributionGrowth, retireSpendPct, pensionStartAge, lumpSum, lumpSumAge, careBumpPct, careFromAge]
  );

  const cur = displayCurrency;
  const chart = [{ values: r.series.map((p) => p.balance), color: theme.colors.accent, area: true }];

  // Snapshot for the AI Path Advisor: allocation by asset type (display
  // currency) with the symbols held in each bucket for context.
  const aiPayload = useMemo(() => {
    const symbolsByType = {};
    for (const h of portfolioHoldings) {
      (symbolsByType[h.type] || (symbolsByType[h.type] = [])).push(h.symbol);
    }
    const holdings = Object.entries(byType)
      .filter(([, v]) => (Number(v) || 0) > 0)
      .map(([type, marketValue]) => ({
        symbol: type,
        name: (symbolsByType[type] || []).slice(0, 12).join(', ') || null,
        type,
        marketValue,
      }));
    return {
      displayCurrency,
      plan: {
        currentAge: Number(currentAge),
        retireAge: Number(retireAge),
        endAge: Number(endAge),
        monthly: Number(monthly) || 0,
        expense: Number(expense) || 0,
        pension: Number(pension) || 0,
        preReturn: Number(preReturn) || 0,
        postReturn: Number(postReturn) || 0,
        inflation: Number(inflation) || 0,
        swr: Number(swr) || 0,
        invTax: Number(invTax) || 0,
        contributionGrowth: Number(contributionGrowth) || 0,
        retireSpendPct: Number(retireSpendPct) || 100,
        pensionStartAge: Number(pensionStartAge) || null,
        lumpSum: Number(lumpSum) || 0,
        lumpSumAge: Number(lumpSumAge) || null,
        careBumpPct: Number(careBumpPct) || 0,
        careFromAge: Number(careFromAge) || null,
      },
      projection: {
        nestEggAtRetirement: r.nestEggAtRetirement,
        realNestEgg: r.realNestEgg,
        freedomNumber: r.freedomNumber,
        freedomGap: r.freedomGap,
        monthlyExpenseAtRetirement: r.monthlyExpenseAtRetirement,
        depletionAge: r.depletionAge,
      },
      holdings,
    };
  }, [portfolioHoldings, byType, displayCurrency, currentAge, retireAge, endAge, monthly, expense, pension, preReturn, postReturn, inflation, swr, invTax,
    contributionGrowth, retireSpendPct, pensionStartAge, lumpSum, lumpSumAge, careBumpPct, careFromAge, r]);

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
      <PanelHeader icon={<Palmtree size={16} />} title="Retirement & Financial Freedom" />

      <div style={grid}>
        <Num label="Current age" value={currentAge} onChange={setF('currentAge')} integer />
        <Num label="Retire at" value={retireAge} onChange={setF('retireAge')} integer />
        <Num label="Plan to age" value={endAge} onChange={setF('endAge')} integer />
        <div>
          <span style={fieldLabel}>Current savings</span>
          {useNet ? (
            <button type="button" className="btn" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => setF('useNet')(false)} title="Click to enter a custom amount">
              <span style={{ fontFamily: theme.mono }}>{fmtMoney(net, cur)}</span>
              <span style={{ fontSize: 10, color: theme.colors.textFaint }}>net worth</span>
            </button>
          ) : (
            <input className="input" type="number" inputMode="decimal" step="any" min="0" placeholder="0" value={startManual} onChange={(e) => setF('startManual')(e.target.value)} onBlur={(e) => { if (!e.target.value) setF('useNet')(true); }} />
          )}
        </div>
        <Num label={`Monthly invest (${cur})`} value={monthly} onChange={setF('monthly')} />
        <Num label={`Monthly spend now (${cur})`} value={expense} onChange={setF('expense')} />
        <Num label={`Monthly pension (${cur})`} value={pension} onChange={setF('pension')} />
        <Num label="Return %/yr (pre)" value={preReturn} onChange={setF('preReturn')} />
        <Num label="Return %/yr (retired)" value={postReturn} onChange={setF('postReturn')} />
        <Num label="Inflation %/yr" value={inflation} onChange={setF('inflation')} />
        <Num label="Withdrawal rate %" value={swr} onChange={setF('swr')} />
        <Num label="Investment tax %" value={invTax} onChange={setF('invTax')} />
      </div>

      {/* Optional refinements — collapsed by default to keep the panel calm. */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(2), flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setMoreOpen((s) => !s)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: theme.colors.accent }}
          >
            {moreOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            More variables — raises, lifestyle, pension timing, lump sum, late-life care
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => plan.resetPlan()}
            title="Reset every planner field to the defaults"
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: theme.colors.textFaint, marginLeft: 'auto' }}
          >
            <RotateCcw size={12} /> Reset plan
          </button>
        </div>
        {moreOpen && (
          <div style={{ ...grid, marginTop: theme.space(2) }}>
            <Num
              label="Invest growth %/yr"
              value={contributionGrowth}
              onChange={setF('contributionGrowth')}
              placeholder="0"
              hint="Raises: monthly invest steps up yearly"
            />
            <Num
              label="Spend in retirement (%)"
              value={retireSpendPct}
              onChange={setF('retireSpendPct')}
              placeholder="100"
              hint="% of today's spending (80 = cheaper life)"
            />
            <Num
              label="Pension starts at age"
              value={pensionStartAge}
              onChange={setF('pensionStartAge')}
              integer
              placeholder={String(retireAge || RETIREMENT_DEFAULTS.retireAge)}
              hint="e.g. SSO/annuity paying later than you retire"
            />
            <Num
              label={`Lump sum (${cur})`}
              value={lumpSum}
              onChange={setF('lumpSum')}
              placeholder="0"
              hint="One-time: inheritance, property, PVD payout"
            />
            <Num
              label="Lump sum at age"
              value={lumpSumAge}
              onChange={setF('lumpSumAge')}
              integer
              placeholder="—"
              hint="Ignored unless an age is set"
            />
            <Num
              label="Care cost bump %"
              value={careBumpPct}
              onChange={setF('careBumpPct')}
              placeholder="0"
              hint="Extra spending late in life (healthcare)"
            />
            <Num
              label="Care bump from age"
              value={careFromAge}
              onChange={setF('careFromAge')}
              integer
              placeholder={String(RETIREMENT_DEFAULTS.careFromAge)}
              hint="When the bump starts"
            />
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: theme.space(2), marginTop: -theme.space(1) }}>
        <span style={{ fontSize: 11, color: theme.colors.textFaint, flex: '1 1 260px' }}>
          💸 Investment tax reduces your yearly gains. ~8% suits US buy-and-hold (the US doesn't tax
          foreigners' capital gains — only ~15% on dividends); SET gains are exempt and RMF/Thai ESG are
          tax-free if held. Tap "from your mix" to blend by your actual holdings.
        </span>
        {suggestedTax != null && (
          <button
            type="button"
            className="chip"
            onClick={() => setF('invTax')(String(suggestedTax))}
            title="Blend the tax rate from your actual holdings mix"
            style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}
          >
            💡 From your mix: <b style={{ color: theme.colors.accent, margin: '0 4px' }}>{suggestedTax}%</b>
            {Number(invTax) === suggestedTax ? '✓' : '· tap to use'}
          </button>
        )}
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
          sub={
            Number(retireSpendPct) > 0 && Number(retireSpendPct) !== 100
              ? `${Number(retireSpendPct)}% of today's ${fmtMoney(Number(expense) || 0, cur)}/mo + inflation`
              : `${fmtMoney(Number(expense) || 0, cur)}/mo today + inflation`
          }
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

      <AiPathAdvisor payload={aiPayload} />

      <div style={{ display: 'flex', gap: theme.space(3), fontSize: 11, color: theme.colors.textFaint, flexWrap: 'wrap' }}>
        <span><span style={{ color: theme.colors.accent }}>▬</span> Balance rises to age {r.retireAge}, then is drawn down to {r.endAge}</span>
        <span style={{ marginLeft: 'auto' }}>🇹🇭 Defaults: 2.5% inflation, 7%/4% returns, retire 60 — all editable · estimate, not a guarantee</span>
      </div>
    </div>
  );
}
