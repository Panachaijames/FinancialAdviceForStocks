import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { DIVIDEND_ERROR, isDividendError } from '../lib/dividendState.js';
import marketSocket from '../api/socket.js';
import { realizedByCurrency, dividendsByCurrency } from '../lib/trades.js';
import { useT } from '../lib/i18n.js';
import CountUp from './fx/CountUp.jsx';
import SpotlightCard from './fx/SpotlightCard.jsx';
import Reveal from './fx/Reveal.jsx';
import Odometer from './fx/Odometer.jsx';
import styles from './PortfolioSummary.module.css';
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
  const t = useT();
  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const { quotes, loading, error } = useQuotes(symbols);
  const { convert, rate, fx } = useFx();
  const { funds: fundRows } = useFunds();

  // Lazily fetch dividends for dividend-paying holdings; cache by symbol.
  const [divs, setDivs] = useState({}); // symbol -> Dividend | null (none) | DIVIDEND_ERROR (fetch failed)
  const [divRetry, setDivRetry] = useState(0);
  const divsRef = useRef(divs);
  divsRef.current = divs;
  // Recovery trigger: on (re)connect, retry the fetch effect ONLY when some
  // dividend actually failed — so a startup 429 no longer pins a confident
  // "0.00", without a startup double-fetch or re-requesting resolved dividends.
  useEffect(
    () =>
      marketSocket.onStatus((on) => {
        if (on && Object.values(divsRef.current).some(isDividendError)) setDivRetry((n) => n + 1);
      }),
    []
  );
  useEffect(() => {
    let cancelled = false;
    const wanted = holdings
      .filter((h) => DIV_TYPES.has(h.type))
      .map((h) => h.symbol)
      // not yet fetched, OR the last fetch failed (retry on this recovery tick)
      .filter((sym) => !(sym in divs) || isDividendError(divs[sym]));
    if (wanted.length === 0) return undefined;

    (async () => {
      for (const sym of wanted) {
        try {
          const d = await getDividend(sym);
          if (cancelled) return;
          setDivs((prev) => ({ ...prev, [sym]: d }));
        } catch {
          if (cancelled) return;
          // Error sentinel (NOT null): retried on recovery, rendered as unknown
          // rather than a confident zero.
          setDivs((prev) => ({ ...prev, [sym]: DIVIDEND_ERROR }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, divRetry]);

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

      // Dividend income. Skip the error sentinel — an unknown dividend must not
      // be counted as zero income.
      const d = divs[h.symbol];
      if (d && !isDividendError(d)) {
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

  // Dividends actually RECEIVED (net of withholding), from the ledger — distinct
  // from the PROJECTED "Annual Dividends" card above.
  const dividendsReceived = useMemo(() => {
    const byCur = dividendsByCurrency(transactions);
    return Object.entries(byCur).reduce((sum, [c, v]) => sum + convert(v, c), 0);
  }, [transactions, convert]);
  const hasDividends = useMemo(
    () => (transactions || []).some((t) => t && t.side === 'dividend'),
    [transactions]
  );

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

  // Record today's value once per session (same real-quote + real-fx guard as the
  // ATH ledger) for the performance history — the cheap fallback for holdings that
  // have no trade ledger. Ref-guarded so it fires once, not on every price tick.
  const snapshotDoneRef = useRef(false);
  useEffect(() => {
    if (snapshotDoneRef.current) return;
    // Never bake a demo-inflated total into the persistent value history — it
    // would survive clearDemo() as a permanent bogus data point.
    if (holdings.some((h) => h.demo)) return;
    if (quotesReady && fx != null && fx.source !== 'default' && usdTotal > 0) {
      usePortfolioStore.getState().recordSnapshot(usdTotal);
      snapshotDoneRef.current = true;
    }
  }, [quotesReady, fx, usdTotal, holdings]);

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
      label: t('summary.marketValue'),
      icon: <Wallet size={16} />,
      value: totals.marketValue,
      format: fmtCur,
      sub: partial
        ? `${t('summary.cost')} ${fmtMoney(totals.cost, cur)} · ${quotedCount}/${holdings.length} priced live`
        : `${t('summary.cost')} ${fmtMoney(totals.cost, cur)}`,
      subTitle: partial
        ? 'Holdings without a live quote are valued at your average cost'
        : undefined,
      color: theme.colors.text,
      accent: theme.colors.accent,
    },
    {
      key: 'pl',
      label: t('summary.totalPL'),
      icon: totals.pl >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />,
      value: totals.pl,
      format: fmtCur,
      sub: fmtSignedPct(totals.plPct),
      color: colorForChange(totals.pl),
      accent: colorForChange(totals.pl),
    },
    {
      key: 'today',
      label: t('summary.todaysChange'),
      icon: <Activity size={16} />,
      value: totals.todayChange,
      format: fmtCur,
      sub: fmtSignedPct(totals.todayPct),
      color: colorForChange(totals.todayChange),
      accent: colorForChange(totals.todayChange),
    },
    {
      key: 'div',
      label: t('summary.annualDividends'),
      icon: <Coins size={16} />,
      value: totals.annualDividend,
      format: fmtCur,
      sub: t('summary.yield', { pct: totals.yieldPct.toFixed(2) }),
      color: totals.annualDividend > 0 ? theme.colors.gold : theme.colors.textDim,
      accent: theme.colors.gold,
    },
    // Only once a sell has been recorded — before that the card is just noise.
    ...(hasSells
      ? [
          {
            key: 'realized',
            label: t('summary.realizedPL'),
            icon: <BadgeDollarSign size={16} />,
            value: realized,
            format: fmtCur,
            sub: t('summary.fromSells'),
            color: colorForChange(realized),
            accent: colorForChange(realized),
          },
        ]
      : []),
    // Only once a dividend has been logged.
    ...(hasDividends
      ? [
          {
            key: 'dividends-received',
            label: t('summary.dividendsReceived'),
            icon: <Coins size={16} />,
            value: dividendsReceived,
            format: fmtCur,
            sub: t('summary.loggedNetWht'),
            color: theme.colors.gold,
            accent: theme.colors.gold,
          },
        ]
      : []),
  ];

  return (
    <>
      {celebrating && (
        <CelebrationBurst value={totals.marketValue} currency={displayCurrency} onDone={dismiss} />
      )}
    <div className={styles.grid}>
      {cards.map((c, i) => {
        // Realized P/L and dividends derive from recorded transactions, not quotes — no skeleton.
        const skel = showSkeleton && c.key !== 'realized' && c.key !== 'dividends-received';
        return (
        <Reveal key={c.key} delay={Math.min(i * 70, 350)} style={{ minWidth: 0 }}>
          <SpotlightCard
            className={`panel ${styles.card}`}
            glowColor={c.accent + '26'}
            style={{ '--card-accent': c.accent }}
          >
            <div className={styles.label}>
              <span className={styles.labelIcon}>{c.icon}</span>
              {c.label}
            </div>
            {skel ? (
              /* First quote batch in flight — never tween from cost-basis zeros */
              <div className="skeleton" style={{ height: 26, width: '70%' }} />
            ) : c.key === 'mv' ? (
              /* Market Value gets the mechanical rolling-digit odometer */
              <Odometer value={c.value} format={c.format} className={`${styles.value} pm-mask`} style={{ color: c.color }} />
            ) : (
              <CountUp value={c.value} format={c.format} className={`${styles.value} pm-mask`} style={{ color: c.color }} />
            )}
            <div className="pm-mask" style={{ fontSize: 13, color: c.color, fontWeight: 600 }} title={c.subTitle}>
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
