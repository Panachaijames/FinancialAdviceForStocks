import React from 'react';
import useCountUp from '../../hooks/useCountUp.js';

/**
 * CountUp — animates a numeric value from its previous value to the new value
 * (easeOutCubic via requestAnimationFrame) while preserving the app's formatting.
 *
 * The `format` prop is applied to the *animated* number on every frame, so
 * currency / percent formatting stays intact throughout the tween. On first
 * mount it animates from 0; afterwards old -> new. Respects prefers-reduced-motion
 * (snaps instantly) and renders non-finite values via `format` directly.
 *
 * Usage:
 *   <CountUp value={totals.marketValue} format={(n) => fmtMoney(n, cur)} />
 *   <CountUp value={pct} format={(n) => fmtSignedPct(n)} />
 *
 * Props:
 *   value:    number to display
 *   format:   (num) => string   formatter (defaults to String)
 *   durationMs: tween length in ms (default 650)
 *   ...rest:  forwarded to the <span> (style, className, title, etc.)
 */
export default function CountUp({ value, format, durationMs = 650, ...rest }) {
  const animated = useCountUp(value, { durationMs });
  const fmt = typeof format === 'function' ? format : String;
  return <span {...rest}>{fmt(animated)}</span>;
}
