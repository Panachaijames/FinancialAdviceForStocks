import React, {
  useRef,
  useState,
  useCallback,
  useLayoutEffect,
  useEffect,
} from 'react';

/**
 * SlidingTabs — an accessible segmented control (tablist) with a single
 * absolutely-positioned active-indicator pill that glides between tabs
 * (transform: translateX + width), measured from each button's live geometry.
 *
 * Reuses the existing .segmented / .segmented-item look. The indicator is the
 * only element that paints the accent background — the buttons themselves are
 * transparent (see the .sliding-tabs rules in index.css), so the accent
 * appears to slide rather than instantly swap.
 *
 * Props:
 *   items    : [{ key, label }]  (label may be any renderable node)
 *   value    : currently active key
 *   onChange : (key) => void
 *   ariaLabel: accessible name for the tablist
 *   className: extra class(es) appended to the container (e.g. "view-tabs")
 */
export default function SlidingTabs({
  items = [],
  value,
  onChange,
  ariaLabel = 'View',
  className = '',
}) {
  const listRef = useRef(null);
  const btnRefs = useRef({});
  const [ind, setInd] = useState({ x: 0, y: 0, w: 0, h: 0 });
  // Start without a transition so the pill appears in place on first paint
  // instead of gliding in from the left edge.
  const [animate, setAnimate] = useState(false);

  const measure = useCallback(() => {
    const container = listRef.current;
    const btn = btnRefs.current[value];
    if (!container || !btn) return;
    // offsetLeft/offsetTop are relative to the offsetParent's border box; the
    // absolutely-positioned indicator is offset from the padding box, so we
    // subtract the container's border widths (clientLeft/clientTop) to align.
    setInd({
      x: btn.offsetLeft - container.clientLeft,
      y: btn.offsetTop - container.clientTop,
      w: btn.offsetWidth,
      h: btn.offsetHeight,
    });
  }, [value]);

  // Re-measure synchronously whenever the active tab or the item set changes.
  useLayoutEffect(() => {
    measure();
  }, [measure, items]);

  // Enable the glide transition only after the first measured paint.
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Keep the indicator aligned when the container resizes or fonts finish
  // loading (which can change button widths).
  useEffect(() => {
    const container = listRef.current;
    if (!container) return undefined;

    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      ro.observe(container);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', measure);
    }
    return () => {
      if (ro) ro.disconnect();
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', measure);
      }
    };
  }, [measure]);

  const handleKeyDown = useCallback(
    (e) => {
      if (!items.length) return;
      const idx = items.findIndex((it) => it.key === value);
      if (idx < 0) return;

      let nextIdx = null;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          nextIdx = (idx + 1) % items.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          nextIdx = (idx - 1 + items.length) % items.length;
          break;
        case 'Home':
          nextIdx = 0;
          break;
        case 'End':
          nextIdx = items.length - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      const nextKey = items[nextIdx].key;
      if (nextKey !== value) onChange?.(nextKey);
      const nextBtn = btnRefs.current[nextKey];
      if (nextBtn) nextBtn.focus();
    },
    [items, value, onChange]
  );

  const containerClass = ['segmented', 'sliding-tabs', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={listRef}
      className={containerClass}
      role="tablist"
      aria-label={ariaLabel}
    >
      <span
        aria-hidden="true"
        className={
          'sliding-tabs__indicator' +
          (animate ? ' sliding-tabs__indicator--animate' : '')
        }
        style={{
          width: ind.w,
          height: ind.h,
          transform: `translate(${ind.x}px, ${ind.y}px)`,
          opacity: ind.w > 0 ? 1 : 0,
        }}
      />
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            ref={(el) => {
              if (el) btnRefs.current[it.key] = el;
              else delete btnRefs.current[it.key];
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className="segmented-item"
            onClick={() => {
              if (!active) onChange?.(it.key);
            }}
            onKeyDown={handleKeyDown}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
