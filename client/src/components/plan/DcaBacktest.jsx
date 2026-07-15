import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Loader2 } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { fmtMoney, fmtSignedPct } from '../../lib/format.js';
import { classify } from '../../lib/assetType.js';
import { useT } from '../../lib/i18n.js';
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
  const t = useT();
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
        if (!rows || rows.length === 0) setErr(t('dca.errNoHistory'));
      })
      .catch(() => {
        if (active) {
          setCandles([]);
          setErr(t('dca.errLoadFailed'));
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
        title={t('dca.title')}
        right={loading ? <Loader2 size={15} style={{ animation: 'pulse 1s linear infinite', color: theme.colors.textDim }} /> : null}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: theme.space(2), alignItems: 'end' }}>
        <label>
          <span style={fieldLabel}>{t('dca.symbol')}</span>
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
          <span style={fieldLabel}>{t('dca.monthly', { cur })}</span>
          <input className="input" type="number" inputMode="decimal" step="any" min="0" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </label>
        <div>
          <span style={fieldLabel}>{t('dca.period')}</span>
          <div className="segmented" role="group" aria-label={t('dca.period')}>
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
              <div style={{ fontSize: 11, color: theme.colors.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('dca.invested')}</div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: theme.mono, color: theme.colors.text }}>{fmtMoney(result.invested, cur)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: theme.colors.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('dca.valueNow')}</div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: theme.mono, color: theme.colors.up }}>{fmtMoney(result.value, cur)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: theme.colors.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('dca.return')}</div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: theme.mono, color: result.returnPct >= 0 ? theme.colors.up : theme.colors.down }}>{fmtSignedPct(result.returnPct)}</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: theme.colors.textFaint }}>
            {t('dca.summary', { amount: fmtMoney(Number(monthly) || 0, cur), symbol, range })}
          </div>
        </>
      )}
    </div>
  );
}
