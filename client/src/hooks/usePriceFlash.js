import { useEffect, useRef, useState } from 'react';

/**
 * Trading-terminal "tick flash": when a live numeric value changes, briefly
 * flash green (tick up) or red (tick down), then fade back — like a broker
 * terminal. The flash auto-clears after ~600ms.
 *
 * Usage:
 *   const { flash, className, flashKey } = usePriceFlash(price);
 *   <span key={flashKey} className={className}>{fmt(price)}</span>
 *
 * @param {number|null|undefined} value  current live value
 * @param {number} [duration=600]        ms before the flash auto-clears
 * @returns {{ flash: ('up'|'down'|null), className: string, flashKey: number }}
 *   - flash:     direction of the last tick, or null when idle
 *   - className: 'price-flash-up' | 'price-flash-down' | '' (ready for the span)
 *   - flashKey:  monotonically increasing id — apply as React `key` on the
 *                flashing element so the CSS animation reliably restarts even
 *                on consecutive same-direction ticks
 */
export default function usePriceFlash(value, duration = 600) {
  const [flash, setFlash] = useState(null);
  const [flashKey, setFlashKey] = useState(0);
  const prevRef = useRef(undefined);
  const timerRef = useRef(null);

  useEffect(() => {
    const next = Number(value);
    const prev = prevRef.current;

    // Ignore non-numeric values entirely (don't disturb prev / flash).
    if (!Number.isFinite(next)) return undefined;

    // First real numeric value: seed the baseline, never flash.
    if (prev === undefined) {
      prevRef.current = next;
      return undefined;
    }

    // Only flash on a genuine numeric change.
    if (next === prev) return undefined;

    const dir = next > prev ? 'up' : 'down';
    prevRef.current = next;
    setFlash(dir);
    setFlashKey((k) => k + 1);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setFlash(null);
      timerRef.current = null;
    }, duration);

    return undefined;
  }, [value, duration]);

  // Clean up a pending timer on unmount.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const className = flash ? `price-flash-${flash}` : '';
  return { flash, className, flashKey };
}
