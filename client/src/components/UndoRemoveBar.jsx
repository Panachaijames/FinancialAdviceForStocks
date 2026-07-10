// Bottom-center "Removed X — Undo" bar. Appears after a holding is deleted
// (portfolioStore.removeHolding stashes a snapshot in `lastRemoved`) and
// auto-dismisses after 8 seconds. Single-level undo by design: consecutive
// deletes replace the snapshot and reset the clock.
import React, { useEffect } from 'react';
import { Undo2, X } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { usePortfolioStore } from '../store/portfolioStore.js';

export default function UndoRemoveBar() {
  const lastRemoved = usePortfolioStore((s) => s.lastRemoved);
  const restoreRemoved = usePortfolioStore((s) => s.restoreRemoved);
  const clearRemoved = usePortfolioStore((s) => s.clearRemoved);

  // Auto-dismiss 8s after each removal (keyed on `at` so consecutive deletes reset the clock).
  useEffect(() => {
    if (!lastRemoved) return undefined;
    const t = setTimeout(() => clearRemoved(), 8000);
    return () => clearTimeout(t);
  }, [lastRemoved, clearRemoved]);

  if (!lastRemoved || !lastRemoved.holding) return null;
  const sym = lastRemoved.holding.symbol;
  return (
    <div
      role="status"
      aria-live="polite"
      className="panel"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        zIndex: 900, // one step below the modal overlay (index.css .modal* = 1000) so dialogs stay on top
        display: 'flex',
        alignItems: 'center',
        gap: theme.space(2),
        padding: `${theme.space(2)}px ${theme.space(3)}px`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        maxWidth: 'calc(100vw - 24px)',
      }}
    >
      <span style={{ fontSize: 13, color: theme.colors.text }}>
        Removed <strong style={{ fontFamily: theme.mono }}>{sym}</strong>
      </span>
      <button
        type="button"
        className="btn"
        onClick={restoreRemoved}
        style={{ fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <Undo2 size={14} aria-hidden="true" /> Undo
      </button>
      <button
        type="button"
        className="btn-ghost"
        aria-label="Dismiss"
        onClick={clearRemoved}
        style={{ padding: 6, lineHeight: 0 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
