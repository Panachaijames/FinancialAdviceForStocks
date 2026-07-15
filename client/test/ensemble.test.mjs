// Tests for the forecast ensemble/band math (Quarter task 6) — previously
// untestable inside the 777-line ForecastView, now a pure module.
// Run with:  node --test client/test/ensemble.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandFor, ensembleCloses, forecastReturnsPct, scenarioPath, newsScenario } from '../src/lib/forecast/ensemble.js';

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

test('scenarioPath: ramps to the terminal log-shift, identity at 0', () => {
  const base = [100, 100, 100, 100];
  // shift 0 -> unchanged (but a fresh array)
  const same = scenarioPath(base, 0);
  assert.deepEqual(same, base);
  assert.notEqual(same, base);
  // terminal reaches exp(shift); day 1 is only 1/n of the way
  const shift = Math.log(1.2); // +20% terminal
  const p = scenarioPath(base, shift);
  assert.ok(Math.abs(p[3] - 120) < 1e-9); // last = 100·exp(shift) = 120
  assert.ok(Math.abs(p[0] - 100 * Math.exp(shift * 0.25)) < 1e-9);
  assert.ok(p[0] < p[1] && p[1] < p[2] && p[2] < p[3]); // monotone up
  // negative shift bends down
  const d = scenarioPath(base, -shift);
  assert.ok(d[3] < 100 && d[0] > d[3]);
  // empty / non-finite guards
  assert.deepEqual(scenarioPath([], Math.log(1.1)), []);
  assert.deepEqual(scenarioPath(base, NaN), base);
});

test('newsScenario: vol-scaled cone, tilt amplifies its own side only', () => {
  const base = Array(30).fill(100);
  const sigmaDaily = 0.02;
  const volH = sigmaDaily * Math.sqrt(30);
  // neutral news -> symmetric ±1σ_H cone
  const neu = newsScenario(base, sigmaDaily, 0);
  assert.ok(Math.abs(neu.upShift - volH) < 1e-9);
  assert.ok(Math.abs(neu.downShift + volH) < 1e-9);
  assert.ok(neu.up[29] > 100 && neu.down[29] < 100);
  // fully bullish -> up amplified ~2×, down unchanged (~1×)
  const bull = newsScenario(base, sigmaDaily, 1);
  assert.ok(Math.abs(bull.upShift - 2 * volH) < 1e-9);
  assert.ok(Math.abs(bull.downShift + volH) < 1e-9);
  // fully bearish -> mirror
  const bear = newsScenario(base, sigmaDaily, -1);
  assert.ok(Math.abs(bear.downShift + 2 * volH) < 1e-9);
  assert.ok(Math.abs(bear.upShift - volH) < 1e-9);
  // zero volatility -> flat cone (no made-up magnitude)
  const flat = newsScenario(base, 0, 1);
  assert.deepEqual(flat.up, base);
  assert.deepEqual(flat.down, base);
  // tilt clamped to [-1,1]
  assert.ok(Math.abs(newsScenario(base, sigmaDaily, 5).upShift - 2 * volH) < 1e-9);
});
