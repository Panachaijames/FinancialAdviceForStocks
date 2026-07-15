// Dark fintech design tokens. Default + named export "theme".
const theme = {
  colors: {
    bg: '#0b0e14',
    bgElev: '#0f1320',
    panel: '#141925',
    panelElev: '#1a2030',
    border: '#232a3a',
    text: '#e6eaf2',
    textDim: '#9aa4b8',
    textFaint: '#5d6679',
    up: '#22c55e',
    down: '#ef4444',
    accent: '#3b82f6',
    accentDim: '#1d3a66',
    gold: '#f59e0b',
    crypto: '#a78bfa',
    warn: '#f97316',
  },
  radius: {
    sm: 6,
    md: 10,
    lg: 14,
    xl: 22,
  },
  // space(n) -> pixel value on an 8px-ish scale (4 * n)
  space: (n) => 4 * n,
  font:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'",
  mono:
    "'SF Mono', SFMono-Regular, ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  shadow: '0 8px 30px rgba(0,0,0,0.45)',
};

/**
 * Write the design tokens onto :root as CSS custom properties, making theme.js
 * the SINGLE source of truth: index.css keeps the same names only as a pre-JS
 * fallback, and this overrides them at startup, so a palette change (or a future
 * light theme) is one edit here. camelCase color keys map to kebab CSS vars
 * (bgElev -> --bg-elev). Call once from main.jsx before render.
 * @param {HTMLElement} [root]
 */
export function applyThemeVars(root) {
  const el = root || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el) return;
  const kebab = (k) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  for (const [k, v] of Object.entries(theme.colors)) {
    el.style.setProperty(`--${kebab(k)}`, v);
  }
  for (const [k, v] of Object.entries(theme.radius)) {
    el.style.setProperty(`--radius-${k}`, `${v}px`);
  }
  el.style.setProperty('--font', theme.font);
  el.style.setProperty('--mono', theme.mono);
}

/**
 * Translucent variant of a color via color-mix — the robust replacement for the
 * fragile `color + '22'` hex-alpha concatenation (which only works on 6-digit
 * hex). For DOM/CSS use; canvas (lightweight-charts) needs rgba, see chartTheme.
 * @param {string} color any CSS color
 * @param {number} percent opacity 0..100
 */
export function alpha(color, percent) {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

export { theme };
export default theme;
