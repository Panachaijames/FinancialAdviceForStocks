import React, { useEffect, useState } from 'react';
import { theme } from '../../lib/theme.js';
import { motionEnabled } from '../../lib/motion.js';

/**
 * Odometer — mechanical rolling-digit (split-flap) number display.
 *
 * The CURRENT value is formatted via `format`, then split into characters.
 * Every digit renders as a vertical 0-9 strip inside an overflow-hidden,
 * 1em-tall / 1ch-wide cell; the strip is translated with
 * `transform: translateY(-digit * 1em)` and CSS-transitions to each new
 * digit (slight left->right stagger, ~30ms per column). Non-digit characters
 * (currency symbol, thousands separator, decimal point, minus) are static
 * cells with the same box metrics so everything shares one baseline.
 *
 * Length changes (e.g. 999,999.99 -> 1,000,000.00) are keyed from the RIGHT
 * (reverse-index keys), so the least-significant columns keep their DOM nodes
 * and keep rolling smoothly while new most-significant columns mount on the
 * left. Newly mounted columns arm at 0 and roll up to their target digit —
 * same spin-up feel CountUp gives on first mount.
 *
 * Accessibility: a visually-hidden span (.fx-odometer-sr) carries the plain
 * formatted string and the entire column stack is aria-hidden, so screen
 * readers hear ONE number, never ten loose digits. (role="text" is
 * non-standard ARIA, so the hidden-text pattern is used instead.)
 *
 * Motion: if motionEnabled() is false the component renders the plain
 * formatted string (no columns at all). The CSS side also carries a
 * `:root[data-motion='reduce']` rule that kills strip transitions, covering
 * a mid-session FX-toggle flip before React re-renders.
 *
 * Props:
 *   value:      number to display
 *   format:     (num) => string formatter (defaults to String)
 *   durationMs: roll duration per column in ms (default 900)
 *   style:      merged onto the root span (after mono/tabular defaults)
 *   className:  appended after "fx-odometer"
 */

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const STAGGER_MS = 30;

/** One rolling 0-9 column. Mounts showing 0, then rolls to its target. */
function DigitColumn({ digit, delayMs, durationMs }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    // Double rAF: guarantee the browser paints the "0" position before we
    // move to the target digit, so the roll transitions instead of snapping.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setArmed(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, []);

  const shown = armed ? digit : 0;

  return (
    <span className="fx-odometer-cell">
      <span
        className="fx-odometer-strip"
        style={{
          transform: `translateY(${-shown}em)`,
          transitionDuration: `${durationMs}ms`,
          transitionDelay: `${delayMs}ms`,
        }}
      >
        {DIGITS.map((n) => (
          <span key={n} className="fx-odometer-digit">
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}

export default function Odometer({ value, format, durationMs = 900, style, className }) {
  const fmt = typeof format === 'function' ? format : String;
  const text = fmt(value);

  const rootClass = className ? `fx-odometer ${className}` : 'fx-odometer';
  const rootStyle = {
    fontFamily: theme.mono,
    fontVariantNumeric: 'tabular-nums',
    ...style,
  };

  // Motion gate (and non-finite guard): plain formatted string, no columns.
  if (!motionEnabled() || !Number.isFinite(value)) {
    return (
      <span className={rootClass} style={rootStyle}>
        {text}
      </span>
    );
  }

  const chars = Array.from(text);
  const len = chars.length;

  return (
    <span className={rootClass} style={rootStyle}>
      {/* Screen readers get ONE plain number; the columns below are hidden. */}
      <span className="fx-odometer-sr">{text}</span>
      <span aria-hidden="true">
        {chars.map((ch, i) => {
          // Reverse index: identity is measured from the RIGHT so when the
          // formatted length changes, least-significant columns keep their
          // keys (and DOM nodes) and new columns mount on the left.
          const rev = len - 1 - i;
          const isDigit = ch >= '0' && ch <= '9';
          if (isDigit) {
            return (
              <DigitColumn
                key={`d${rev}`}
                digit={ch.charCodeAt(0) - 48}
                delayMs={i * STAGGER_MS}
                durationMs={durationMs}
              />
            );
          }
          return (
            <span key={`s${rev}:${ch}`} className="fx-odometer-static">
              {ch === ' ' ? ' ' : ch}
            </span>
          );
        })}
      </span>
    </span>
  );
}
