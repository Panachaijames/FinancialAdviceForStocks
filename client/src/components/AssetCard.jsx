import React, { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { fmtMoney, fmtNumber, fmtSignedPct, classForChange } from '../lib/format.js';
import { assetMeta } from '../lib/assetType.js';
import useQuotes from '../hooks/useQuotes.js';
import useFx from '../hooks/useFx.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import { useSettingsStore } from '../store/settingsStore.js';
import { getDividend } from '../api/client.js';
import { computeDividendIncome } from '../lib/dividends.js';
import MiniChart from './MiniChart.jsx';
import HoldingEditor from './HoldingEditor.jsx';

const DIV_TYPES = new Set(['us_stock', 'etf', 'th_stock']);

function colorForChange(v) {
  const c = classForChange(v);
  if (c === 'up') return theme.colors.up;
  if (c === 'down') return theme.colors.down;
  return theme.colors.textDim;
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

  const { quotes } = useQuotes([symbol]);
  const { convert } = useFx();
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const updateHolding = usePortfolioStore((s) => s.updateHolding);
  const removeHolding = usePortfolioStore((s) => s.removeHolding);

  const [editing, setEditing] = useState(false);
  const [dividend, setDividend] = useState(undefined); // undefined = not fetched, null = none

  const q = quotes[symbol];
  const price = q && Number.isFinite(Number(q.price)) ? Number(q.price) : null;
  const changePct = q && Number.isFinite(Number(q.changePct)) ? Number(q.changePct) : null;

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
        if (!cancelled) setDividend(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, type]);

  let divLine = null;
  if (dividend && DIV_TYPES.has(type)) {
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

  return (
    <>
      <div
        className="panel"
        role="button"
        tabIndex={0}
        onClick={() => onOpen && onOpen()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen && onOpen();
          }
        }}
        style={{
          padding: theme.space(3),
          display: 'flex',
          flexDirection: 'column',
          gap: theme.space(2),
          cursor: 'pointer',
          minWidth: 0,
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
              }}
              style={{ padding: 6, lineHeight: 0, color: theme.colors.down }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        {/* Price + day change */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: theme.space(2) }}>
          <span
            style={{
              fontSize: 20,
              fontWeight: 800,
              fontFamily: theme.mono,
              color: theme.colors.text,
            }}
          >
            {price != null ? fmtMoney(convert(price, native), displayCurrency) : '—'}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: priceColor }}>
            {changePct != null ? fmtSignedPct(changePct) : '—'}
          </span>
        </div>

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
              {fmtMoney(mvDisplay, displayCurrency)}
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
          <span style={{ fontSize: 13, fontWeight: 700, color: plColor, fontFamily: theme.mono }}>
            {fmtMoney(plDisplay, displayCurrency)} ({fmtSignedPct(plPct)})
          </span>
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
      </div>

      {editing && (
        <HoldingEditor
          asset={holding}
          initial={{ shares, avgCost }}
          mode="edit"
          onSave={handleSave}
          onCancel={() => setEditing(false)}
        />
      )}
    </>
  );
}
