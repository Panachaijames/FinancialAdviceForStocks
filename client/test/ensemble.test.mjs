// Tests for the forecast ensemble/band math (Quarter task 6) — previously
// untestable inside the 777-line ForecastView, now a pure module.
// Run with:  node --test client/test/ensemble.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandFor, ensembleCloses, forecastReturnsPct } from '../src/lib/forecast/ensemble.js';

test('ensembleCloses: per-day mean across models, ignoring non-finite', () => {
  const forecasts = [
    { closes: [100, 110, 120] },
    { closes: [200, NaN, 140] },
  ];
  assert.deepEqual(ensembleCloses(forecasts, 3), [150, 110, 130]);
  // NaN day (no finite values) -> NaN
  const r = ensembleCloses([{ closes: [NaN] }, { closes: [NaN] }], 1);
  assert.ok(Number.isNaN(r[0]));
  // defaults length to the first forecast
  assert.deepEqual(ensembleCloses([{ closes: [10, 20] }, { closes: [30, 40] }]), [20, 30]);
});

test('bandFor: geometric band widens with sqrt(horizon)', () => {
  const b = bandFor([100, 100, 100], 0.02);
  // step 1: exp(±1.96·0.02·1)
  assert.ok(Math.abs(b.upper[0] - 100 * Math.exp(1.96 * 0.02)) < 1e-9);
  assert.ok(Math.abs(b.lower[0] - 100 * Math.exp(-1.96 * 0.02)) < 1e-9);
  // band is symmetric in log space and grows: upper[2] > upper[1] > upper[0]
  assert.ok(b.upper[2] > b.upper[1] && b.upper[1] > b.upper[0]);
  assert.ok(b.lower[2] < b.lower[1] && b.lower[1] < b.lower[0]);
  // sigma 0 -> flat band equal to the path
  assert.deepEqual(bandFor([50, 60], 0), { lower: [50, 60], upper: [50, 60] });
});

test('forecastReturnsPct: terminal close vs last actual, keyed by model', () => {
  const forecasts = [
    { key: 'arima', closes: [100, 105, 110] },
    { key: 'lstm', closes: [100, 95, 90] },
  ];
  const r = forecastReturnsPct(forecasts, 100);
  assert.deepEqual(Object.keys(r).sort(), ['arima', 'lstm']);
  assert.ok(Math.abs(r.arima - 10) < 1e-9); // (110/100 - 1)·100
  assert.ok(Math.abs(r.lstm - -10) < 1e-9);
  // guards: lastClose <= 0 -> empty; non-finite terminal skipped
  assert.deepEqual(forecastReturnsPct(forecasts, 0), {});
  assert.deepEqual(forecastReturnsPct([{ key: 'x', closes: [1, NaN] }], 100), {});
});
