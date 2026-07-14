// HoldingsSection — the asset-cards grid plus a 'Holdings (N)' toolbar with
// persisted sort controls (Value / Day % / P&L / Symbol / Added).
//
// The default sort ('added' ascending) renders `holdings` untouched, so a fresh
// load reproduces the historical insertion order exactly. Metric derivation
// mirrors AssetCard.jsx (price/changePct guards, convert() to the display
// currency) so the sort order always matches the numbers the cards show.
// Holdings without a quote yet sort to the bottom in every mode. Stable keys
// (h.id) mean a re-sort only MOVES existing card DOM nodes — no remounts, so
// mini-charts don't re-fetch when the order changes.
import React, { useMemo } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import { useSettingsStore } from '../store/settingsStore.js';
import useQuotes from '../hooks/useQuotes.js';
import useFx from '../hooks/useFx.js';
import AssetCard from './AssetCard.jsx';
import { RevealGroup } from './fx/Reveal.jsx';

const OPTIONS = [
  { key: 'added', label: 'Added', title: 'Sort by date added (click again to flip direction)' },
  { key: 'value', label: 'Value', title: 'Sort by market value (click again to flip direction)' },
  { key: 'day', label: 'Day %', title: "Sort by today's change (click again to flip direction)" },
  { key: 'pl', label: 'P&L', title: 'Sort by unrealized P&L % (click again to flip direction)' },
  { key: 'symbol', label: 'Symbol', title: 'Sort by symbol (click again to flip direction)' },
];

// First click on a metric starts with the direction people usually want
// (biggest value / biggest mover / best P&L first; A→Z for symbol).
const DEFAULT_DIR = { value: 'desc', day: 'desc', pl: 'desc', symbol: 'asc', added: 'asc' };

/**
 * Props: { onOpenChart } — (symbol) => void, opens the chart modal.
 */
export default function HoldingsSection({ onOpenChart }) {
  const holdings = usePortfolioStore((s) => s.holdings);
  const holdingsSort = useSettingsStore((s) => s.holdingsSort) || { key: 'added', dir: 'asc' };
  const setHoldingsSort = useSettingsStore((s) => s.setHoldingsSort);

  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const { quotes } = useQuotes(symbols);
  const { convert } = useFx();

  const { key, dir } = holdingsSort;

  const sorted = useMemo(() => {
    // Default = untouched insertion order (exactly what the app always showed).
    if (key === 'added' && dir === 'asc') return holdings;

    // Metric per holding — mirrors AssetCard's derivation so the ranking
    // matches the displayed numbers. null = "no data", always sorts last.
    const metricFor = (h) => {
      if (key === 'symbol') return h.symbol || '';
      if (key === 'added') return h.addedAt || '';
      const q = quotes[h.symbol];
      const native = h.currency || (h.type === 'th_stock' ? 'THB' : 'USD');
      const price = q && Number(q.price) > 0 ? Number(q.price) : null;
      const shares = Number(h.shares) || 0;
      if (key === 'value') {
        return price != null ? convert(shares * price, native) : null;
      }
      if (key === 'day') {
        return q && Number.isFinite(Number(q.changePct)) ? Number(q.changePct) : null;
      }
      // 'pl' — unrealized P&L % (needs a live price AND a real cost basis).
      const costNative = shares * (Number(h.avgCost) || 0);
      return price != null && costNative > 0
        ? ((shares * price - costNative) / costNative) * 100
        : null;
    };

    const sign = dir === 'desc' ? -1 : 1;
    return holdings
      .map((h) => ({ h, m: metricFor(h) }))
      .sort((a, b) => {
        // Missing data sinks to the bottom regardless of direction.
        if (a.m == null && b.m == null) return 0;
        if (a.m == null) return 1;
        if (b.m == null) return -1;
        if (typeof a.m === 'string' || typeof b.m === 'string') {
          return sign * String(a.m).localeCompare(String(b.m));
        }
        return sign * (a.m - b.m);
      })
      .map((r) => r.h);
  }, [holdings, quotes, convert, key, dir]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(2) }}>
      {/* Toolbar: count + sort segmented control */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: theme.space(2) }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: theme.colors.textDim,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          Holdings ({holdings.length})
        </span>
        <div style={{ flex: 1 }} />
        <div className="segmented" role="group" aria-label="Sort holdings">
          {OPTIONS.map((opt) => {
            const active = opt.key === key;
            return (
              <button
                key={opt.key}
                type="button"
                className={`segmented-item${active ? ' active' : ''}`}
                style={{ fontSize: 12, ...(active ? { color: theme.colors.text } : null) }}
                aria-pressed={active}
                aria-label={
                  active
                    ? `Sort by ${opt.label}, ${dir === 'asc' ? 'ascending' : 'descending'}`
                    : `Sort by ${opt.label}`
                }
                title={opt.title}
                onClick={() => {
                  if (active) {
                    setHoldingsSort({ dir: dir === 'asc' ? 'desc' : 'asc' });
                  } else {
                    setHoldingsSort({ key: opt.key, dir: DEFAULT_DIR[opt.key] });
                  }
                }}
              >
                {opt.label}
                {active ? (
                  dir === 'asc' ? (
                    <ArrowUp size={11} aria-hidden="true" style={{ marginLeft: 4, verticalAlign: 'middle' }} />
                  ) : (
                    <ArrowDown size={11} aria-hidden="true" style={{ marginLeft: 4, verticalAlign: 'middle' }} />
                  )
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Cards grid — identical to the block App.jsx used to render inline. */}
      <RevealGroup className="cards-grid" step={55} maxDelay={360} blur={4}>
        {sorted.map((h) => (
          <AssetCard key={h.id} holding={h} onOpen={() => onOpenChart(h.symbol)} />
        ))}
      </RevealGroup>
    </div>
  );
}
