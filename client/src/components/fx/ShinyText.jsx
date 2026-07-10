import React from 'react';

/**
 * ShinyText — solid-colored text with a periodic bright sheen that
 * sweeps across like a light glint, then rests for a few seconds.
 *
 * Pure CSS + vanilla React. All motion lives in `.fx-shiny-text`
 * (see index.css) and animates only `background-position`, so it never
 * reflows or shifts neighbours. Under prefers-reduced-motion the glint is
 * disabled and it degrades to plain text in the base color.
 *
 * Props:
 *   children   — the text to render
 *   className  — extra classes (merged after the fx class)
 *   style      — inline style overrides
 *   base       — base text color (default var(--text))
 *   sheen      — sheen highlight color (default soft white)
 *   speed      — full cycle duration in seconds (default 6; the sweep is a
 *                brief glint, the remainder is a rest/pause)
 *   as         — optional element/tag to render (default 'span')
 */
export default function ShinyText({
  children,
  className = '',
  style,
  base,
  sheen,
  speed,
  as: Tag = 'span',
  ...rest
}) {
  const vars = {};
  if (base) vars['--fx-st-base'] = base;
  if (sheen) vars['--fx-st-sheen'] = sheen;
  if (speed != null) vars['--fx-st-duration'] = `${speed}s`;

  return (
    <Tag
      className={`fx-shiny-text ${className}`.trim()}
      style={{ ...vars, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
