// Bottom-center snackbar stack — post-action feedback ("Added AAPL — View",
// "Recorded buy 10 AAPL", "Removed AAPL — Undo"). Reads the transient
// snackbarStore. role="status" aria-live="polite" so screen readers announce
// each message. Replaces the old single-purpose UndoRemoveBar.
import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { useSnackbarStore } from '../store/snackbarStore.js';

function SnackItem({ snack }) {
  const dismiss = useSnackbarStore((s) => s.dismiss);

  // Auto-dismiss after `duration` ms (0 = persist until dismissed/actioned).
  // `snack.nonce` is in the deps so a replace (same id, new push) restarts the
  // timer instead of inheriting the previous snack's remaining time.
  useEffect(() => {
    if (!snack.duration) return undefined;
    const t = setTimeout(() => dismiss(snack.id), snack.duration);
    return () => clearTimeout(t);
  }, [snack.id, snack.nonce, snack.duration, dismiss]);

  const toneColor =
    snack.tone === 'error'
      ? theme.colors.down
      : snack.tone === 'success'
      ? theme.colors.up
      : theme.colors.accent;

  return (
    <div
      role="status"
      aria-live="polite"
      className="panel"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.space(2),
        padding: `${theme.space(2)}px ${theme.space(3)}px`,
        borderLeft: `3px solid ${toneColor}`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        maxWidth: 'calc(100vw - 24px)',
        pointerEvents: 'auto',
      }}
    >
      <span style={{ fontSize: 13, color: theme.colors.text }}>{snack.message}</span>
      {snack.actionLabel && (
        <button
          type="button"
          className="btn"
          onClick={() => {
            try {
              snack.onAction && snack.onAction();
            } finally {
              dismiss(snack.id);
            }
          }}
          style={{ fontSize: 12, fontWeight: 700 }}
        >
          {snack.actionLabel}
        </button>
      )}
      <button
        type="button"
        className="btn-ghost"
        aria-label="Dismiss"
        onClick={() => dismiss(snack.id)}
        style={{ padding: 6, lineHeight: 0 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export default function SnackbarHost() {
  const snacks = useSnackbarStore((s) => s.snacks);
  if (!snacks.length) return null;
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        zIndex: 900, // one step below the modal overlay (index.css .modal* = 1000)
        display: 'flex',
        flexDirection: 'column-reverse', // newest nearest the bottom edge
        gap: theme.space(2),
        pointerEvents: 'none', // let clicks through the gaps; items re-enable it
      }}
    >
      {snacks.map((s) => (
        <SnackItem key={s.id} snack={s} />
      ))}
    </div>
  );
}
