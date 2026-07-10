import React, { useEffect, useState } from 'react';
import { motionEnabled } from '../../lib/motion.js';

/**
 * ChartWipe — makes a canvas chart appear to "draw itself" left-to-right.
 *
 * lightweight-charts paints to canvas, so this is a reveal wipe: a
 * panel-colored cover (background: var(--panel), matching .modal-card)
 * shrinks toward the right edge (transform: scaleX 1 -> 0,
 * transform-origin: right), uncovering the chart from left to right over
 * ~900ms with an ease-out curve. A thin 2px bright gradient line rides the
 * wipe front (a full-size sibling layer translated 0 -> 100% on the SAME
 * timing curve, so its left edge tracks the cover's shrinking left edge
 * exactly) — that leading edge is what sells the "drawing" read.
 *
 * Usage: drop inside a position:relative chart container.
 *   <ChartWipe resetKey={`${symbol}:${range}`} />
 *
 * Props:
 *   resetKey (string) — the wipe remounts (via key) and replays whenever
 *                       this changes. Mounting also plays it once.
 *
 * Behavior guarantees:
 *   - aria-hidden + pointer-events:none — purely decorative, never blocks
 *     crosshair/scroll/scale interactions on the chart.
 *   - Animates transform/opacity only; no layout shift.
 *   - After the cover's animation ends the whole overlay UNMOUNTS
 *     (onAnimationEnd -> state), so nothing is left in the paint.
 *   - JS gate: renders null when motionEnabled() is false.
 *   - CSS gate: :root[data-motion='reduce'] .fx-chart-wipe { display:none }
 *     (belt-and-braces if the attribute flips mid-flight).
 */
export default function ChartWipe({ resetKey = '' }) {
  const [done, setDone] = useState(false);

  // A new resetKey means "replay": clear the done flag so the keyed
  // remount below starts a fresh animation.
  useEffect(() => {
    setDone(false);
  }, [resetKey]);

  // Fallback cleanup: backgrounded tabs can defer animationend delivery
  // indefinitely — a timer (which still fires when throttled) guarantees the
  // cover never lingers over the chart.
  useEffect(() => {
    if (done) return undefined;
    const t = setTimeout(() => setDone(true), 1400); // 900ms anim + slack
    return () => clearTimeout(t);
  }, [resetKey, done]);

  if (done || !motionEnabled()) return null;

  return (
    <div key={resetKey} className="fx-chart-wipe" aria-hidden="true">
      {/* Panel-colored cover: scaleX 1 -> 0, origin right => reveals L->R */}
      <div
        className="fx-chart-wipe-cover"
        onAnimationEnd={(e) => {
          // Only the cover's own animation counts (not the edge's).
          if (e.target === e.currentTarget) setDone(true);
        }}
      />
      {/* Leading edge: full-size layer whose ::before is the 2px line at its
          left edge; translateX(0 -> 100%) on the same curve keeps the line
          glued to the wipe front. Clipped by the overlay's overflow:hidden. */}
      <div className="fx-chart-wipe-edge" />
    </div>
  );
}
