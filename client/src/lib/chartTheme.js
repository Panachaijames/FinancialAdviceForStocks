// Chart color resolution for lightweight-charts. The chart renders to a canvas
// and can't consume CSS custom properties, so we resolve the design tokens to
// LITERAL color strings once (from the runtime :root vars that theme.js stamps,
// falling back to theme.js itself). This keeps chart colors flowing from the one
// palette source and ready for a future light theme with no chart edits.
import theme from './theme.js';

/** Resolve a CSS custom property to its literal value, falling back to theme.js. */
function cssVar(name, fallback) {
  if (typeof document !== 'undefined' && document.documentElement) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v) return v;
  }
  return fallback;
}

/** Base chart colors (axes, grid, crosshair, series) as literals. Call at chart-create time. */
export function getChartColors() {
  const c = theme.colors;
  return {
    text: cssVar('--text-dim', c.textDim),
    faint: cssVar('--text-faint', c.textFaint),
    border: cssVar('--border', c.border),
    panelElev: cssVar('--panel-elev', c.panelElev),
    accent: cssVar('--accent', c.accent),
    up: cssVar('--up', c.up),
    down: cssVar('--down', c.down),
    gold: cssVar('--gold', c.gold),
    crypto: cssVar('--crypto', c.crypto),
  };
}

// Overlay-indicator palette (was hardcoded in FullChart). sma/ema reuse the brand
// accent/gold; the rest are chart-only hues that don't belong in the app palette.
export const INDICATOR_COLORS = {
  sma: theme.colors.accent, // was #3b82f6
  ema: theme.colors.gold, // was #f59e0b
  wma: '#a855f7',
  bbUpper: '#64748b',
  bbMiddle: '#94a3b8',
  bbLower: '#64748b',
  vwap: '#22d3ee',
};

/**
 * Opaque hex -> rgba() with alpha. For CANVAS use (lightweight-charts), which
 * doesn't reliably parse CSS color-mix(); the DOM side uses theme.alpha() instead.
 * @param {string} hex #rrggbb
 * @param {number} a 0..1
 */
export function rgba(hex, a) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex).trim());
  if (!m) return hex;
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export default { getChartColors, INDICATOR_COLORS, rgba };
