import { useCallback, useEffect, useRef } from 'react';
import { motionEnabled } from '../lib/motion.js';

/**
 * useSpotlight — the wrapper-free variant of <SpotlightCard/>.
 *
 * Spread the returned handlers + style straight onto an element you ALREADY
 * render (e.g. the existing `.panel` AssetCard root) to get the same
 * cursor-following accent glow + subtle 3D tilt without adding a wrapper or an
 * overlay child. Because there is no child overlay to work with, the glow is
 * painted as the element's own `background-image`, which the browser always
 * composites *behind* the element's text/content — so numbers stay crisp with
 * no z-index juggling. The glow's alpha is an `@property`-registered number
 * (see index.css) so it fades in/out smoothly instead of snapping.
 *
 * Motion (tilt + lift) is transform-only and disabled under
 * prefers-reduced-motion via the matchMedia guard below; the glow remains.
 *
 * Usage:
 *   const spot = useSpotlight();
 *   <div
 *     className="panel"
 *     ref={spot.ref}
 *     onPointerMove={spot.onPointerMove}
 *     onPointerLeave={spot.onPointerLeave}
 *     style={{ ...spot.style, padding: theme.space(3), ...yourStyles }}
 *   />
 *
 * NOTE: spread `spot.style` FIRST so your own style can still override, and keep
 * the element's existing `background`/`background-color` — the hook only sets
 * `background-image`, so the panel's solid colour shows through underneath.
 *
 * @param {object}  [options]
 * @param {string}  [options.color='59, 130, 246'] glow RGB triple (accent-blue)
 * @param {number}  [options.alpha=0.16]           peak glow alpha (0..1)
 * @param {number}  [options.size=280]             glow diameter in px
 * @param {number}  [options.maxTilt=5]            max rotateX/rotateY in degrees
 * @param {boolean} [options.tilt=true]            enable the 3D tilt
 * @param {boolean} [options.lift=true]            enable the translateY(-2px) lift
 */
export default function useSpotlight(options = {}) {
  const {
    color = '59, 130, 246',
    alpha = 0.16,
    size = 280,
    maxTilt = 5,
    tilt = true,
    lift = true,
  } = options;

  const ref = useRef(null);
  const raf = useRef(0);

  const write = useCallback((el, { mx, my, rx, ry, liftPx, sc, a }) => {
    el.style.setProperty('--mx', `${mx}px`);
    el.style.setProperty('--my', `${my}px`);
    el.style.setProperty('--fx-rx', `${rx}deg`);
    el.style.setProperty('--fx-ry', `${ry}deg`);
    el.style.setProperty('--fx-lift', `${liftPx}px`);
    el.style.setProperty('--fx-sc', String(sc != null ? sc : 1));
    el.style.setProperty('--fx-glow-a', String(a));
    el.style.boxShadow = a > 0
      ? '0 12px 34px rgba(0,0,0,0.5), 0 0 0 1px rgba(59,130,246,0.10)'
      : '';
  }, []);

  const onPointerMove = useCallback(
    (e) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const reduced = !motionEnabled();
      const nx = rect.width ? x / rect.width - 0.5 : 0;
      const ny = rect.height ? y / rect.height - 0.5 : 0;
      const doTilt = tilt && !reduced;
      const doLift = lift && !reduced;
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        const node = ref.current;
        if (node) {
          write(node, {
            mx: x,
            my: y,
            rx: doTilt ? -ny * maxTilt * 2 : 0,
            ry: doTilt ? nx * maxTilt * 2 : 0,
            liftPx: doLift ? -3 : 0,
            sc: doLift ? 1.015 : 1,
            a: alpha,
          });
        }
      });
    },
    [tilt, lift, maxTilt, alpha, write]
  );

  const onPointerLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (raf.current) cancelAnimationFrame(raf.current);
    write(el, {
      mx: (el.offsetWidth || 0) / 2,
      my: (el.offsetHeight || 0) / 2,
      rx: 0,
      ry: 0,
      liftPx: 0,
      sc: 1,
      a: 0,
    });
  }, [write]);

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    []
  );

  const style = {
    position: 'relative',
    transform:
      'perspective(var(--fx-perspective, 800px)) rotateX(var(--fx-rx, 0deg)) rotateY(var(--fx-ry, 0deg)) translateY(var(--fx-lift, 0px)) scale(var(--fx-sc, 1))',
    transformStyle: 'preserve-3d',
    transition:
      'transform 0.35s cubic-bezier(0.22, 0.61, 0.36, 1), box-shadow 0.35s ease, --fx-glow-a 0.35s ease',
    willChange: 'transform',
    // Glow painted as the element's own background-image => always behind text.
    // Alpha is the @property-registered --fx-glow-a so it can transition.
    backgroundImage: `radial-gradient(var(--fx-glow-size, ${size}px) circle at var(--mx, 50%) var(--my, 50%), rgba(${color}, var(--fx-glow-a, 0)) 0%, transparent 70%)`,
    '--fx-glow-size': `${size}px`,
  };

  return { ref, onPointerMove, onPointerLeave, style };
}
