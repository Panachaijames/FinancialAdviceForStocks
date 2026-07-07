import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { fmtMoney, fmtNumber } from '../lib/format.js';
import { assetMeta } from '../lib/assetType.js';
import { applyBuy, applySell } from '../lib/trades.js';
import { usePortfolioStore } from '../store/portfolioStore.js';

/**
 * Record a buy or sell the user made at their broker (the app never places
 * orders). Price prefills with the live quote; a preview line shows exactly
 * what will happen to the position — including realized P/L for sells —
 * before anything is saved.
 *
 * Props:
 *   holding:   the holding object ({ id, symbol, name, type, currency, shares, avgCost })
 *   side:      'buy' | 'sell'
 *   livePrice: current native-currency price (prefill), or null
 *   onClose:   () => void
 */
export default function TradeDialog({ holding, side, livePrice, onClose }) {
  const recordTrade = usePortfolioStore((s) => s.recordTrade);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState(livePrice != null ? String(livePrice) : '');
  const [fee, setFee] = useState('');
  const [touched, setTouched] = useState(false);
  const firstFieldRef = useRef(null);

  useEffect(() => {
    if (firstFieldRef.current) firstFieldRef.current.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!holding) return null;
  const isSell = side === 'sell';
  const meta = assetMeta(holding.type);
  const native = holding.currency || (holding.type === 'th_stock' ? 'THB' : 'USD');
  const held = Number(holding.shares) || 0;

  const qtyNum = Number(qty);
  const priceNum = Number(price);
  const feeNum = Number(fee) || 0;
  const qtyValid = qty !== '' && Number.isFinite(qtyNum) && qtyNum > 0 && (!isSell || qtyNum <= held);
  const priceValid = price !== '' && Number.isFinite(priceNum) && priceNum > 0;
  const feeValid = fee === '' || (Number.isFinite(feeNum) && feeNum >= 0);
  const valid = qtyValid && priceValid && feeValid;

  // Live preview of the position after the trade.
  const pos = { shares: held, avgCost: Number(holding.avgCost) || 0 };
  let preview = null;
  if (valid) {
    if (isSell) {
      const s = applySell(pos, { qty: qtyNum, price: priceNum, fee: feeNum });
      preview = {
        headline: `Realized P/L: ${fmtMoney(s.realized, native)}`,
        color: s.realized >= 0 ? theme.colors.up : theme.colors.down,
        detail: `Proceeds ${fmtMoney(qtyNum * priceNum - feeNum, native)} · left ${fmtNumber(s.shares, Number.isInteger(s.shares) ? 0 : 4)} @ ${fmtMoney(s.avgCost, native)}`,
      };
    } else {
      const b = applyBuy(pos, { qty: qtyNum, price: priceNum, fee: feeNum });
      preview = {
        headline: `Cost: ${fmtMoney(qtyNum * priceNum + feeNum, native)}`,
        color: theme.colors.text,
        detail: `New position ${fmtNumber(b.shares, Number.isInteger(b.shares) ? 0 : 4)} @ ${fmtMoney(b.avgCost, native)} avg`,
      };
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    recordTrade(holding.id, { side: isSell ? 'sell' : 'buy', qty: qtyNum, price: priceNum, fee: feeNum });
    onClose && onClose();
  }

  const accent = isSell ? theme.colors.down : theme.colors.up;
  const label = (text) => (
    <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: theme.colors.textDim, marginBottom: theme.space(1) }}>
      {text}
    </span>
  );
  const errStyle = { fontSize: 11, color: theme.colors.down, marginTop: 4, display: 'block' };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose && onClose();
      }}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={`${isSell ? 'Sell' : 'Buy'} ${holding.symbol}`}
        style={{ maxWidth: 420, width: '100%' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.space(2), marginBottom: theme.space(3) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(2) }}>
            <span style={{ fontSize: 24 }} aria-hidden="true">{meta.emoji}</span>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: theme.colors.text }}>
                <span style={{ color: accent }}>{isSell ? 'Sell' : 'Buy'}</span> {holding.symbol}
              </span>
              <span style={{ fontSize: 12, color: theme.colors.textDim }}>
                Holding {fmtNumber(held, Number.isInteger(held) ? 0 : 4)} @ {fmtMoney(pos.avgCost, native)} avg
              </span>
            </div>
          </div>
          <button type="button" className="btn-ghost" onClick={() => onClose && onClose()} aria-label="Close" style={{ padding: theme.space(1), lineHeight: 0 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ fontSize: 11.5, color: theme.colors.textFaint, marginBottom: theme.space(3), lineHeight: 1.5 }}>
          Records what you did at your broker so P/L is tracked — no real order is placed.
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', marginBottom: theme.space(3) }}>
            {label(`Quantity${isSell ? ` (max ${fmtNumber(held, Number.isInteger(held) ? 0 : 4)})` : ''}`)}
            <input
              ref={firstFieldRef}
              className="input"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder="e.g. 10"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              style={{ borderColor: touched && !qtyValid ? theme.colors.down : theme.colors.border }}
            />
            {touched && !qtyValid && (
              <span style={errStyle}>
                {isSell && qtyNum > held ? `You only hold ${fmtNumber(held, 4)}.` : 'Enter a positive quantity.'}
              </span>
            )}
          </label>

          <label style={{ display: 'block', marginBottom: theme.space(3) }}>
            {label(`Price per unit (${native})${livePrice != null ? ' — prefilled with live price' : ''}`)}
            <input
              className="input"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder={`e.g. 150.25 ${native}`}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              style={{ borderColor: touched && !priceValid ? theme.colors.down : theme.colors.border }}
            />
            {touched && !priceValid && <span style={errStyle}>Enter the executed price.</span>}
          </label>

          <label style={{ display: 'block', marginBottom: theme.space(3) }}>
            {label(`Fee / commission (${native}, optional)`)}
            <input
              className="input"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder="0"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </label>

          {preview && (
            <div
              style={{
                padding: theme.space(2),
                borderRadius: theme.radius.sm,
                background: theme.colors.bgElev,
                borderLeft: `3px solid ${preview.color === theme.colors.text ? accent : preview.color}`,
                marginBottom: theme.space(3),
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: theme.mono, color: preview.color }}>
                {preview.headline}
              </div>
              <div style={{ fontSize: 11.5, color: theme.colors.textDim, marginTop: 2 }}>{preview.detail}</div>
            </div>
          )}

          <div style={{ display: 'flex', gap: theme.space(2), justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => onClose && onClose()}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!valid}
              style={{ background: accent, borderColor: accent, opacity: valid ? 1 : 0.55, cursor: valid ? 'pointer' : 'not-allowed' }}
            >
              Record {isSell ? 'sell' : 'buy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
