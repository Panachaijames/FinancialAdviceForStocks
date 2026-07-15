import React, { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2, Bell } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { fmtMoney, fmtNumber, fmtSignedPct, classForChange } from '../lib/format.js';
import { assetMeta } from '../lib/assetType.js';
import useQuotes from '../hooks/useQuotes.js';
import useFx from '../hooks/useFx.js';
import usePriceFlash from '../hooks/usePriceFlash.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import { useSettingsStore } from '../store/settingsStore.js';
import { snackbar } from '../store/snackbarStore.js';
import { getDividend } from '../api/client.js';
import { computeDividendIncome } from '../lib/dividends.js';
import { DIVIDEND_ERROR, isDividendError } from '../lib/dividendState.js';
import marketSocket from '../api/socket.js';
import MiniChart from './MiniChart.jsx';
import SpotlightCard from './fx/SpotlightCard.jsx';
import cardStyles from './AssetCard.module.css';
import CountUp from './fx/CountUp.jsx';
import HoldingEditor from './HoldingEditor.jsx';
import TradeDialog from './TradeDialog.jsx';
import AlertDialog from './AlertDialog.jsx';
import { realizedBySymbol } from '../lib/trades.js';

const DIV_TYPES = new Set(['us_stock', 'etf', 'th_stock']);

function colorForChange(v) {
  const c = classForChange(v);
  if (c === 'up') return theme.colors.up;
  if (c === 'down') return theme.colors.down;
  return theme.colors.textDim;
}

/**
 * Extract a pre-market / after-hours line from a quote, or null if the asset
 * isn't currently in an extended session (or has no extended price — e.g. crypto,
 * which trades 24/7 and never carries pre/post fields).
 */
function extendedQuote(q) {
  if (!q) return null;
  const ms = String(q.marketState || '').toUpperCase();
  const f = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  if ((ms === 'PRE' || ms === 'PREPRE') && f(q.preMarketPrice) != null) {
    return { label: 'Pre-mkt', price: f(q.preMarketPrice), pct: f(q.preMarketChangePct) };
  }
  if ((ms === 'POST' || ms === 'POSTPOST') && f(q.postMarketPrice) != null) {
    return { label: 'After hrs', price: f(q.postMarketPrice), pct: f(q.postMarketChangePct) };
  }
  // Overnight (Blue Ocean ATS via Pyth) — only set when a fresh tick is available.
  if (ms === 'OVERNIGHT' && f(q.overnightPrice) != null) {
    return { label: 'Overnight', price: f(q.overnightPrice), pct: f(q.overnightChangePct) };
  }
  return null;
}

/**
 * A single holding card.
 * Props: { holding, onOpen }
 *   holding: { id, symbol, type, name, currency, shares, avgCost, addedAt }
 *   onOpen():  called when the card body (not a button) is clicked.
 */
export default function AssetCard({ holding, onOpen }) {
  const { symbol, type, name, shares, avgCost } = holding;
  const native = holding.currency || (type === 'th_stock' ? 'THB' : 'USD');
  const meta = assetMeta(type);

  const { quotes, loading, error } = useQuotes([symbol]);
  const { convert } = useFx();
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const updateHolding = usePortfolioStore((s) => s.updateHolding);
  const removeHolding = usePortfolioStore((s) => s.removeHolding);
  const restoreRemoved = usePortfolioStore((s) => s.restoreRemoved);
  const transactions = usePortfolioStore((s) => s.transactions);

  const [editing, setEditing] = useState(false);
  const [trading, setTrading] = useState(null); // null | 'buy' | 'sell'
  const [alerting, setAlerting] = useState(false);
  const [dividend, setDividend] = useState(undefined); // undefined = not fetched, null = none, DIVIDEND_ERROR = failed
  const [divRetry, setDivRetry] = useState(0);
  const dividendRef = useRef(dividend);
  dividendRef.current = dividend;
  // Retry the dividend fetch on reconnect ONLY when the current value is the
  // error sentinel. Never refetch a good or confirmed-null dividend: a transient
  // reconnect failure would otherwise wipe a valid line and re-hammer the
  // rate-limited endpoint this sentinel exists to shield.
  useEffect(
    () =>
      marketSocket.onStatus((on) => {
        if (on && isDividendError(dividendRef.current)) setDivRetry((n) => n + 1);
      }),
    []
  );

  const q = quotes[symbol];
  const price = q && Number(q.price) > 0 ? Number(q.price) : null;
  const changePct = q && Number.isFinite(Number(q.changePct)) ? Number(q.changePct) : null;
  const ext = extendedQuote(q);

  const priceLoading = !q && loading && !error; // first batch still in flight
  const priceMissing = !q && !priceLoading; // fetch failed / gave up — falling back to cost

  const effectivePrice = price != null ? price : Number(avgCost) || 0;
  const mvNative = (Number(shares) || 0) * effectivePrice;
  const costNative = (Number(shares) || 0) * (Number(avgCost) || 0);
  const plNative = mvNative - costNative;
  const plPct = costNative > 0 ? (plNative / costNative) * 100 : 0;

  const mvDisplay = convert(mvNative, native);
  const plDisplay = convert(plNative, native);

  // Lazily fetch dividend for dividend-paying assets.
  useEffect(() => {
    if (!DIV_TYPES.has(type)) {
      setDividend(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const d = await getDividend(symbol);
        if (!cancelled) setDividend(d || null);
      } catch {
        // Error sentinel, not null: retried on reconnect, shown as unknown.
        if (!cancelled) setDividend(DIVIDEND_ERROR);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, type, divRetry]);

  let divLine = null;
  if (dividend && !isDividendError(dividend) && DIV_TYPES.has(type)) {
    const income = computeDividendIncome({
      shares: Number(shares) || 0,
      dividend,
      price: effectivePrice,
      fxConvert: (amountNative, fromCurrency) => convert(amountNative, fromCurrency),
    });
    const yld = dividend.yieldPct != null ? dividend.yieldPct : income?.yieldOnCostPct;
    if (income && Number.isFinite(income.annual) && income.annual > 0) {
      divLine = {
        yieldPct: yld,
        annual: income.annual,
      };
    }
  }

  function handleSave({ shares: s, avgCost: a }) {
    updateHolding(holding.id, { shares: s, avgCost: a });
    setEditing(false);
  }

  function stop(e) {
    e.stopPropagation();
  }

  const priceColor = colorForChange(changePct);
  const plColor = colorForChange(plNative);

  // Trading-terminal tick flash on the live price number.
  const { className: priceFlashClass, flashKey: priceFlashKey } = usePriceFlash(price);

  // Realized P/L already banked on this symbol (from recorded sells).
  const realized = realizedBySymbol(transactions)[symbol];

  return (
    <>
      <SpotlightCard
        id={`card-${symbol}`}
        className={`panel ${cardStyles.card}`}
        role="button"
        tabIndex={0}
        aria-label={`Open ${symbol} chart`}
        onClick={() => onOpen && onOpen()}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return; // let inner buttons handle their own keys
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen && onOpen();
          }
        }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: theme.space(2) }}>
          <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">
            {meta.emoji}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(1) }}>
              <span
                style={{
                  fontWeight: 800,
                  fontSize: 15,
                  fontFamily: theme.mono,
                  color: theme.colors.text,
                }}
              >
                {symbol}
              </span>
              <span
                className="badge"
                style={{ background: meta.color + '22', color: meta.color }}
              >
                {meta.label}
              </span>
            </div>
            <div
              style={{
                fontSize: 12,
                color: theme.colors.textDim,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={name}
            >
              {name || symbol}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              className="btn-ghost"
              aria-label="Set price alert"
              title="Set a price alert"
              onClick={(e) => {
                stop(e);
                setAlerting(true);
              }}
              style={{ padding: 6, lineHeight: 0 }}
            >
              <Bell size={15} />
            </button>
            <button
              type="button"
              className="btn-ghost"
              aria-label="Edit holding"
              title="Edit"
              onClick={(e) => {
                stop(e);
                setEditing(true);
              }}
              style={{ padding: 6, lineHeight: 0 }}
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              className="btn-ghost"
              aria-label="Remove holding"
              title="Remove"
              onClick={(e) => {
                stop(e);
                removeHolding(holding.id);
                snackbar.push({
                  id: 'undo-remove', // single-level: consecutive removes replace it
                  message: `Removed ${symbol}`,
                  actionLabel: 'Undo',
                  onAction: () => restoreRemoved(),
                  duration: 8000,
                });
              }}
              style={{ padding: 6, lineHeight: 0, color: theme.colors.down }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        {/* Price + day change */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: theme.space(2) }}>
          {priceLoading ? (
            <span
              className="skeleton"
              style={{ display: 'inline-block', width: 90, height: 20 }}
              aria-label="Loading price"
            />
          ) : (
            <span
              key={priceFlashKey}
              className={priceFlashClass}
              style={{
                fontSize: 20,
                fontWeight: 800,
                fontFamily: theme.mono,
                color: theme.colors.text,
                borderRadius: theme.radius.sm,
              }}
            >
              {price != null ? fmtMoney(convert(price, native), displayCurrency) : '—'}
            </span>
          )}
          {priceLoading ? null : (
            <span style={{ fontSize: 13, fontWeight: 700, color: priceColor }}>
              {changePct != null ? fmtSignedPct(changePct) : '—'}
            </span>
          )}
        </div>

        {/* Pre-market / after-hours (when the asset is in an extended session) */}
        {ext && (
          <div
            style={{ display: 'flex', alignItems: 'baseline', gap: theme.space(1), marginTop: -theme.space(1) }}
            title={`${ext.label === 'Pre-mkt' ? 'Pre-market' : 'After hours'} price`}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: theme.colors.textFaint,
              }}
            >
              {ext.label}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: theme.mono, color: theme.colors.text }}>
              {fmtMoney(convert(ext.price, native), displayCurrency)}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: colorForChange(ext.pct) }}>
              {ext.pct != null ? fmtSignedPct(ext.pct) : ''}
            </span>
          </div>
        )}

        {/* Mini chart */}
        <div
          onClick={stop}
          style={{
            height: 64,
            margin: `${theme.space(1)}px 0`,
            borderRadius: theme.radius.sm,
            overflow: 'hidden',
          }}
        >
          <MiniChart symbol={symbol} range="5d" live height={64} />
        </div>

        {/* Live-quote failure: values below fall back to cost basis */}
        {priceMissing && (
          <div style={{ fontSize: 11, color: theme.colors.textDim }}>
            Live price unavailable — showing cost basis
          </div>
        )}

        {/* Holdings + market value + P/L */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: theme.space(1),
            fontSize: 12,
          }}
        >
          <div style={{ color: theme.colors.textDim }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Holdings
            </div>
            <div style={{ color: theme.colors.text, fontFamily: theme.mono, fontWeight: 600 }}>
              {fmtNumber(Number(shares) || 0, Number.isInteger(Number(shares)) ? 0 : 4)} @{' '}
              {fmtMoney(Number(avgCost) || 0, native)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                color: theme.colors.textDim,
              }}
            >
              Market Value
            </div>
            <div style={{ color: theme.colors.text, fontFamily: theme.mono, fontWeight: 700 }}>
              {priceLoading ? (
                <div className="skeleton" style={{ width: 70, height: 15, marginLeft: 'auto' }} />
              ) : priceMissing ? (
                <div
                  style={{ color: theme.colors.textDim }}
                  title="No live price — valued at your cost"
                >
                  <CountUp value={mvDisplay} format={(n) => fmtMoney(n, displayCurrency)} />
                </div>
              ) : (
                <CountUp value={mvDisplay} format={(n) => fmtMoney(n, displayCurrency)} />
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: theme.space(1),
            borderTop: `1px solid ${theme.colors.border}`,
          }}
        >
          <span
            style={{
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              color: theme.colors.textDim,
            }}
          >
            Total P/L
          </span>
          {priceLoading ? (
            <span className="skeleton" style={{ display: 'inline-block', width: 70, height: 13 }} />
          ) : (
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: priceMissing ? theme.colors.textDim : plColor,
                fontFamily: theme.mono,
              }}
            >
              {fmtMoney(plDisplay, displayCurrency)} ({fmtSignedPct(plPct)})
            </span>
          )}
        </div>

        {/* Realized P/L banked from recorded sells */}
        {realized && Math.abs(realized.realized) > 0.005 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: -theme.space(1) }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: theme.colors.textDim }}>
              Realized
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, fontFamily: theme.mono, color: colorForChange(realized.realized) }}>
              {fmtMoney(convert(realized.realized, realized.currency), displayCurrency)}
            </span>
          </div>
        )}

        {/* Record a buy/sell made at the broker (updates avg cost + realized P/L) */}
        <div style={{ display: 'flex', gap: theme.space(2) }} onClick={stop}>
          <button
            type="button"
            className="btn"
            onClick={() => setTrading('buy')}
            style={{ flex: 1, justifyContent: 'center', fontSize: 12, fontWeight: 700, color: theme.colors.up, borderColor: theme.colors.up + '55' }}
            title="Record a buy you made at your broker"
          >
            Buy
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setTrading('sell')}
            disabled={(Number(shares) || 0) <= 0}
            style={{ flex: 1, justifyContent: 'center', fontSize: 12, fontWeight: 700, color: theme.colors.down, borderColor: theme.colors.down + '55', opacity: (Number(shares) || 0) > 0 ? 1 : 0.45 }}
            title="Record a sell — realized P/L is calculated against your average cost"
          >
            Sell
          </button>
        </div>

        {/* Dividend line */}
        {divLine && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.space(1),
              fontSize: 11,
              color: theme.colors.gold,
              fontWeight: 600,
            }}
          >
            <span aria-hidden="true">💰</span>
            Div: {divLine.yieldPct != null ? `${Number(divLine.yieldPct).toFixed(2)}%` : '—'} ·{' '}
            {fmtMoney(divLine.annual, displayCurrency)}/yr
          </div>
        )}
      </SpotlightCard>

      {editing && (
        <HoldingEditor
          asset={holding}
          initial={{ shares, avgCost }}
          mode="edit"
          onSave={handleSave}
          onCancel={() => setEditing(false)}
        />
      )}

      {trading && (
        <TradeDialog
          holding={holding}
          side={trading}
          livePrice={price}
          onClose={() => setTrading(null)}
        />
      )}

      {alerting && (
        <AlertDialog
          symbol={symbol}
          livePrice={price}
          currency={native}
          onClose={() => setAlerting(false)}
        />
      )}
    </>
  );
}
