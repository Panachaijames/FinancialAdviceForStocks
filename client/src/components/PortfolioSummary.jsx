import React, { useEffect, useMemo, useState } from 'react';
import { Wallet, TrendingUp, TrendingDown, Coins, Activity, BadgeDollarSign } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { fmtMoney, fmtSignedPct, classForChange, convert as convertCurrency } from '../lib/format.js';
import { useSettingsStore } from '../store/settingsStore.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import useQuotes from '../hooks/useQuotes.js';
import useFx from '../hooks/useFx.js';
import useFunds from '../hooks/useFunds.js';
import { getDividend } from '../api/client.js';
import { computeDividendIncome } from '../lib/dividends.js';
import { realizedByCurrency } from '../lib/trades.js';
import CountUp from './fx/CountUp.jsx';
import SpotlightCard from './fx/SpotlightCard.jsx';
import Reveal from './fx/Reveal.jsx';
import Odometer from './fx/Odometer.jsx';
import CelebrationBurst from './fx/CelebrationBurst.jsx';
import useAllTimeHigh from '../hooks/useAllTimeHigh.js';

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
  const transactions = usePortfolioStore((s) => s.transactions);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const { quotes, loading, error } = useQuotes(symbols);
  const { convert, rate, fx } = useFx();
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
      const price = q && Number(q.price) > 0 ? Number(q.price) : h.avgCost;
      const shares = Number(h.shares) || 0;

      const mvNative = shares * price;
      const costNative = shares * (Number(h.avgCost) || 0);

      const mv = convert(mvNative, native);
      const cb = convert(costNative, native);
      marketValue += mv;
      cost += cb;

      // Today's change from prevClose.
      const prevClose =
        q && Number(q.prevClose) > 0 ? Number(q.prevClose) : price;
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

  // Realized P/L banked from recorded sells (display currency).
  const realized = useMemo(() => {
    const byCur = realizedByCurrency(transactions);
    return Object.entries(byCur).reduce((sum, [c, v]) => sum + convert(v, c), 0);
  }, [transactions, convert]);
  const hasSells = useMemo(() => (transactions || []).some((t) => t && t.side === 'sell'), [transactions]);

  // All-time-high tracking (currency-stable in USD). Guards: only once every
  // holding has a LIVE quote AND the real FX rate has loaded — otherwise the
  // avgCost/DEFAULT_RATE fallbacks could seed a bogus high-water mark.
  const quotesReady =
    holdings.length > 0 &&
    holdings.every((h) => {
      const q = quotes[h.symbol];
      return q && Number(q.price) > 0;
    });
  const usdTotal = convertCurrency(totals.marketValue, displayCurrency, 'USD', rate);
  const { celebrating, dismiss } = useAllTimeHigh({
    usdValue: usdTotal,
    // Gate the ATH ledger on a REAL fx rate: source 'default' is the hardcoded
    // 36 fallback, which could otherwise immortalize a bogus all-time-high.
    ready: quotesReady && fx != null && fx.source !== 'default',
  });

  // Honest number states: skeleton while the first batch is in flight; once
  // settled (or the fetch gave up), flag any holdings still valued at cost.
  const showSkeleton = loading && !error && !quotesReady; // first load in flight
  const quotedCount = holdings.filter((h) => {
    const q = quotes[h.symbol];
    return q && Number(q.price) > 0;
  }).length;
  const partial = !showSkeleton && quotedCount < holdings.length; // settled (or gave up) with gaps

  if (holdings.length === 0) return null;

  const cur = displayCurrency;

  // `value` is the RAW number; CountUp tweens it and `format` renders currency.
  const fmtCur = (n) => fmtMoney(n, cur);
  const cards = [
    {
      key: 'mv',
      label: 'Market Value',
      icon: <Wallet size={16} />,
      value: totals.marketValue,
      format: fmtCur,
      sub: partial
        ? `Cost ${fmtMoney(totals.cost, cur)} · ${quotedCount}/${holdings.length} priced live`
        : `Cost ${fmtMoney(totals.cost, cur)}`,
      subTitle: partial
        ? 'Holdings without a live quote are valued at your average cost'
        : undefined,
      color: theme.colors.text,
      accent: theme.colors.accent,
    },
    {
      key: 'pl',
      label: 'Total P/L',
      icon: totals.pl >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />,
      value: totals.pl,
      format: fmtCur,
      sub: fmtSignedPct(totals.plPct),
      color: colorForChange(totals.pl),
      accent: colorForChange(totals.pl),
    },
    {
      key: 'today',
      label: "Today's Change",
      icon: <Activity size={16} />,
      value: totals.todayChange,
      format: fmtCur,
      sub: fmtSignedPct(totals.todayPct),
      color: colorForChange(totals.todayChange),
      accent: colorForChange(totals.todayChange),
    },
    {
      key: 'div',
      label: 'Annual Dividends',
      icon: <Coins size={16} />,
      value: totals.annualDividend,
      format: fmtCur,
      sub: `${totals.yieldPct.toFixed(2)}% yield`,
      color: totals.annualDividend > 0 ? theme.colors.gold : theme.colors.textDim,
      accent: theme.colors.gold,
    },
    // Only once a sell has been recorded — before that the card is just noise.
    ...(hasSells
      ? [
          {
            key: 'realized',
            label: 'Realized P/L',
            icon: <BadgeDollarSign size={16} />,
            value: realized,
            format: fmtCur,
            sub: 'from recorded sells',
            color: colorForChange(realized),
            accent: colorForChange(realized),
          },
        ]
      : []),
  ];

  return (
    <>
      {celebrating && (
        <CelebrationBurst value={totals.marketValue} currency={displayCurrency} onDone={dismiss} />
      )}
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: theme.space(3),
      }}
    >
      {cards.map((c, i) => {
        // Realized P/L derives from recorded transactions, not quotes — no skeleton.
        const skel = showSkeleton && c.key !== 'realized';
        return (
        <Reveal key={c.key} delay={Math.min(i * 70, 350)} style={{ minWidth: 0 }}>
          <SpotlightCard
            className="panel"
            glowColor={c.accent + '26'}
            style={{
              height: '100%',
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
            {skel ? (
              /* First quote batch in flight — never tween from cost-basis zeros */
              <div className="skeleton" style={{ height: 26, width: '70%' }} />
            ) : c.key === 'mv' ? (
              /* Market Value gets the mechanical rolling-digit odometer */
              <Odometer
                value={c.value}
                format={c.format}
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  color: c.color,
                  fontFamily: theme.mono,
                  lineHeight: 1.1,
                  display: 'block',
                }}
              />
            ) : (
              <CountUp
                value={c.value}
                format={c.format}
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  color: c.color,
                  fontFamily: theme.mono,
                  lineHeight: 1.1,
                  display: 'block',
                }}
              />
            )}
            <div style={{ fontSize: 13, color: c.color, fontWeight: 600 }} title={c.subTitle}>
              {skel ? ' ' : c.sub}
            </div>
          </SpotlightCard>
        </Reveal>
        );
      })}
    </div>
    </>
  );
}
