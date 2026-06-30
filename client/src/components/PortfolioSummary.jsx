import React, { useEffect, useMemo, useState } from 'react';
import { Wallet, TrendingUp, TrendingDown, Coins, Activity } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { fmtMoney, fmtSignedPct, classForChange } from '../lib/format.js';
import { useSettingsStore } from '../store/settingsStore.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import useQuotes from '../hooks/useQuotes.js';
import useFx from '../hooks/useFx.js';
import useFunds from '../hooks/useFunds.js';
import { getDividend } from '../api/client.js';
import { computeDividendIncome } from '../lib/dividends.js';

const DIV_TYPES = new Set(['us_stock', 'etf', 'th_stock']);

function colorForChange(v) {
  const c = classForChange(v);
  if (c === 'up') return theme.colors.up;
  if (c === 'down') return theme.colors.down;
  return theme.colors.textDim;
}

/**
 * Portfolio totals row, all values shown in the display currency.
 */
export default function PortfolioSummary() {
  const holdings = usePortfolioStore((s) => s.holdings);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const { quotes } = useQuotes(symbols);
  const { convert } = useFx();
  const { funds: fundRows } = useFunds();

  // Lazily fetch dividends for dividend-paying holdings; cache by symbol.
  const [divs, setDivs] = useState({}); // symbol -> Dividend
  useEffect(() => {
    let cancelled = false;
    const wanted = holdings
      .filter((h) => DIV_TYPES.has(h.type))
      .map((h) => h.symbol)
      .filter((sym) => !(sym in divs));
    if (wanted.length === 0) return undefined;

    (async () => {
      for (const sym of wanted) {
        try {
          const d = await getDividend(sym);
          if (cancelled) return;
          setDivs((prev) => ({ ...prev, [sym]: d }));
        } catch {
          if (cancelled) return;
          setDivs((prev) => ({ ...prev, [sym]: null }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings]);

  const totals = useMemo(() => {
    let marketValue = 0;
    let cost = 0;
    let todayChange = 0;
    let prevMarketValue = 0;
    let annualDividend = 0;

    for (const h of holdings) {
      const q = quotes[h.symbol];
      const native = h.currency || (h.type === 'th_stock' ? 'THB' : 'USD');
      const price = q && Number.isFinite(Number(q.price)) ? Number(q.price) : h.avgCost;
      const shares = Number(h.shares) || 0;

      const mvNative = shares * price;
      const costNative = shares * (Number(h.avgCost) || 0);

      const mv = convert(mvNative, native);
      const cb = convert(costNative, native);
      marketValue += mv;
      cost += cb;

      // Today's change from prevClose.
      const prevClose =
        q && Number.isFinite(Number(q.prevClose)) ? Number(q.prevClose) : price;
      const prevMvNative = shares * prevClose;
      prevMarketValue += convert(prevMvNative, native);

      // Dividend income.
      const d = divs[h.symbol];
      if (d) {
        const income = computeDividendIncome({
          shares,
          dividend: d,
          price,
          fxConvert: (amountNative, fromCurrency) => convert(amountNative, fromCurrency),
        });
        if (income && Number.isFinite(income.annual)) {
          annualDividend += income.annual;
        }
      }
    }

    // Thai funds (NAV in THB) — counted as part of the portfolio.
    for (const f of fundRows) {
      const valueThb = f.valueThb != null ? f.valueThb : f.costThb;
      marketValue += convert(valueThb, 'THB');
      cost += convert(f.costThb, 'THB');
      const prevThb = f.changePct != null ? valueThb / (1 + f.changePct / 100) : valueThb;
      prevMarketValue += convert(prevThb, 'THB');
    }

    todayChange = marketValue - prevMarketValue;
    const pl = marketValue - cost;
    const plPct = cost > 0 ? (pl / cost) * 100 : 0;
    const todayPct = prevMarketValue > 0 ? (todayChange / prevMarketValue) * 100 : 0;
    const yieldPct = marketValue > 0 ? (annualDividend / marketValue) * 100 : 0;

    return {
      marketValue,
      cost,
      pl,
      plPct,
      todayChange,
      todayPct,
      annualDividend,
      yieldPct,
    };
  }, [holdings, quotes, divs, convert, fundRows]);

  if (holdings.length === 0) return null;

  const cur = displayCurrency;

  const cards = [
    {
      key: 'mv',
      label: 'Market Value',
      icon: <Wallet size={16} />,
      value: fmtMoney(totals.marketValue, cur),
      sub: `Cost ${fmtMoney(totals.cost, cur)}`,
      color: theme.colors.text,
      accent: theme.colors.accent,
    },
    {
      key: 'pl',
      label: 'Total P/L',
      icon: totals.pl >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />,
      value: fmtMoney(totals.pl, cur),
      sub: fmtSignedPct(totals.plPct),
      color: colorForChange(totals.pl),
      accent: colorForChange(totals.pl),
    },
    {
      key: 'today',
      label: "Today's Change",
      icon: <Activity size={16} />,
      value: fmtMoney(totals.todayChange, cur),
      sub: fmtSignedPct(totals.todayPct),
      color: colorForChange(totals.todayChange),
      accent: colorForChange(totals.todayChange),
    },
    {
      key: 'div',
      label: 'Annual Dividends',
      icon: <Coins size={16} />,
      value: fmtMoney(totals.annualDividend, cur),
      sub: `${totals.yieldPct.toFixed(2)}% yield`,
      color: totals.annualDividend > 0 ? theme.colors.gold : theme.colors.textDim,
      accent: theme.colors.gold,
    },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: theme.space(3),
      }}
    >
      {cards.map((c) => (
        <div
          key={c.key}
          className="panel"
          style={{
            padding: theme.space(3),
            display: 'flex',
            flexDirection: 'column',
            gap: theme.space(1),
            borderLeft: `3px solid ${c.accent}`,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.space(1),
              color: theme.colors.textDim,
              fontSize: 12,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
            }}
          >
            <span style={{ color: c.accent, display: 'flex' }}>{c.icon}</span>
            {c.label}
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: c.color,
              fontFamily: theme.mono,
              lineHeight: 1.1,
            }}
          >
            {c.value}
          </div>
          <div style={{ fontSize: 13, color: c.color, fontWeight: 600 }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
