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

export { theme };
export default theme;
