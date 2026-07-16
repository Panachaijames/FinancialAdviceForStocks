import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { assetMeta } from '../lib/assetType.js';
import { useT } from '../lib/i18n.js';
import useFx from '../hooks/useFx.js';
import { bahtToOz, ozToBaht, bahtPriceThb, thbPerBahtToUsdPerOz } from '../lib/gold.js';

const round = (n, d = 2) => {
  const f = 10 ** d;
  return Math.round((Number(n) || 0) * f) / f;
};

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
  const { fx, rate } = useFx(); // live USD->THB, for baht-weight cost conversion
  const fxReady = !!(fx && Number(fx.rate) > 0); // real rate loaded (not the fallback 36)
  const isGold = asset?.type === 'gold';
  const [goldUnit, setGoldUnit] = useState(isGold ? (initial?.goldUnit || 'oz') : 'oz');
  const bahtMode = isGold && goldUnit === 'baht';

  // A baht-gold holding is stored canonically (troy oz + USD/oz); when editing
  // one, prefill the fields back in baht-weight + THB-per-baht.
  const [shares, setShares] = useState(() => {
    if (initial?.shares == null) return '';
    return String(
      isGold && (initial.goldUnit || 'oz') === 'baht' ? round(ozToBaht(initial.shares), 3) : initial.shares
    );
  });
  const [avgCost, setAvgCost] = useState(() => {
    if (initial?.avgCost == null) return '';
    return String(
      isGold && (initial.goldUnit || 'oz') === 'baht' ? round(bahtPriceThb(initial.avgCost, rate), 0) : initial.avgCost
    );
  });
  const [touched, setTouched] = useState(false);
  const [account, setAccount] = useState(initial?.account || ''); // optional broker/account tag
  const firstFieldRef = useRef(null);
  const dirtyRef = useRef(false); // set once the user edits/switches, to stop auto-resync

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

  // Keep the baht-mode fields synced to the LIVE rate until the user edits them,
  // so prefill (and the convert-back-to-USD/oz on save) use the SAME rate. Without
  // this, the field prefills at the first-render fallback (36) while save converts
  // at the live rate, silently shifting the cost basis on a no-op Save.
  useEffect(() => {
    if (!bahtMode || dirtyRef.current || !fxReady) return;
    if (initial?.shares == null || initial?.avgCost == null) return;
    if ((initial.goldUnit || 'oz') !== 'baht') return;
    setShares(String(round(ozToBaht(initial.shares), 3)));
    setAvgCost(String(round(bahtPriceThb(initial.avgCost, rate), 0)));
  }, [rate, fxReady, bahtMode]);

  const sharesNum = Number(shares);
  const avgCostNum = Number(avgCost);
  const sharesValid = shares !== '' && Number.isFinite(sharesNum) && sharesNum > 0;
  const avgCostValid = avgCost !== '' && Number.isFinite(avgCostNum) && avgCostNum > 0;
  // Never persist a THB baht-cost converted at the display-only fallback rate.
  const valid = sharesValid && avgCostValid && (!bahtMode || fxReady);

  const meta = assetMeta(asset?.type);
  const u = unitNoun(asset?.type);
  const currency = bahtMode ? 'THB' : asset?.currency || (asset?.type === 'th_stock' ? 'THB' : 'USD');
  const qtyLabel = bahtMode ? t('editor.gold.weightBaht') : t(u.qtyKey);
  const perLabel = bahtMode ? t('editor.gold.perBaht') : t(u.perKey);

  // Switching gold units reinterprets the values currently in the fields so the
  // toggle feels live (e.g. 1 oz -> 2.114 บาท) rather than silently changing meaning.
  function switchUnit(next) {
    if (!isGold || next === goldUnit) return;
    dirtyRef.current = true; // user chose a unit — stop auto-resyncing from `initial`
    const s = Number(shares);
    const c = Number(avgCost);
    if (next === 'baht') {
      if (s > 0) setShares(String(round(ozToBaht(s), 3)));
      if (c > 0) setAvgCost(String(round(bahtPriceThb(c, rate), 0)));
    } else {
      if (s > 0) setShares(String(round(bahtToOz(s), 4)));
      if (c > 0) setAvgCost(String(round(thbPerBahtToUsdPerOz(c, rate), 2)));
    }
    setGoldUnit(next);
  }

  function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    const acct = account.trim(); // '' clears any prior account on edit
    if (isGold) {
      // Store canonically in troy oz + USD/oz so the valuation pipeline is unit-agnostic.
      const payload = bahtMode
        ? { shares: bahtToOz(sharesNum), avgCost: thbPerBahtToUsdPerOz(avgCostNum, rate), goldUnit: 'baht' }
        : { shares: sharesNum, avgCost: avgCostNum, goldUnit: 'oz' };
      onSave && onSave({ ...payload, account: acct });
      return;
    }
    onSave && onSave({ shares: sharesNum, avgCost: avgCostNum, account: acct });
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
          {isGold && (
            <div style={{ marginBottom: theme.space(3) }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: theme.colors.textDim, marginBottom: theme.space(1) }}>
                {t('editor.gold.unit')}
              </span>
              <div className="segmented" role="group">
                <button type="button" className={`segmented-item${goldUnit === 'oz' ? ' active' : ''}`} onClick={() => switchUnit('oz')} style={goldUnit === 'oz' ? { color: theme.colors.text } : undefined}>
                  {t('editor.gold.oz')}
                </button>
                <button type="button" className={`segmented-item${goldUnit === 'baht' ? ' active' : ''}`} onClick={() => switchUnit('baht')} style={goldUnit === 'baht' ? { color: theme.colors.text } : undefined}>
                  {t('editor.gold.baht')}
                </button>
              </div>
            </div>
          )}
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
              {qtyLabel}
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
              onChange={(e) => {
                dirtyRef.current = true;
                setShares(e.target.value);
              }}
              style={fieldStyle(sharesValid)}
            />
            {touched && !sharesValid && (
              <span style={{ fontSize: 11, color: theme.colors.down, marginTop: 4, display: 'block' }}>
                {t('editor.error.positiveQty', { unit: qtyLabel.toLowerCase() })}
              </span>
            )}
            {bahtMode && sharesValid && (
              <span style={{ fontSize: 11, color: theme.colors.textFaint, marginTop: 4, display: 'block' }}>
                {t('editor.gold.approxOz', { oz: bahtToOz(sharesNum).toFixed(4) })}
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
              <span>{t('editor.avgCostPer', { unit: perLabel })}</span>
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
              onChange={(e) => {
                dirtyRef.current = true;
                setAvgCost(e.target.value);
              }}
              style={fieldStyle(avgCostValid)}
            />
            {touched && !avgCostValid && (
              <span style={{ fontSize: 11, color: theme.colors.down, marginTop: 4, display: 'block' }}>
                {t('editor.error.positivePer', { unit: perLabel })}
              </span>
            )}
          </label>

          <label style={{ display: 'block', marginBottom: theme.space(3) }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: theme.colors.textDim, marginBottom: theme.space(1) }}>
              {t('editor.account')}
            </span>
            <input
              className="input"
              type="text"
              placeholder={t('editor.accountPlaceholder')}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              maxLength={40}
            />
          </label>

          {bahtMode && !fxReady && (
            <div style={{ fontSize: 11, color: theme.colors.warn, marginBottom: theme.space(2) }}>
              {t('editor.gold.fxWait')}
            </div>
          )}

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
