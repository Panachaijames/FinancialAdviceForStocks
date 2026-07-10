import { useCallback, useEffect, useRef } from 'react';

/**
 * useMagnetic — subtle "magnetic" pull toward the cursor (React Bits "Magnet").
 *
 * The element translates a few px toward the pointer while the pointer is over
 * it, then springs back to rest on leave. Pure transform (GPU-friendly, no
 * layout shift) applied imperatively via a ref, so it never triggers a React
 * re-render on every pointer move.
 *
 * Usage:
 *   const mag = useMagnetic();               // or useMagnetic({ strength: 8 })
 *   <button ref={mag.ref} onPointerMove={mag.onPointerMove}
 *           onPointerLeave={mag.onPointerLeave}>…</button>
 *
 * Respects prefers-reduced-motion: reduce — the handlers become no-ops and the
 * element stays at its resting position.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.strength=6]  Max travel in px toward the cursor.
 * @param {number}  [opts.padding=0]   Extra px around the element counted as
 *                                     "inside" (softens the edge). Purely maths;
 *                                     does not change layout.
 */
export default function useMagnetic(opts = {}) {
  const { strength = 6, padding = 0 } = opts;
  const ref = useRef(null);
  const reduceRef = useRef(false);

  // Track the reduced-motion preference (guarded for SSR / older browsers).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      reduceRef.current = mq.matches;
      // If the user flips to "reduce" mid-hover, snap back immediately.
      if (mq.matches && ref.current) {
        ref.current.style.transform = '';
        ref.current.style.transition = '';
      }
    };
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', apply);
      else if (mq.removeListener) mq.removeListener(apply);
    };
  }, []);

  const onPointerMove = useCallback(
    (e) => {
      const el = ref.current;
      if (!el || reduceRef.current) return;
      // Only react to a real cursor (mouse/pen); coarse touch pointers skip it.
      if (e.pointerType === 'touch') return;

      const rect = el.getBoundingClientRect();
      const halfW = rect.width / 2 + padding;
      const halfH = rect.height / 2 + padding;
      if (halfW <= 0 || halfH <= 0) return;

      // Offset of the cursor from the element centre, normalised to [-1, 1].
      const relX = (e.clientX - (rect.left + rect.width / 2)) / halfW;
      const relY = (e.clientY - (rect.top + rect.height / 2)) / halfH;
      const clamp = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

      const tx = clamp(relX) * strength;
      const ty = clamp(relY) * strength;

      // Short transition so it tracks the cursor smoothly without lag.
      el.style.transition = 'transform 0.15s cubic-bezier(0.33, 1, 0.68, 1)';
      el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`;
    },
    [strength, padding],
  );

  const onPointerLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Springy return to rest.
    el.style.transition = 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)';
    el.style.transform = 'translate3d(0, 0, 0)';
  }, []);

  return { ref, onPointerMove, onPointerLeave };
}
