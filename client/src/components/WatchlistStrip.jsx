// WatchlistStrip — symbols the user tracks WITHOUT holding a position.
//
// Watched symbols live in their own store collection (portfolioStore.watchlist),
// NOT as 0-share holdings, so they never touch portfolio value, allocation,
// dividends, or rebalance math. This strip shows a live quote per symbol with
// "Promote to holding" (opens the position editor) and "Remove" actions.
import React, { useMemo, useState } from 'react';
import { Eye, Plus, X } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import { snackbar } from '../store/snackbarStore.js';
import { scrollToCard } from '../lib/scrollToCard.js';
import useQuotes from '../hooks/useQuotes.js';
import { assetMeta } from '../lib/assetType.js';
import { fmtMoney, fmtSignedPct, classForChange } from '../lib/format.js';
import HoldingEditor from './HoldingEditor.jsx';

function colorForChange(v) {
  const c = classForChange(v);
  if (c === 'up') return theme.colors.up;
  if (c === 'down') return theme.colors.down;
  return theme.colors.textDim;
}

/**
 * Props: { onOpenChart } — (symbol) => void, opens the chart modal.
 */
export default function WatchlistStrip({ onOpenChart }) {
  const watchlist = usePortfolioStore((s) => s.watchlist);
  const removeFromWatchlist = usePortfolioStore((s) => s.removeFromWatchlist);
  const promoteToHolding = usePortfolioStore((s) => s.promoteToHolding);
  const [promoting, setPromoting] = useState(null); // watchlist entry being promoted

  const symbols = useMemo(() => (watchlist || []).map((w) => w.symbol), [watchlist]);
  const { quotes } = useQuotes(symbols);

  if (!watchlist || watchlist.length === 0) return null;

  return (
    <div
      className="panel"
      style={{ padding: theme.space(3), display: 'flex', flexDirection: 'column', gap: theme.space(2) }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(1) }}>
        <Eye size={15} style={{ color: theme.colors.accent }} />
        <span style={{ fontWeight: 700, fontSize: 13, color: theme.colors.text }}>
          Watchlist ({watchlist.length})
        </span>
        <span style={{ fontSize: 11, color: theme.colors.textFaint, marginLeft: theme.space(1) }}>
          tracked only — not counted in your totals
        </span>
      </div>

      <div className="scroll-area" style={{ display: 'flex', gap: theme.space(2), overflowX: 'auto', paddingBottom: 4 }}>
        {watchlist.map((w) => {
          const meta = assetMeta(w.type);
          const q = quotes[w.symbol];
          const price = q && Number(q.price) > 0 ? Number(q.price) : null;
          const changePct = q && Number.isFinite(Number(q.changePct)) ? Number(q.changePct) : null;
          return (
            <div
              key={w.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenChart && onOpenChart(w.symbol)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenChart && onOpenChart(w.symbol);
                }
              }}
              title={`${w.symbol} — ${w.name}`}
              style={{
                flex: '0 0 auto',
                minWidth: 150,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radius.md,
                background: theme.colors.bgElev,
                padding: theme.space(2),
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                <span style={{ fontSize: 13 }} aria-hidden="true">{meta.emoji}</span>
                <span style={{ fontWeight: 700, fontSize: 13, color: theme.colors.text }}>{w.symbol}</span>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={(e) => { e.stopPropagation(); removeFromWatchlist(w.id); }}
                  title="Remove from watchlist"
                  aria-label={`Remove ${w.symbol} from watchlist`}
                  style={{ padding: 2, lineHeight: 0, color: theme.colors.textFaint }}
                >
                  <X size={13} />
                </button>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: theme.colors.textDim,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 150,
                }}
              >
                {w.name}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: theme.space(1) }}>
                <span style={{ fontFamily: theme.mono, fontWeight: 700, fontSize: 13, color: theme.colors.text }}>
                  {price != null ? fmtMoney(price, w.currency) : '—'}
                </span>
                <span style={{ fontFamily: theme.mono, fontSize: 11.5, color: colorForChange(changePct) }}>
                  {changePct != null ? fmtSignedPct(changePct) : ''}
                </span>
              </div>
              <button
                type="button"
                className="btn-ghost"
                onClick={(e) => { e.stopPropagation(); setPromoting(w); }}
                title="Buy in — move this to your holdings with a position"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: theme.colors.accent,
                  border: `1px solid ${theme.colors.accentDim || theme.colors.border}`,
                  borderRadius: theme.radius.sm,
                  padding: '3px 6px',
                  marginTop: 2,
                }}
              >
                <Plus size={12} /> Promote
              </button>
            </div>
          );
        })}
      </div>

      {promoting && (
        <HoldingEditor
          asset={{ symbol: promoting.symbol, name: promoting.name, type: promoting.type, currency: promoting.currency }}
          mode="add"
          onSave={({ shares, avgCost }) => {
            const sym = promoting.symbol;
            promoteToHolding(promoting.id, { shares, avgCost });
            setPromoting(null);
            snackbar.push({ message: `Promoted ${sym}`, actionLabel: 'View', onAction: () => scrollToCard(sym) });
          }}
          onCancel={() => setPromoting(null)}
        />
      )}
    </div>
  );
}
