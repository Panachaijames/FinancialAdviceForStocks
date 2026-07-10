import React, { useEffect, useRef, useState } from 'react';

/**
 * Reveal — staggered scroll-into-view reveal.
 *
 * Adapted from React Bits "AnimatedContent" / "FadeContent" (which pair an
 * IntersectionObserver with GSAP) to this repo's pure-CSS + vanilla-React
 * reality: the motion lives entirely in the `.fx-reveal` / `.fx-reveal.is-visible`
 * classes in index.css. When the element scrolls into view we add `is-visible`
 * and CSS transitions translateY(distance)->0, opacity 0->1, and (optionally)
 * blur(n)->0. Only transform / opacity / filter animate, so it stays on the GPU
 * and never reflows neighbours.
 *
 * Perf: one IntersectionObserver per instance that disconnects the moment it
 * fires (when `once`, the default). No observer at all when reduced-motion is on
 * or IntersectionObserver is missing — content renders at its resting state
 * immediately.
 *
 * Usage:
 *   <Reveal>...</Reveal>
 *   <Reveal delay={120} as="section" className="panel">...</Reveal>
 *   {items.map((it, i) => (
 *     <Reveal key={it.id} delay={Math.min(i * 60, 420)}>
 *       <Card item={it} />
 *     </Reveal>
 *   ))}
 *
 * Props:
 *   as         element/component to render (default 'div')
 *   delay      ms before this instance animates once visible (for stagger)
 *   distance   px it slides up from (default 14)
 *   blur       px of initial blur, 0 to disable (default 6)
 *   once       reveal a single time then stop observing (default true)
 *   threshold  IntersectionObserver threshold (default 0.12)
 *   rootMargin IntersectionObserver rootMargin (default triggers slightly early)
 *   style/className/…rest forwarded to the rendered element.
 */

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const HAS_IO = typeof window !== 'undefined' && 'IntersectionObserver' in window;

export default function Reveal({
  as: Tag = 'div',
  delay = 0,
  distance = 14,
  blur = 6,
  once = true,
  threshold = 0.12,
  rootMargin = '0px 0px -8% 0px',
  className = '',
  style,
  children,
  ...rest
}) {
  // No observer available or motion is reduced => start at the resting state.
  const [visible, setVisible] = useState(REDUCED_MOTION || !HAS_IO);
  const ref = useRef(null);

  useEffect(() => {
    if (REDUCED_MOTION || !HAS_IO) return undefined;
    const el = ref.current;
    if (!el) return undefined;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            if (once) {
              io.disconnect();
              return;
            }
          } else if (!once) {
            setVisible(false);
          }
        }
      },
      { threshold, rootMargin }
    );

    io.observe(el);
    return () => io.disconnect();
  }, [once, threshold, rootMargin]);

  const mergedStyle = {
    '--fx-reveal-delay': `${delay}ms`,
    '--fx-reveal-y': `${distance}px`,
    '--fx-reveal-blur': `${blur}px`,
    ...style,
  };

  const cls =
    'fx-reveal' +
    (visible ? ' is-visible' : '') +
    (className ? ` ${className}` : '');

  return (
    <Tag ref={ref} className={cls} style={mergedStyle} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * RevealGroup — wrap a set of siblings and stagger them automatically.
 *
 * Each direct child is wrapped in its own <Reveal> whose delay is
 * `baseDelay + index * step` (ms). The outer `Tag` keeps whatever layout you
 * give it (e.g. a grid), and each Reveal wrapper becomes that layout's item.
 *
 *   <RevealGroup className="cards-grid" step={60}>
 *     {rows.map((r) => <Card key={r.id} row={r} />)}
 *   </RevealGroup>
 *
 * `maxDelay` caps the per-item delay so long lists don't wait forever.
 */
export function RevealGroup({
  as: Tag = 'div',
  childAs = 'div',
  baseDelay = 0,
  step = 70,
  maxDelay = 420,
  distance,
  blur,
  once,
  threshold,
  rootMargin,
  className = '',
  style,
  children,
  ...rest
}) {
  const items = React.Children.toArray(children);
  return (
    <Tag className={className} style={style} {...rest}>
      {items.map((child, i) => (
        <Reveal
          key={child.key != null ? child.key : i}
          as={childAs}
          delay={Math.min(baseDelay + i * step, baseDelay + maxDelay)}
          distance={distance}
          blur={blur}
          once={once}
          threshold={threshold}
          rootMargin={rootMargin}
        >
          {child}
        </Reveal>
      ))}
    </Tag>
  );
}
