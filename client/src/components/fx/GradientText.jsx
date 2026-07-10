import React from 'react';

/**
 * GradientText — text filled with a slow, looping gradient sweep
 * (accent-blue → up-green → crypto-purple) via background-clip:text.
 *
 * Pure CSS + vanilla React. All motion lives in `.fx-gradient-text`
 * (see index.css) and animates only `background-position`, so it never
 * reflows or shifts neighbours. Under prefers-reduced-motion the sweep is
 * disabled and it degrades to a crisp static gradient.
 *
 * Props:
 *   children   — the text to render
 *   className  — extra classes (merged after the fx class so layout
 *                utilities like `.app-brand-title` still apply)
 *   style      — inline style overrides
 *   colors     — optional array of CSS colors for a custom gradient
 *                (e.g. ['#3b82f6', '#22c55e', '#a78bfa'])
 *   speed      — optional sweep duration in seconds (default 7)
 *   as         — optional element/tag to render (default 'span')
 */
export default function GradientText({
  children,
  className = '',
  style,
  colors,
  speed,
  as: Tag = 'span',
  ...rest
}) {
  const vars = {};
  if (Array.isArray(colors) && colors.length > 1) {
    vars['--fx-gt-gradient'] = `linear-gradient(90deg, ${colors.join(', ')})`;
  }
  if (speed != null) vars['--fx-gt-duration'] = `${speed}s`;

  return (
    <Tag
      className={`fx-gradient-text ${className}`.trim()}
      style={{ ...vars, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
