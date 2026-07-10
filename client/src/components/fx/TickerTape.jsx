// TickerTape — Wall-Street style marquee of the portfolio's live prices.
// Sits directly under the sticky app header. Pure-CSS marquee (transform only),
// pause on hover, edge fades via mask-image, gated by the app's FX toggle
// through :root[data-motion='reduce'] CSS rules (no JS animation to clean up).
import React, { useMemo } from 'react';
import { usePortfolioStore } from '../../store/portfolioStore.js';
import { useSettingsStore } from '../../store/settingsStore.js';
import useQuotes from '../../hooks/useQuotes.js';
import useFx from '../../hooks/useFx.js';
import { fmtMoney, fmtSignedPct } from '../../lib/format.js';
import { theme } from '../../lib/theme.js';

export default function TickerTape() {
  const holdings = usePortfolioStore((s) => s.holdings);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);

  // Unique symbols, preserving holding order (store already merges by symbol,
  // but dedupe defensively so the marquee never repeats an entry).
  const symbols = useMemo(
    () => Array.from(new Set(holdings.map((h) => h.symbol).filter(Boolean))),
    [holdings]
  );

  const { quotes } = useQuotes(symbols);
  const { convert } = useFx();

  if (holdings.length === 0) return null;

  const currencyBySymbol = {};
  for (const h of holdings) {
    if (currencyBySymbol[h.symbol] === undefined) currencyBySymbol[h.symbol] = h.currency;
  }

  const items = symbols.map((sym) => {
    const q = quotes[sym];
    const rawPrice = q ? Number(q.price) : NaN;
    const rawPct = q ? Number(q.changePct) : NaN;
    return {
      symbol: sym,
      price: Number.isFinite(rawPrice)
        ? convert(rawPrice, currencyBySymbol[sym] || 'USD')
        : null,
      changePct: Number.isFinite(rawPct) ? rawPct : null,
    };
  });

  // Longer tapes scroll for longer so perceived speed stays constant.
  const durationSec = Math.max(24, items.length * 6);

  const renderItems = (hidden) =>
    items.map((it) => {
      const pctColor =
        it.changePct === null
          ? 'var(--text-faint)'
          : it.changePct < 0
            ? 'var(--down)'
            : it.changePct > 0
              ? 'var(--up)'
              : 'var(--text-dim)';
      return (
        <span
          key={`${hidden ? 'b' : 'a'}-${it.symbol}`}
          className="ticker-item"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: theme.space(2),
            whiteSpace: 'nowrap',
            fontFamily: theme.mono,
            fontSize: 12,
            lineHeight: 1,
          }}
        >
          <span style={{ fontWeight: 700, color: 'var(--text)', letterSpacing: '0.02em' }}>
            {it.symbol}
          </span>
          <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>
            ·
          </span>
          <span style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
            {fmtMoney(it.price, displayCurrency)}
          </span>
          <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>
            ·
          </span>
          <span style={{ color: pctColor, fontVariantNumeric: 'tabular-nums' }}>
            {fmtSignedPct(it.changePct)}
          </span>
        </span>
      );
    });

  return (
    <div className="ticker" role="marquee" aria-label="Live portfolio prices">
      <div className="ticker-track" style={{ '--ticker-dur': `${durationSec}s` }}>
        <div className="ticker-half">{renderItems(false)}</div>
        <div className="ticker-half" aria-hidden="true">
          {renderItems(true)}
        </div>
      </div>
    </div>
  );
}
