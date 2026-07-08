// Tests for the Forecast page feature pipeline (features.js).
// Run with:  npm test   (node --test client/test/)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDataset,
  recursiveForecast,
  evaluateOneStep,
  arimaOneStepPreds,
  nextBusinessDay,
  featureNames,
  WARMUP,
} from '../src/lib/forecast/features.js';

const DAY = 86400;
// Weekday-only synthetic series: sine wave + drift, deterministic.
function makeCandles(n, start = 1767225600 /* 2026-01-01 */) {
  const out = [];
  let t = start;
  for (let i = 0; i < n; i += 1) {
    // skip weekends
    while ([0, 6].includes(new Date(t * 1000).getUTCDay())) t += DAY;
    out.push({ time: t, close: 100 * Math.exp(0.0004 * i) + 5 * Math.sin(i / 9), volume: 1000 + (i % 7) * 50 });
    t += DAY;
  }
  return out;
}

const OPTS = { technical: true, macro: false, calendar: true };

test('buildDataset: shapes, alignment, and finite rows', () => {
  const candles = makeCandles(300);
  const ds = buildDataset(candles, null, OPTS);
  assert.equal(ds.rows.length, ds.targets.length);
  assert.equal(ds.rows.length, 300 - WARMUP - 1); // one target per row, last day has no next-day
  assert.equal(ds.names.length, ds.rows[0].length); // names match row width
  for (const row of ds.rows) for (const v of row) assert.ok(Number.isFinite(v));
  // target[i] is the next-day log return at time index WARMUP+i
  const t0 = Math.log(ds.closes[WARMUP + 1] / ds.closes[WARMUP]);
  assert.ok(Math.abs(ds.targets[0] - t0) < 1e-12);
});

test('buildDataset throws on short history', () => {
  assert.throws(() => buildDataset(makeCandles(100), null, OPTS), /at least/);
});

test('featureNames respects option toggles', () => {
  const tech = featureNames({ technical: true, macro: false, calendar: false });
  const cal = featureNames({ technical: false, macro: false, calendar: true });
  assert.equal(tech.length, 13);
  assert.deepEqual(cal, ['dayOfWeek', 'monthFrac']);
});

test('recursiveForecast: constant-return model compounds exactly', async () => {
  const ds = buildDataset(makeCandles(300), null, OPTS);
  const r = 0.01;
  const { closes, dates } = await recursiveForecast(ds, () => r, 5);
  assert.equal(closes.length, 5);
  const last = ds.closes[ds.closes.length - 1];
  for (let h = 0; h < 5; h += 1) {
    assert.ok(Math.abs(closes[h] - last * Math.exp(r * (h + 1))) < 1e-9);
  }
  // dates are business days strictly after the last candle
  assert.ok(dates[0] > ds.dates[ds.dates.length - 1]);
  for (const d of dates) assert.ok(![0, 6].includes(new Date(d * 1000).getUTCDay()));
});

test('recursiveForecast clamps model blow-ups to ±20%/day', async () => {
  const ds = buildDataset(makeCandles(300), null, OPTS);
  const { closes } = await recursiveForecast(ds, () => 5, 2); // absurd +500%/day prediction
  const last = ds.closes[ds.closes.length - 1];
  assert.ok(Math.abs(closes[0] - last * Math.exp(0.2)) < 1e-9);
});

test('evaluateOneStep: perfect predictions and direction accuracy', () => {
  const perfect = evaluateOneStep([0.01, -0.02, 0.005], [0.01, -0.02, 0.005]);
  assert.equal(perfect.rmse, 0);
  assert.equal(perfect.dirAcc, 100);
  const mixed = evaluateOneStep([0.01, 0.01], [0.02, -0.02]); // right sign, wrong sign
  assert.equal(mixed.dirAcc, 50);
  // zero predictions never score direction (a naive model earns 0%)
  assert.equal(evaluateOneStep([0, 0], [0.01, -0.01]).dirAcc, 0);
});

test('arimaOneStepPreds: pure AR(1) filter reproduces the recursion', () => {
  const model = { phi: [0.5], theta: [], intercept: 0.001 };
  const returns = [0.01, 0.02, -0.01, 0.005, 0.0];
  const preds = arimaOneStepPreds(model, returns, 3);
  // t=3: 0.001 + 0.5·r2 ; t=4: 0.001 + 0.5·r3
  assert.ok(Math.abs(preds[0] - (0.001 + 0.5 * -0.01)) < 1e-12);
  assert.ok(Math.abs(preds[1] - (0.001 + 0.5 * 0.005)) < 1e-12);
});

test('nextBusinessDay skips weekends', () => {
  // 2026-07-03 is a Friday
  const fri = Math.floor(Date.UTC(2026, 6, 3) / 1000);
  const next = nextBusinessDay(fri);
  assert.equal(new Date(next * 1000).getUTCDay(), 1); // Monday
});
