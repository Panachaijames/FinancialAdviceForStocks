import React, { useEffect, useMemo, useState } from 'react';
import { Coins } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { fmtMoney, fmtPct } from '../../lib/format.js';
import { usePortfolioStore } from '../../store/portfolioStore.js';
import { useSettingsStore } from '../../store/settingsStore.js';
import useQuotes from '../../hooks/useQuotes.js';
import useFx from '../../hooks/useFx.js';
import useNetWorth from '../../hooks/useNetWorth.js';
import { useT } from '../../lib/i18n.js';
import { getDividend } from '../../api/client.js';
import { computeDividendIncome } from '../../lib/dividends.js';
import { projectDividends } from '../../lib/planning.js';
import ProjectionChart from '../ProjectionChart.jsx';
import { PanelHeader } from './SavingsPanel.jsx';

const DIV_TYPES = new Set(['us_stock', 'etf', 'th_stock']);

const fieldLabel = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: theme.colors.textDim,
  fontWeight: 600,
  display: 'block',
  marginBottom: 4,
};

/**
 * Projects the portfolio's dividend income forward using REAL per-holding yields.
 */
export default function DividendProjection() {
  const t = useT();
  const holdings = usePortfolioStore((s) => s.holdings);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const { quotes } = useQuotes(symbols);
  const { convert } = useFx();
  const { investments } = useNetWorth();

  const [divs, setDivs] = useState({}); // symbol -> Dividend
  const [years, setYears] = useState('10');
  const [growth, setGrowth] = useState('5');
  const [reinvest, setReinvest] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const wanted = holdings.filter((h) => DIV_TYPES.has(h.type)).map((h) => h.symbol).filter((s) => !(s in divs));
    if (wanted.length === 0) return undefined;
    (async () => {
      for (const sym of wanted) {
        try {
          const d = await getDividend(sym);
          if (!cancelled) setDivs((p) => ({ ...p, [sym]: d }));
        } catch {
          if (!cancelled) setDivs((p) => ({ ...p, [sym]: null }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings]);

  // Current annual dividend income across the portfolio (display currency).
  const annualIncome = useMemo(() => {
    let total = 0;
    for (const h of holdings) {
      const d = divs[h.symbol];
      if (!d) continue;
      const q = quotes[h.symbol];
      const native = h.currency || (h.type === 'th_stock' ? 'THB' : 'USD');
      const price = q && Number(q.price) > 0 ? Number(q.price) : Number(h.avgCost) || 0;
      const income = computeDividendIncome({
        shares: Number(h.shares) || 0,
        dividend: d,
        price,
        fxConvert: (amt, from) => convert(amt, from),
      });
      if (income && Number.isFinite(income.annual)) total += income.annual;
    }
    return total;
  }, [holdings, divs, quotes, convert]);

  const yieldPct = investments > 0 ? (annualIncome / investments) * 100 : 0;

  const proj = useMemo(
    () => projectDividends({ annualIncome, yieldPct, dividendGrowthPct: Number(growth) || 0, years: Number(years) || 0, reinvest }),
    [annualIncome, yieldPct, growth, years, reinvest]
  );

  const chartSeries = [{ values: proj.series.map((p) => p.income), color: theme.colors.gold, area: true }];

  if (annualIncome <= 0) {
    return (
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: theme.space(2) }}>
        <PanelHeader icon={<Coins size={16} />} title={t('divproj.title')} />
        <div style={{ fontSize: 13, color: theme.colors.textDim }}>
          {t('divproj.empty')}
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
      <PanelHeader icon={<Coins size={16} />} title={t('divproj.title')} />

      <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: theme.colors.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('divproj.income_now')}</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: theme.mono, color: theme.colors.gold }}>{fmtMoney(annualIncome, displayCurrency)}/yr</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: theme.colors.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('divproj.portfolio_yield')}</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: theme.mono, color: theme.colors.text }}>{fmtPct(yieldPct)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: theme.space(2), alignItems: 'end' }}>
        <label>
          <span style={fieldLabel}>{t('divproj.years')}</span>
          <input className="input" type="number" inputMode="numeric" step="1" min="1" value={years} onChange={(e) => setYears(e.target.value)} />
        </label>
        <label>
          <span style={fieldLabel}>{t('divproj.div_growth')}</span>
          <input className="input" type="number" inputMode="decimal" step="any" value={growth} onChange={(e) => setGrowth(e.target.value)} />
        </label>
        <label>
          <span style={fieldLabel}>{t('divproj.reinvest')}</span>
          <div className="segmented" role="group" aria-label={t('divproj.reinvest_aria')}>
            {[[t('divproj.on'), true], [t('divproj.off'), false]].map(([label, v]) => (
              <button key={String(v)} type="button" className="segmented-item" aria-pressed={reinvest === v} onClick={() => setReinvest(v)} style={{ background: reinvest === v ? theme.colors.accent : 'transparent', color: reinvest === v ? '#fff' : theme.colors.textDim }}>
                {label}
              </button>
            ))}
          </div>
        </label>
      </div>

      <ProjectionChart series={chartSeries} height={130} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: theme.space(2) }}>
        <div>
          <div style={{ fontSize: 11, color: theme.colors.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('divproj.income_in_years', { years })}</div>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: theme.mono, color: theme.colors.gold }}>{fmtMoney(proj.finalIncome, displayCurrency)}/yr</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: theme.colors.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('divproj.total_received', { years })}</div>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: theme.mono, color: theme.colors.text }}>{fmtMoney(proj.cumulative, displayCurrency)}</div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: theme.colors.textFaint }}>
        {t('divproj.assumes', { mode: reinvest ? t('divproj.mode_reinvest') : t('divproj.mode_cash'), growth: growth || 0 })}
      </div>
    </div>
  );
}
