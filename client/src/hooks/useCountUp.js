import { useEffect, useRef, useState } from 'react';

/**
 * Cubic ease-out — fast start, gentle settle. Matches React Bits "CountUp".
 * @param {number} t progress in [0,1]
 */
function easeOutCubic(t) {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - Math.pow(1 - clamped, 3);
}

/**
 * Detect the user's reduced-motion preference (SSR/JSDOM-safe).
 */
function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Animate a number from its previous value to `value` with requestAnimationFrame
 * and an easeOutCubic curve. On first mount it counts up from 0. On subsequent
 * changes it tweens old -> new. Non-finite targets (NaN/Infinity/null) are passed
 * through untouched so the caller's formatter can render its own placeholder.
 * Respects prefers-reduced-motion: reduce (snaps instantly, no rAF loop).
 *
 * @param {number} value target numeric value
 * @param {{ durationMs?: number }} [opts]
 * @returns {number} the current animated value
 */
export default function useCountUp(value, { durationMs = 650 } = {}) {
  const target = Number(value);
  const finite = Number.isFinite(target);

  // Rendered value. Start from 0 so the first mount animates 0 -> value.
  const [display, setDisplay] = useState(finite ? 0 : target);

  const fromRef = useRef(0); // where the current tween started
  const rafRef = useRef(0);
  const startRef = useRef(0);
  const currentRef = useRef(finite ? 0 : target); // latest emitted value

  useEffect(() => {
    // Non-finite target: render it directly, no animation.
    if (!finite) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      currentRef.current = target;
      setDisplay(target);
      return undefined;
    }

    // Reduced motion: snap to the final value.
    if (prefersReducedMotion()) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      currentRef.current = target;
      setDisplay(target);
      return undefined;
    }

    // Already there — nothing to animate.
    if (currentRef.current === target) {
      return undefined;
    }

    // Tween from wherever we currently are to the new target.
    fromRef.current = currentRef.current;
    startRef.current = 0;

    const tick = (now) => {
      if (!startRef.current) startRef.current = now;
      const elapsed = now - startRef.current;
      const t = durationMs > 0 ? elapsed / durationMs : 1;
      const eased = easeOutCubic(t);
      const next = fromRef.current + (target - fromRef.current) * eased;

      if (t >= 1) {
        currentRef.current = target;
        setDisplay(target);
        rafRef.current = 0;
        return;
      }
      currentRef.current = next;
      setDisplay(next);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [target, finite, durationMs]);

  return display;
}
