// Tests for the pure design-token helpers (task 3.2): theme.alpha() (CSS
// color-mix) and chartTheme.rgba() (canvas rgba). applyThemeVars/getChartColors
// need a DOM, so they're covered by the in-browser check instead.
// Run with:  node --test client/test/designTokens.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alpha } from '../src/lib/theme.js';
import { rgba, INDICATOR_COLORS } from '../src/lib/chartTheme.js';

test('alpha(): color-mix string, works for any CSS color (not just 6-hex)', () => {
  assert.equal(alpha('#3b82f6', 13), 'color-mix(in srgb, #3b82f6 13%, transparent)');
  assert.equal(alpha('var(--accent)', 50), 'color-mix(in srgb, var(--accent) 50%, transparent)');
});

test('rgba(): parses #rrggbb (with/without #) to rgba(); passes through junk', () => {
  assert.equal(rgba('#22c55e', 0.45), 'rgba(34, 197, 94, 0.45)');
  assert.equal(rgba('ef4444', 0.45), 'rgba(239, 68, 68, 0.45)');
  assert.equal(rgba('transparent', 0.5), 'transparent'); // unparseable -> unchanged
});

test('indicator palette reuses the brand accent/gold', () => {
  assert.equal(INDICATOR_COLORS.sma, '#3b82f6'); // == theme accent
  assert.equal(INDICATOR_COLORS.ema, '#f59e0b'); // == theme gold
});
