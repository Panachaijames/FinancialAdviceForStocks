import React, { useMemo, useState } from 'react';
import { Target } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { fmtMoney } from '../../lib/format.js';
import { useSettingsStore } from '../../store/settingsStore.js';
import { projectFutureValue, requiredMonthly } from '../../lib/planning.js';
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

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: theme.colors.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: theme.mono, color: color || theme.colors.text }}>{value}</div>
    </div>
  );
}

/**
 * Goal & future-value planner. Inputs in the display currency. Projects a lump
 * sum + monthly contributions, and solves the monthly needed to hit a target.
 */
export default function GoalPlanner() {
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const { net } = useNetWorth();

  const [useNet, setUseNet] = useState(true);
  const [startManual, setStartManual] = useState('');
  const [monthly, setMonthly] = useState('15000');
  const [returnPct, setReturnPct] = useState('7');
  const [years, setYears] = useState('10');
  const [target, setTarget] = useState('3000000');

  const start = useNet ? net : Number(startManual) || 0;

  const proj = useMemo(
    () =>
      projectFutureValue({
        principal: start,
        monthly: Number(monthly) || 0,
        annualReturnPct: Number(returnPct) || 0,
        years: Number(years) || 0,
      }),
    [start, monthly, returnPct, years]
  );

  const targetNum = Number(target) || 0;
  const needMonthly = useMemo(
    () => requiredMonthly({ principal: start, target: targetNum, annualReturnPct: Number(returnPct) || 0, years: Number(years) || 0 }),
    [start, targetNum, returnPct, years]
  );
  const onTrack = targetNum > 0 && proj.finalValue >= targetNum;
  const gap = targetNum - proj.finalValue;

  const chartSeries = [
    { values: proj.series.map((p) => p.value), color: theme.colors.up, area: true },
    { values: proj.series.map((p) => p.invested), color: theme.colors.textFaint },
  ];

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
      <PanelHeader icon={<Target size={16} />} title="Goal & Future Projection" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: theme.space(2) }}>
        <div>
          <span style={fieldLabel}>Starting amount</span>
          {useNet ? (
            <button type="button" className="btn" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => setUseNet(false)} title="Click to enter a custom amount">
              <span style={{ fontFamily: theme.mono }}>{fmtMoney(net, displayCurrency)}</span>
              <span style={{ fontSize: 10, color: theme.colors.textFaint }}>net worth</span>
            </button>
          ) : (
            <input className="input" type="number" inputMode="decimal" step="any" min="0" placeholder="0" value={startManual} onChange={(e) => setStartManual(e.target.value)} onBlur={(e) => { if (!e.target.value) setUseNet(true); }} />
          )}
        </div>
        <label>
          <span style={fieldLabel}>Monthly add ({displayCurrency})</span>
          <input className="input" type="number" inputMode="decimal" step="any" min="0" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </label>
        <label>
          <span style={fieldLabel}>Return %/yr</span>
          <input className="input" type="number" inputMode="decimal" step="any" value={returnPct} onChange={(e) => setReturnPct(e.target.value)} />
        </label>
        <label>
          <span style={fieldLabel}>Years</span>
          <input className="input" type="number" inputMode="numeric" step="1" min="1" value={years} onChange={(e) => setYears(e.target.value)} />
        </label>
        <label>
          <span style={fieldLabel}>Target ({displayCurrency})</span>
          <input className="input" type="number" inputMode="decimal" step="any" min="0" value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
      </div>

      <ProjectionChart series={chartSeries} height={150} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: theme.space(2) }}>
        <Stat label={`Projected (${years}y)`} value={fmtMoney(proj.finalValue, displayCurrency)} color={theme.colors.up} />
        <Stat label="You invest" value={fmtMoney(proj.totalInvested, displayCurrency)} />
        <Stat label="Growth" value={fmtMoney(proj.gain, displayCurrency)} color={theme.colors.up} />
      </div>

      {targetNum > 0 && (
        <div
          style={{
            padding: theme.space(2),
            borderRadius: theme.radius.md,
            background: theme.colors.bgElev,
            borderLeft: `3px solid ${onTrack ? theme.colors.up : theme.colors.warn}`,
            fontSize: 13,
            color: theme.colors.text,
          }}
        >
          {onTrack ? (
            <>✅ On track — you reach <b>{fmtMoney(targetNum, displayCurrency)}</b> with about{' '}
              <b>{fmtMoney(proj.finalValue - targetNum, displayCurrency)}</b> to spare.</>
          ) : (
            <>⚠️ Short by <b style={{ color: theme.colors.warn }}>{fmtMoney(gap, displayCurrency)}</b>. To hit{' '}
              <b>{fmtMoney(targetNum, displayCurrency)}</b> in {years}y, add about{' '}
              <b style={{ color: theme.colors.accent }}>{needMonthly == null ? '—' : fmtMoney(needMonthly, displayCurrency)}/mo</b>.</>
          )}
        </div>
      )}
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div style={{ display: 'flex', gap: theme.space(3), fontSize: 11, color: theme.colors.textDim }}>
      <span><span style={{ color: theme.colors.up }}>▬</span> Projected value</span>
      <span><span style={{ color: theme.colors.textFaint }}>▬</span> Total invested</span>
      <span style={{ marginLeft: 'auto', color: theme.colors.textFaint }}>Estimate, not a guarantee</span>
    </div>
  );
}
