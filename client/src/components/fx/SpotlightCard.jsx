import React, { useCallback, useEffect, useRef } from 'react';
import { motionEnabled } from '../../lib/motion.js';

/**
 * SpotlightCard
 * -------------
 * A card surface with a soft, cursor-following radial glow (accent-blue, low
 * alpha) and a very subtle 3D tilt toward the pointer. Pure CSS + vanilla React
 * hooks; adds ZERO dependencies.
 *
 * It renders a SINGLE element (default <div>) that you style exactly like the
 * existing `.panel` cards: pass `className="panel"`, plus `role`, `tabIndex`,
 * `onClick`, `onKeyDown`, `style`, `children` — every one of those is forwarded
 * untouched, so it drops in as the AssetCard root without changing behaviour or
 * layout. The glow is an aria-hidden, pointer-events:none overlay that sits
 * *behind* the text (`z-index:-1` inside the `isolation:isolate` stacking
 * context defined in index.css) so numbers/labels stay crisp.
 *
 * Motion (tilt + lift) is transform-only and disabled under
 * prefers-reduced-motion — both in JS (below) and in CSS (index.css) as a
 * belt-and-suspenders guard. The glow remains but static-ish.
 *
 * Your own pointer handlers still fire: pass onPointerMove/Enter/Leave and they
 * are called after the internal effect logic.
 *
 * @param {object}  props
 * @param {React.ElementType} [props.as='div']   element/tag to render
 * @param {string}  [props.className='']         merged after the internal fx class
 * @param {object}  [props.style]                merged last (wins over fx vars)
 * @param {string}  [props.glowColor]            any CSS color incl. alpha for the glow
 * @param {number}  [props.glowSize=280]         glow diameter in px
 * @param {number}  [props.maxTilt=5]            max rotateX/rotateY in degrees (~4-6)
 * @param {boolean} [props.tilt=true]            enable the 3D tilt
 * @param {boolean} [props.lift=true]            enable the translateY(-2px) lift
 */
export default function SpotlightCard({
  as: Tag = 'div',
  className = '',
  style,
  children,
  glowColor = 'rgba(59, 130, 246, 0.22)', // accent (#3b82f6) at low alpha
  glowSize = 300,
  maxTilt = 6,
  tilt = true,
  lift = true,
  onPointerMove,
  onPointerEnter,
  onPointerLeave,
  ...rest
}) {
  const ref = useRef(null);
  const raf = useRef(0);

  const writeVars = useCallback((el, { mx, my, rx, ry, liftPx, sc, glow }) => {
    el.style.setProperty('--mx', `${mx}px`);
    el.style.setProperty('--my', `${my}px`);
    el.style.setProperty('--fx-rx', `${rx}deg`);
    el.style.setProperty('--fx-ry', `${ry}deg`);
    el.style.setProperty('--fx-lift', `${liftPx}px`);
    el.style.setProperty('--fx-sc', String(sc));
    el.style.setProperty('--fx-glow-opacity', String(glow));
    // Lift the card off the page with a slightly stronger, faintly accent-tinted
    // shadow while hovered; cleared on leave so it eases back to the flat panel.
    el.style.boxShadow = glow
      ? '0 12px 34px rgba(0,0,0,0.5), 0 0 0 1px rgba(59,130,246,0.10)'
      : '';
  }, []);

  const handleMove = useCallback(
    (e) => {
      const el = ref.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const reduced = !motionEnabled();
        const nx = rect.width ? x / rect.width - 0.5 : 0; // -0.5 .. 0.5
        const ny = rect.height ? y / rect.height - 0.5 : 0;
        const doTilt = tilt && !reduced;
        const doLift = lift && !reduced;
        const ry = doTilt ? nx * maxTilt * 2 : 0; // horizontal -> rotateY
        const rx = doTilt ? -ny * maxTilt * 2 : 0; // vertical -> rotateX (inverted)
        if (raf.current) cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(() => {
          const node = ref.current;
          if (node) {
            writeVars(node, {
              mx: x,
              my: y,
              rx,
              ry,
              liftPx: doLift ? -3 : 0,
              sc: doLift ? 1.015 : 1,
              glow: 1,
            });
          }
        });
      }
      if (onPointerMove) onPointerMove(e);
    },
    [tilt, lift, maxTilt, writeVars, onPointerMove]
  );

  const handleEnter = useCallback(
    (e) => {
      const el = ref.current;
      if (el) el.style.setProperty('--fx-glow-opacity', '1');
      if (onPointerEnter) onPointerEnter(e);
    },
    [onPointerEnter]
  );

  const handleLeave = useCallback(
    (e) => {
      const el = ref.current;
      if (el) {
        if (raf.current) cancelAnimationFrame(raf.current);
        writeVars(el, {
          mx: (el.offsetWidth || 0) / 2,
          my: (el.offsetHeight || 0) / 2,
          rx: 0,
          ry: 0,
          liftPx: 0,
          sc: 1,
          glow: 0,
        });
      }
      if (onPointerLeave) onPointerLeave(e);
    },
    [writeVars, onPointerLeave]
  );

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    []
  );

  return (
    <Tag
      ref={ref}
      className={`fx-spotlight ${className}`.trim()}
      onPointerMove={handleMove}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      style={{
        '--fx-glow-color': glowColor,
        '--fx-glow-size': `${glowSize}px`,
        ...style,
      }}
      {...rest}
    >
      <span className="fx-spotlight-glow" aria-hidden="true" />
      {children}
    </Tag>
  );
}
