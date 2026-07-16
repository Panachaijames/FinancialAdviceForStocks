import React, { useMemo, useState } from 'react';
import { TrendingUp, Loader2, RefreshCw } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { fmtMoney, fmtSignedPct } from '../lib/format.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import { useSettingsStore } from '../store/settingsStore.js';
import useFx from '../hooks/useFx.js';
import { useT } from '../lib/i18n.js';
import { getCandles } from '../api/client.js';
import { buildPerformanceSeries, summarize } from '../lib/performance.js';
import ProjectionChart from './ProjectionChart.jsx';

const RANGES = ['3mo', '6mo', '1y', '2y'];

/**
 * "How has MY portfolio done?" — replays the trade ledger against each holding's
 * daily closes into a per-day market-value / net-invested / realized history
 * (lib/performance.js), and shows Total P/L = value − net invested. When there
 * are no recorded trades to replay, falls back to the cheap daily value
 * snapshots. Data loads on demand to keep the API quiet.
 */
export default function PerformancePanel() {
  const holdings = usePortfolioStore((s) => s.holdings);
  const transactions = usePortfolioStore((s) => s.transactions);
  const snapshots = usePortfolioStore((s) => s.snapshots);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const { convert } = useFx();
  const t = useT();

  const [range, setRange] = useState('6mo');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { range, series, summary }

  // Every symbol we may need a price history for: current holdings + any symbol
  // that appears in the ledger (a position bought and later fully sold still
  // contributed market value while it was held).
  const symbols = useMemo(() => {
    const set = new Set();
    for (const h of holdings) if (h && h.symbol) set.add(h.symbol);
    for (const t of transactions || []) if (t && t.symbol) set.add(t.symbol);
    return Array.from(set);
  }, [holdings, transactions]);

  const currencyBySymbol = useMemo(() => {
    const m = {};
    for (const h of holdings) if (h && h.symbol) m[h.symbol] = h.currency || (h.type === 'th_stock' ? 'THB' : 'USD');
    for (const t of transactions || []) if (t && t.symbol && !m[t.symbol] && t.currency) m[t.symbol] = t.currency;
    return m;
  }, [holdings, transactions]);

  const hasLedger = (transactions || []).some((t) => t && (t.side === 'buy' || t.side === 'sell'));

  // Snapshot fallback series (display currency), when there's no ledger to replay.
  const snapshotSeries = useMemo(() => {
    const pts = (snapshots || []).filter((s) => s && Number(s.usd) > 0);
    if (pts.length < 2) return null;
    return {
      values: pts.map((s) => convert(Number(s.usd), 'USD')),
      first: pts[0].d,
      last: pts[pts.length - 1].d,
    };
  }, [snapshots, convert]);

  async function run(nextRange = range) {
    if (symbols.length === 0) return;
    setLoading(true);
    setError('');
    try {
      const fetched = await Promise.all(symbols.map((s) => getCandles(s, nextRange, '1d').catch(() => [])));
      // Only replay symbols we could actually price. A symbol whose fetch failed
      // (empty) would otherwise keep its cost in net-invested while contributing
      // nothing to market value — a phantom loss. Exclude it from BOTH and warn,
      // so the two figures always cover the same set.
      const priced = symbols.filter((s, i) => (fetched[i] || []).length >= 2);
      const missing = symbols.filter((s, i) => (fetched[i] || []).length < 2);
      const closesBySymbol = {};
      priced.forEach((s) => {
        closesBySymbol[s] = fetched[symbols.indexOf(s)];
      });
      const pricedSet = new Set(priced);
      const txForPriced = (transactions || []).filter((t) => t && pricedSet.has(t.symbol));
      const series = buildPerformanceSeries({ transactions: txForPriced, closesBySymbol, currencyBySymbol, convert });
      if (!series.times.length) throw new Error(t('perf.errNoHistory'));
      setResult({ range: nextRange, series, summary: summarize(series), missing });
    } catch (e) {
      setError((e && e.message) || t('perf.errLoadFailed'));
    } finally {
      setLoading(false);
    }
  }

  if (holdings.length === 0 && (!snapshots || snapshots.length === 0)) return null;

  const replayMeaningful = result && result.series.marketValue.some((v) => v > 0);
  const s = result?.summary;
  const plColor = (v) => (v >= 0 ? theme.colors.up : theme.colors.down);

  return (
    <div className="panel" style={{ padding: theme.space(3), display: 'flex', flexDirection: 'column', gap: theme.space(2) }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(2), flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(1), fontWeight: 700, fontSize: 13, color: theme.colors.text }}>
          <TrendingUp size={15} style={{ color: theme.colors.accent }} />
          {t('perf.title')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(2) }}>
          <div className="segmented" role="group" aria-label={t('perf.rangeAria')}>
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                className={`segmented-item${r === range ? ' active' : ''}`}
                aria-pressed={r === range}
                onClick={() => {
                  setRange(r);
                  if (result || loading) run(r);
                }}
                style={r === range ? { color: theme.colors.text } : undefined}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => run()}
            disabled={loading || symbols.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: theme.colors.accent }}
          >
            {loading ? <Loader2 size={14} style={{ animation: 'pulse 1s linear infinite' }} /> : <RefreshCw size={14} />}
            {loading ? t('perf.loading') : result ? t('perf.refresh') : t('perf.show')}
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ fontSize: 13, color: theme.colors.down }}>{error}</div>
      ) : replayMeaningful ? (
        <>
          <ProjectionChart
            series={[
              { values: result.series.marketValue, color: theme.colors.accent, area: true },
              { values: result.series.invested, color: theme.colors.textDim },
            ]}
            height={180}
          />
          <div style={{ display: 'flex', gap: theme.space(4), flexWrap: 'wrap' }}>
            <Stat label={t('perf.currentValue')} value={fmtMoney(s.currentValue, displayCurrency)} color={theme.colors.text} swatch={theme.colors.accent} />
            <Stat label={t('perf.netInvested')} value={fmtMoney(s.netInvested, displayCurrency)} color={theme.colors.textDim} swatch={theme.colors.textDim} />
            <Stat
              label={t('perf.totalPL')}
              value={`${fmtMoney(s.totalPL, displayCurrency)}${s.plPct != null ? ` (${fmtSignedPct(s.plPct)})` : ''}`}
              color={plColor(s.totalPL)}
            />
            {s.realized !== 0 && (
              <Stat label={t('perf.realized')} value={fmtMoney(s.realized, displayCurrency)} color={plColor(s.realized)} />
            )}
          </div>
          {result.missing && result.missing.length > 0 && (
            <div style={{ fontSize: 11, color: theme.colors.warn }}>
              ⚠ {t('perf.missingData', { names: result.missing.join(', ') })}
            </div>
          )}
          <div style={{ fontSize: 10.5, color: theme.colors.textFaint }}>
            {t('perf.footerLead')} ·{' '}
            <b style={{ color: theme.colors.accent }}>{t('perf.valueWord')}</b> {t('perf.vs')}{' '}
            <b style={{ color: theme.colors.textDim }}>{t('perf.netInvestedWord')}</b> · {t('perf.footerTail')}
          </div>
        </>
      ) : result && !replayMeaningful && snapshotSeries ? (
        <>
          <ProjectionChart series={[{ values: snapshotSeries.values, color: theme.colors.accent, area: true }]} height={180} />
          <div style={{ fontSize: 11.5, color: theme.colors.textDim }}>
            {t('perf.snapshotLead')} <b>{t('perf.recordedDailyValue')}</b>{' '}
            {t('perf.snapshotTrail', { count: snapshotSeries.values.length })}
          </div>
        </>
      ) : result ? (
        <div style={{ fontSize: 12.5, color: theme.colors.textDim }}>
          {t('perf.notEnough')}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: theme.colors.textDim }}>
          {t('perf.introLead')} <b>{t('perf.show')}</b> {t('perf.introTail')}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color, swatch }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: theme.space(1) }}>
      {swatch && <span style={{ color: swatch }}>▬</span>}
      <span style={{ fontSize: 12, color: theme.colors.textDim, fontWeight: 600 }}>{label}</span>
      <span className="pm-mask" style={{ fontSize: 14, fontWeight: 800, fontFamily: theme.mono, color }}>{value}</span>
    </div>
  );
}
