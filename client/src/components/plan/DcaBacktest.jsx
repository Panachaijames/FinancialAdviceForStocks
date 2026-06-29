import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Loader2 } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { fmtMoney, fmtSignedPct } from '../../lib/format.js';
import { classify } from '../../lib/assetType.js';
import { usePortfolioStore } from '../../store/portfolioStore.js';
import { getCandles } from '../../api/client.js';
import { dcaBacktest } from '../../lib/planning.js';
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

const RANGES = ['1y', '2y', '5y', 'max'];

function nativeCurrency(symbol) {
  return classify(symbol) === 'th_stock' ? 'THB' : 'USD';
}

/**
 * Backtest cost-averaging a fixed monthly amount into one asset, using the app's
 * real historical prices. Amounts are in the asset's native price currency.
 */
export default function DcaBacktest() {
  const holdings = usePortfolioStore((s) => s.holdings);
  const [symbol, setSymbol] = useState(() => (holdings[0] && holdings[0].symbol) || 'AAPL');
  const [range, setRange] = useState('3y');
  const [monthly, setMonthly] = useState('5000');
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const sym = (symbol || '').trim();
    if (!sym) return undefined;
    let active = true;
    setLoading(true);
    setErr('');
    getCandles(sym, range, '1d')
      .then((rows) => {
        if (!active) return;
        setCandles(Array.isArray(rows) ? rows : []);
        if (!rows || rows.length === 0) setErr('No price history for that symbol.');
      })
      .catch(() => {
        if (active) {
          setCandles([]);
          setErr('Could not load price history.');
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [symbol, range]);

  const cur = nativeCurrency(symbol);
  const result = useMemo(() => dcaBacktest({ candles, monthlyAmount: Number(monthly) || 0 }), [candles, monthly]);
  const chartSeries = [
    { values: result.series.map((p) => p.value), color: theme.colors.up, area: true },
    { values: result.series.map((p) => p.invested), color: theme.colors.textFaint },
  ];

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
      <PanelHeader
        icon={<LineChart size={16} />}
        title="DCA Backtest"
        right={loading ? <Loader2 size={15} style={{ animation: 'pulse 1s linear infinite', color: theme.colors.textDim }} /> : null}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: theme.space(2), alignItems: 'end' }}>
        <label>
          <span style={fieldLabel}>Symbol</span>
          <input
            className="input"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="AAPL, PTT.BK, BTC-USD"
            list="dca-symbols"
          />
          <datalist id="dca-symbols">
            {holdings.map((h) => (
              <option key={h.id} value={h.symbol}>{h.name}</option>
            ))}
          </datalist>
        </label>
        <label>
          <span style={fieldLabel}>Monthly ({cur})</span>
          <input className="input" type="number" inputMode="decimal" step="any" min="0" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </label>
        <div>
          <span style={fieldLabel}>Period</span>
          <div className="segmented" role="group" aria-label="Period">
            {RANGES.map((r) => (
              <button key={r} type="button" className="segmented-item" aria-pressed={range === r} onClick={() => setRange(r)} style={{ background: range === r ? theme.colors.accent : 'transparent', color: range === r ? '#fff' : theme.colors.textDim }}>
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {err ? (
        <div style={{ fontSize: 13, color: theme.colors.down }}>{err}</div>
      ) : (
        <>
          <ProjectionChart series={chartSeries} height={140} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: theme.space(2) }}>
            <div>
              <div style={{ fontSize: 11, color: theme.colors.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>Invested</div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: theme.mono, color: theme.colors.text }}>{fmtMoney(result.invested, cur)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: theme.colors.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>Value now</div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: theme.mono, color: theme.colors.up }}>{fmtMoney(result.value, cur)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: theme.colors.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>Return</div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: theme.mono, color: result.returnPct >= 0 ? theme.colors.up : theme.colors.down }}>{fmtSignedPct(result.returnPct)}</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: theme.colors.textFaint }}>
            Buys {fmtMoney(Number(monthly) || 0, cur)} of {symbol} once per month over {range} of real prices. Past performance ≠ future results.
          </div>
        </>
      )}
    </div>
  );
}
