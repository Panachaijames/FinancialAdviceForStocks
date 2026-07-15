import React, { useEffect, useRef, useState } from 'react';
import { X, Bell } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { useT } from '../lib/i18n.js';
import { useAlertsStore } from '../store/alertsStore.js';

/**
 * Create a price alert for one symbol. Alerts are watched client-side against
 * the live quotes the app already polls, fire once (in-app banner + browser
 * notification when permitted), and can be re-armed from the alerts panel.
 *
 * Props: { symbol, livePrice (native), currency, onClose }
 */
export default function AlertDialog({ symbol, livePrice, currency, onClose }) {
  const t = useT();
  const addAlert = useAlertsStore((s) => s.addAlert);
  const KINDS = [
    { id: 'above', label: t('alertdlg.kindAboveLabel'), hint: t('alertdlg.kindAboveHint') },
    { id: 'below', label: t('alertdlg.kindBelowLabel'), hint: t('alertdlg.kindBelowHint') },
    { id: 'move', label: t('alertdlg.kindMoveLabel'), hint: t('alertdlg.kindMoveHint') },
  ];
  const [kind, setKind] = useState('above');
  const [value, setValue] = useState(livePrice != null ? String(livePrice) : '');
  const firstRef = useRef(null);

  useEffect(() => {
    if (firstRef.current) firstRef.current.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Switching to "move" wants a percent, not a price.
  function pickKind(next) {
    setKind(next);
    if (next === 'move') setValue('5');
    else if (livePrice != null) setValue(String(livePrice));
  }

  const v = Number(value);
  const valid = Number.isFinite(v) && v > 0;

  function handleSubmit(e) {
    e.preventDefault();
    if (!valid) return;
    addAlert({ symbol, kind, value: v });
    // Ask for notification permission on first use — best-effort, non-blocking.
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    } catch {
      /* not supported (older webview) — in-app banner still works */
    }
    onClose && onClose();
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose && onClose();
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={t('alertdlg.dialogAria', { symbol })} style={{ maxWidth: 400, width: '100%' }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.space(3) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(1), fontWeight: 700, fontSize: 15, color: theme.colors.text }}>
            <Bell size={16} style={{ color: theme.colors.accent }} />
            {t('alertdlg.headline', { symbol })}
          </div>
          <button type="button" className="btn-ghost" onClick={() => onClose && onClose()} aria-label={t('alertdlg.closeAria')} style={{ padding: theme.space(1), lineHeight: 0 }}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(1) }}>
            {KINDS.map((k) => (
              <label key={k.id} style={{ display: 'flex', alignItems: 'center', gap: theme.space(2), cursor: 'pointer', fontSize: 13, color: kind === k.id ? theme.colors.text : theme.colors.textDim }}>
                <input type="radio" name="kind" checked={kind === k.id} onChange={() => pickKind(k.id)} style={{ accentColor: theme.colors.accent }} />
                <span style={{ fontWeight: 600 }}>{k.label}</span>
                <span style={{ fontSize: 11, color: theme.colors.textFaint }}>{k.hint}</span>
              </label>
            ))}
          </div>

          <label>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: theme.colors.textDim, marginBottom: theme.space(1) }}>
              {kind === 'move'
                ? t('alertdlg.percentMoveLabel')
                : livePrice != null
                  ? t('alertdlg.priceLabelPrefilled', { currency: currency || '' })
                  : t('alertdlg.priceLabel', { currency: currency || '' })}
            </span>
            <input
              ref={firstRef}
              className="input"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>

          <div style={{ display: 'flex', gap: theme.space(2), justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => onClose && onClose()}>
              {t('alertdlg.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={!valid} style={{ opacity: valid ? 1 : 0.55 }}>
              {t('alertdlg.setAlert')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
