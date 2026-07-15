import React, { useMemo, useState } from 'react';
import { LineChart, Loader2, RefreshCw } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { fmtSignedPct } from '../lib/format.js';
import { useT } from '../lib/i18n.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import useQuotes from '../hooks/useQuotes.js';
import useFx from '../hooks/useFx.js';
import { getCandles } from '../api/client.js';
import { alignSeries, blendIndexed, indexTo100, totalReturnPct } from '../lib/benchmark.js';
import ProjectionChart from './ProjectionChart.jsx';

const RANGES = ['3mo', '6mo', '1y', '2y'];
const BENCHMARKS = [
  { symbol: '^GSPC', label: 'S&P 500', color: theme.colors.gold },
  { symbol: '^SET.BK', label: 'SET Index', color: theme.colors.crypto },
];

/**
 * "Did my mix beat the index?" — indexes each holding's daily closes to 100 at
 * the start of the range, blends them by CURRENT market-value weights, and
 * plots the result against the S&P 500 and the SET index. Fixed-weight
 * comparison of today's composition (it does not replay past trades). Data
 * loads on demand to keep the API quiet.
 */
export default function BenchmarkPanel() {
  const t = useT();
  const holdings = usePortfolioStore((s) => s.holdings);
  const symbols = useMemo(
    () => holdings.filter((h) => (Number(h.shares) || 0) > 0).map((h) => h.symbol),
    [holdings]
  );
  const { quotes } = useQuotes(symbols);
  const { convert } = useFx();

  const [range, setRange] = useState('6mo');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { range, series:[{label,color,values,returnPct}] }

  // Current market-value weight per symbol (display currency — only ratios matter).
  const weights = useMemo(() => {
    const w = {};
    for (const h of holdings) {
      const q = quotes[h.symbol];
      const native = h.currency || (h.type === 'th_stock' ? 'THB' : 'USD');
      const price = q && Number(q.price) > 0 ? Number(q.price) : Number(h.avgCost) || 0;
      const mv = convert((Number(h.shares) || 0) * price, native);
      if (mv > 0) w[h.symbol] = (w[h.symbol] || 0) + mv;
    }
    return w;
  }, [holdings, quotes, convert]);

  async function run(nextRange = range) {
    if (symbols.length === 0) return;
    setLoading(true);
    setError('');
    try {
      const all = [...symbols, ...BENCHMARKS.map((b) => b.symbol)];
      const fetched = await Promise.all(
        all.map((s) => getCandles(s, nextRange, '1d').catch(() => []))
      );
      const candlesBySymbol = {};
      all.forEach((s, i) => {
        candlesBySymbol[s] = fetched[i] || [];
      });

      const missingBench = BENCHMARKS.filter((b) => (candlesBySymbol[b.symbol] || []).length < 2);
      const usable = Object.fromEntries(Object.entries(candlesBySymbol).filter(([, v]) => v.length > 1));
      const { closes } = alignSeries(usable);

      const portfolioCloses = Object.fromEntries(
        Object.entries(closes).filter(([s]) => weights[s] > 0)
      );
      const portfolio = blendIndexed(portfolioCloses, weights);
      if (portfolio.length < 2) {
        throw new Error(t('benchmark.errorNoHistory'));
      }

      const series = [
        {
          label: t('benchmark.yourMix'),
          color: theme.colors.accent,
          values: portfolio,
          returnPct: totalReturnPct(portfolio),
          area: true,
        },
      ];
      for (const b of BENCHMARKS) {
        if (!closes[b.symbol]) continue;
        const idx = indexTo100(closes[b.symbol]);
        series.push({ label: b.label, color: b.color, values: idx, returnPct: totalReturnPct(idx) });
      }
      setResult({ range: nextRange, series, missing: missingBench.map((b) => b.label) });
    } catch (e) {
      setError((e && e.message) || t('benchmark.errorFallback'));
    } finally {
      setLoading(false);
    }
  }

  if (symbols.length === 0) return null;

  return (
    <div className="panel" style={{ padding: theme.space(3), display: 'flex', flexDirection: 'column', gap: theme.space(2) }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(2), flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(1), fontWeight: 700, fontSize: 13, color: theme.colors.text }}>
          <LineChart size={15} style={{ color: theme.colors.accent }} />
          {t('benchmark.title')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(2) }}>
          <div className="segmented" role="group" aria-label={t('benchmark.rangeAria')}>
            {RANGES.map((r) => (
              <button
                key={r}
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
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: theme.colors.accent }}
          >
            {loading ? <Loader2 size={14} style={{ animation: 'pulse 1s linear infinite' }} /> : <RefreshCw size={14} />}
            {loading ? t('benchmark.loading') : result ? t('benchmark.refresh') : t('benchmark.compare')}
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ fontSize: 13, color: theme.colors.down }}>{error}</div>
      ) : result ? (
        <>
          <ProjectionChart series={result.series.map((s) => ({ values: s.values, color: s.color, area: s.area }))} height={170} />
          <div style={{ display: 'flex', gap: theme.space(4), flexWrap: 'wrap' }}>
            {result.series.map((s) => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'baseline', gap: theme.space(1) }}>
                <span style={{ color: s.color }}>▬</span>
                <span style={{ fontSize: 12, color: theme.colors.textDim, fontWeight: 600 }}>{s.label}</span>
                <span style={{ fontSize: 14, fontWeight: 800, fontFamily: theme.mono, color: s.returnPct >= 0 ? theme.colors.up : theme.colors.down }}>
                  {fmtSignedPct(s.returnPct)}
                </span>
              </div>
            ))}
          </div>
          {result.missing && result.missing.length > 0 && (
            <div style={{ fontSize: 11, color: theme.colors.warn }}>
              {t('benchmark.noData', { list: result.missing.join(', ') })}
            </div>
          )}
          <div style={{ fontSize: 10.5, color: theme.colors.textFaint }}>
            {t('benchmark.footnotePre')} <b>{t('benchmark.footnoteCurrent')}</b> {t('benchmark.footnotePost')}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: theme.colors.textDim }}>
          {t('benchmark.emptyStatePre')} <b>S&amp;P 500</b> {t('benchmark.emptyStateMid')} <b>SET Index</b>{' '}
          {t('benchmark.emptyStatePost')} <b>{t('benchmark.compare')}</b> {t('benchmark.emptyStateEnd')}
        </div>
      )}
    </div>
  );
}
