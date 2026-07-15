import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { assetMeta } from '../lib/assetType.js';
import { useT } from '../lib/i18n.js';

/** Asset-appropriate wording for the quantity + per-unit cost fields. */
function unitNoun(type) {
  switch (type) {
    case 'gold':
      return { qtyKey: 'editor.unit.ounces.qty', perKey: 'editor.unit.ounces.per', eg: '1.5' };
    case 'crypto':
      return { qtyKey: 'editor.unit.units.qty', perKey: 'editor.unit.crypto.per', eg: '0.25' };
    case 'us_stock':
    case 'etf':
    case 'th_stock':
      return { qtyKey: 'editor.unit.shares.qty', perKey: 'editor.unit.shares.per', eg: '10' };
    default:
      return { qtyKey: 'editor.unit.units.qty', perKey: 'editor.unit.units.per', eg: '10' };
  }
}

/**
 * Modal form to capture / edit a holding's shares and average cost (native currency).
 * Used for both adding a new holding and editing an existing one.
 *
 * Props:
 *   asset:   { symbol, name, type, currency, ... } (SearchResult-like or holding-like)
 *   initial: { shares, avgCost } optional defaults (edit mode)
 *   mode:    'add' | 'edit'
 *   onSave:  ({ shares, avgCost }) => void
 *   onCancel:() => void
 */
export default function HoldingEditor({ asset, initial, mode = 'add', onSave, onCancel }) {
  const t = useT();
  const [shares, setShares] = useState(
    initial && initial.shares != null ? String(initial.shares) : ''
  );
  const [avgCost, setAvgCost] = useState(
    initial && initial.avgCost != null ? String(initial.avgCost) : ''
  );
  const [touched, setTouched] = useState(false);
  const firstFieldRef = useRef(null);

  useEffect(() => {
    if (firstFieldRef.current) firstFieldRef.current.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel && onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const sharesNum = Number(shares);
  const avgCostNum = Number(avgCost);
  const sharesValid = shares !== '' && Number.isFinite(sharesNum) && sharesNum > 0;
  const avgCostValid = avgCost !== '' && Number.isFinite(avgCostNum) && avgCostNum > 0;
  const valid = sharesValid && avgCostValid;

  const meta = assetMeta(asset?.type);
  const u = unitNoun(asset?.type);
  const currency = asset?.currency || (asset?.type === 'th_stock' ? 'THB' : 'USD');

  function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    onSave && onSave({ shares: sharesNum, avgCost: avgCostNum });
  }

  function fieldStyle(isValid) {
    return {
      borderColor: touched && !isValid ? theme.colors.down : theme.colors.border,
    };
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel && onCancel();
      }}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'edit' ? t('editor.aria.editHolding') : t('editor.aria.addHolding')}
        style={{ maxWidth: 420, width: '100%' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: theme.space(2),
            marginBottom: theme.space(3),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(2) }}>
            <span style={{ fontSize: 24 }} aria-hidden="true">
              {meta.emoji}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: theme.colors.text }}>
                {asset?.symbol}
              </span>
              <span style={{ fontSize: 12, color: theme.colors.textDim }}>
                {asset?.name || meta.label}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => onCancel && onCancel()}
            aria-label={t('editor.close')}
            style={{ padding: theme.space(1), lineHeight: 0 }}
          >
            <X size={18} />
          </button>
        </div>

        <span
          className="badge"
          style={{
            background: meta.color + '22',
            color: meta.color,
            marginBottom: theme.space(3),
            display: 'inline-block',
          }}
        >
          {meta.label}
        </span>

        <form onSubmit={handleSubmit} style={{ marginTop: theme.space(3) }}>
          <label style={{ display: 'block', marginBottom: theme.space(3) }}>
            <span
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: theme.colors.textDim,
                marginBottom: theme.space(1),
              }}
            >
              {t(u.qtyKey)}
            </span>
            <input
              ref={firstFieldRef}
              className="input"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder={t('editor.placeholder.qty', { eg: u.eg })}
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              style={fieldStyle(sharesValid)}
            />
            {touched && !sharesValid && (
              <span style={{ fontSize: 11, color: theme.colors.down, marginTop: 4, display: 'block' }}>
                {t('editor.error.positiveQty', { unit: t(u.qtyKey).toLowerCase() })}
              </span>
            )}
          </label>

          <label style={{ display: 'block', marginBottom: theme.space(4) }}>
            <span
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                fontSize: 12,
                fontWeight: 600,
                color: theme.colors.textDim,
                marginBottom: theme.space(1),
              }}
            >
              <span>{t('editor.avgCostPer', { unit: t(u.perKey) })}</span>
              <span
                style={{
                  fontFamily: theme.mono,
                  fontSize: 11,
                  color: theme.colors.textFaint,
                }}
              >
                {t('editor.inCurrency', { currency })}
              </span>
            </span>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder={t('editor.placeholder.cost', { currency })}
              value={avgCost}
              onChange={(e) => setAvgCost(e.target.value)}
              style={fieldStyle(avgCostValid)}
            />
            {touched && !avgCostValid && (
              <span style={{ fontSize: 11, color: theme.colors.down, marginTop: 4, display: 'block' }}>
                {t('editor.error.positivePer', { unit: t(u.perKey) })}
              </span>
            )}
          </label>

          <div style={{ display: 'flex', gap: theme.space(2), justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => onCancel && onCancel()}>
              {t('editor.cancel')}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!valid}
              style={{ opacity: valid ? 1 : 0.55, cursor: valid ? 'pointer' : 'not-allowed' }}
            >
              {mode === 'edit' ? t('editor.saveChanges') : t('editor.addToPortfolio')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
