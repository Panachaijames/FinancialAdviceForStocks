import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { fmtMoney, fmtNumber } from '../lib/format.js';
import { assetMeta } from '../lib/assetType.js';
import { applyBuy, applySell, sharesToReachAvg } from '../lib/trades.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import { snackbar } from '../store/snackbarStore.js';
import { useT } from '../lib/i18n.js';

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
 *   editTx:    optional existing ledger entry to EDIT (prefills fields; saving
 *              replays the symbol instead of appending)
 *   onClose:   () => void
 */
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function TradeDialog({ holding, side, livePrice, editTx, onClose }) {
  const t = useT();
  const recordTrade = usePortfolioStore((s) => s.recordTrade);
  const editTransaction = usePortfolioStore((s) => s.editTransaction);
  const isEdit = !!editTx;
  const [qty, setQty] = useState(isEdit ? String(editTx.qty ?? '') : '');
  const [price, setPrice] = useState(
    isEdit ? String(editTx.price ?? '') : livePrice != null ? String(livePrice) : ''
  );
  const [fee, setFee] = useState(isEdit && editTx.fee ? String(editTx.fee) : '');
  const [date, setDate] = useState(
    isEdit && editTx.at ? String(editTx.at).slice(0, 10) : todayStr()
  );
  const [targetAvg, setTargetAvg] = useState(''); // what-if: solve qty to reach this avg
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
  // Backdated / edited trades are replayed chronologically (clamped to shares
  // held AT THAT TIME), so the "<= currently held" cap only applies to a plain
  // same-day sell.
  const backdated = isEdit || date !== todayStr();
  const qtyValid =
    qty !== '' && Number.isFinite(qtyNum) && qtyNum > 0 && (!isSell || backdated || qtyNum <= held);
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
        headline: t('trade.realizedPl', { value: fmtMoney(s.realized, native) }),
        color: s.realized >= 0 ? theme.colors.up : theme.colors.down,
        detail: t('trade.sellDetail', {
          proceeds: fmtMoney(qtyNum * priceNum - feeNum, native),
          shares: fmtNumber(s.shares, Number.isInteger(s.shares) ? 0 : 4),
          avg: fmtMoney(s.avgCost, native),
        }),
      };
    } else {
      const b = applyBuy(pos, { qty: qtyNum, price: priceNum, fee: feeNum });
      preview = {
        headline: t('trade.cost', { value: fmtMoney(qtyNum * priceNum + feeNum, native) }),
        color: theme.colors.text,
        detail: t('trade.buyDetail', {
          shares: fmtNumber(b.shares, Number.isInteger(b.shares) ? 0 : 4),
          avg: fmtMoney(b.avgCost, native),
        }),
      };
    }
  }

  // What-if: shares to buy at this price (incl. fee) to bring the average to a target.
  const showWhatIf = !isSell && !isEdit && held > 0;
  const whatIfRaw =
    showWhatIf && priceValid && targetAvg !== ''
      ? sharesToReachAvg(held, pos.avgCost, priceNum, Number(targetAvg), feeNum)
      : null;
  // Round to a tradable precision; a value that rounds to 0 is effectively
  // unreachable (don't offer a qty the submit would then reject).
  const whatIfQty = whatIfRaw != null && Math.round(whatIfRaw * 10000) / 10000 > 0 ? Math.round(whatIfRaw * 10000) / 10000 : null;
  // Direction hint when there's no reachable qty: buying pulls the average TOWARD
  // the price, so the user must buy on the correct side of their target.
  const whatIfHint =
    Number(targetAvg) === pos.avgCost
      ? 'atTarget'
      : Number(targetAvg) > pos.avgCost
        ? 'up' // target above current avg -> must buy above target
        : 'down'; // target below current avg -> must buy below target

  function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    // Same-day trades keep the real instant (preserves intraday order); a
    // backdated date is anchored at noon UTC so the calendar day is stable.
    const at = date === todayStr() ? new Date().toISOString() : `${date}T12:00:00.000Z`;
    const verb = isEdit ? t('trade.verbUpdated') : t('trade.verbRecorded');
    const saved = isEdit
      ? editTransaction(editTx.id, { qty: qtyNum, price: priceNum, fee: feeNum, at })
      : recordTrade(holding.id, { side: isSell ? 'sell' : 'buy', qty: qtyNum, price: priceNum, fee: feeNum, at });
    if (saved) {
      const shownQty = fmtNumber(saved.qty, Number.isInteger(saved.qty) ? 0 : 4);
      const sideWord = saved.side === 'sell' ? t('trade.actionSell') : t('trade.actionBuy');
      // Replay may clamp a sell to the shares actually held at that date — tell the user.
      const clamped = saved.side === 'sell' && saved.qty < qtyNum;
      snackbar.push({
        message: clamped
          ? t('trade.snackClamped', { verb, qty: shownQty, symbol: holding.symbol })
          : t('trade.snackSaved', { verb, side: sideWord, qty: shownQty, symbol: holding.symbol }),
        tone: clamped ? 'error' : 'default',
      });
    } else if (isSell) {
      snackbar.push({ message: t('trade.snackNothingHeld', { symbol: holding.symbol }), tone: 'error' });
    }
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
        aria-label={t('trade.dialogAriaLabel', { action: isSell ? t('trade.sell') : t('trade.buy'), symbol: holding.symbol })}
        style={{ maxWidth: 420, width: '100%' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.space(2), marginBottom: theme.space(3) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(2) }}>
            <span style={{ fontSize: 24 }} aria-hidden="true">{meta.emoji}</span>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: theme.colors.text }}>
                {isEdit ? t('trade.editPrefix') : ''}
                <span style={{ color: accent }}>{isSell ? t('trade.sell') : t('trade.buy')}</span> {holding.symbol}
              </span>
              <span style={{ fontSize: 12, color: theme.colors.textDim }}>
                {t('trade.holdingLine', { shares: fmtNumber(held, Number.isInteger(held) ? 0 : 4), avg: fmtMoney(pos.avgCost, native) })}
              </span>
            </div>
          </div>
          <button type="button" className="btn-ghost" onClick={() => onClose && onClose()} aria-label={t('trade.close')} style={{ padding: theme.space(1), lineHeight: 0 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ fontSize: 11.5, color: theme.colors.textFaint, marginBottom: theme.space(3), lineHeight: 1.5 }}>
          {t('trade.brokerNote')}
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', marginBottom: theme.space(3) }}>
            {label(isSell ? t('trade.quantityMax', { max: fmtNumber(held, Number.isInteger(held) ? 0 : 4) }) : t('trade.quantity'))}
            <input
              ref={firstFieldRef}
              className="input"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder={t('trade.qtyPlaceholder')}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              style={{ borderColor: touched && !qtyValid ? theme.colors.down : theme.colors.border }}
            />
            {touched && !qtyValid && (
              <span style={errStyle}>
                {isSell && qtyNum > held ? t('trade.errOnlyHold', { held: fmtNumber(held, 4) }) : t('trade.errPositiveQty')}
              </span>
            )}
          </label>

          <label style={{ display: 'block', marginBottom: theme.space(3) }}>
            {label(livePrice != null ? t('trade.pricePerUnitLive', { currency: native }) : t('trade.pricePerUnit', { currency: native }))}
            <input
              className="input"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder={t('trade.pricePlaceholder', { currency: native })}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              style={{ borderColor: touched && !priceValid ? theme.colors.down : theme.colors.border }}
            />
            {touched && !priceValid && <span style={errStyle}>{t('trade.errPrice')}</span>}
          </label>

          <label style={{ display: 'block', marginBottom: theme.space(3) }}>
            {label(t('trade.fee', { currency: native }))}
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

          <label style={{ display: 'block', marginBottom: theme.space(3) }}>
            {label(t('trade.tradeDate'))}
            <input
              className="input"
              type="date"
              value={date}
              max={todayStr()}
              onChange={(e) => setDate(e.target.value)}
            />
            {backdated && (
              <span style={{ fontSize: 11, color: theme.colors.textFaint, marginTop: 4, display: 'block' }}>
                {t('trade.backdatedNote')}
              </span>
            )}
          </label>

          {preview && !backdated && (
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
          {valid && backdated && (
            <div style={{ fontSize: 11.5, color: theme.colors.textDim, marginBottom: theme.space(3) }}>
              {t('trade.recomputeNote')}
            </div>
          )}

          {showWhatIf && (
            <div style={{ padding: theme.space(2), borderRadius: theme.radius.sm, background: theme.colors.bgElev, marginBottom: theme.space(3) }}>
              {label(t('trade.whatIfTitle'))}
              <input
                className="input"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                placeholder={t('trade.targetAvgPlaceholder', { currency: native })}
                value={targetAvg}
                onChange={(e) => setTargetAvg(e.target.value)}
              />
              {targetAvg !== '' && priceValid && (
                whatIfQty != null ? (
                  <div style={{ fontSize: 11.5, color: theme.colors.textDim, marginTop: theme.space(1), display: 'flex', alignItems: 'center', gap: theme.space(2), flexWrap: 'wrap' }}>
                    <span>
                      {t('trade.whatIfResult', {
                        qty: fmtNumber(whatIfQty, whatIfQty < 10 ? 4 : 2),
                        cost: fmtMoney(whatIfQty * priceNum + feeNum, native),
                      })}
                    </span>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setQty(String(whatIfQty))}
                      style={{ fontSize: 11, fontWeight: 700, color: theme.colors.accent, padding: '2px 6px' }}
                    >
                      {t('trade.whatIfUse')}
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: 11.5, color: theme.colors.textFaint, marginTop: theme.space(1) }}>
                    {whatIfHint === 'atTarget'
                      ? t('trade.whatIfAtTarget')
                      : whatIfHint === 'up'
                        ? t('trade.whatIfUnreachableUp')
                        : t('trade.whatIfUnreachable')}
                  </div>
                )
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: theme.space(2), justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => onClose && onClose()}>
              {t('trade.cancel')}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!valid}
              style={{ background: accent, borderColor: accent, opacity: valid ? 1 : 0.55, cursor: valid ? 'pointer' : 'not-allowed' }}
            >
              {isEdit ? t('trade.saveChanges') : isSell ? t('trade.recordSell') : t('trade.recordBuy')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
