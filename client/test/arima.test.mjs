// Unit tests for the ARIMA(p,1,q) forecaster (Hannan–Rissanen two-stage OLS).
// Run with:  node --test client/test/arima.test.mjs
// All randomness is seeded (mulberry32) so runs are fully deterministic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitArima, forecastArima } from '../src/lib/forecast/arima.js';

// ── seeded PRNG helpers ─────────────────────────────────────────────────────

/** mulberry32: tiny seeded PRNG returning uniforms in [0, 1). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard-normal sampler (Box–Muller) driven by a seeded uniform PRNG. */
function makeGauss(seed) {
  const rand = mulberry32(seed);
  return function () {
    let u = 0;
    while (u === 0) u = rand(); // avoid log(0)
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/** Cumulative-sum log prices starting at 0 from a return series. */
function pricesFromReturns(returns) {
  const prices = [0];
  let level = 0;
  for (const r of returns) {
    level += r;
    prices.push(level);
  }
  return prices;
}

/** Simulate AR(1) returns r_t = c + phi·r_(t-1) + sigma·eps_t. */
function simulateAr1({ n, phi, sigma, c = 0, seed }) {
  const gauss = makeGauss(seed);
  const returns = new Array(n);
  let prev = 0;
  for (let t = 0; t < n; t++) {
    prev = c + phi * prev + sigma * gauss();
    returns[t] = prev;
  }
  return returns;
}

// ── tests ───────────────────────────────────────────────────────────────────

test('recovers the AR(1) coefficient from simulated data', () => {
  const returns = simulateAr1({ n: 2000, phi: 0.6, sigma: 0.01, seed: 42 });
  const model = fitArima(pricesFromReturns(returns), { p: 1, q: 0 });
  assert.ok(
    Math.abs(model.phi[0] - 0.6) <= 0.07,
    `phi[0] = ${model.phi[0]} not within 0.6 ± 0.07`,
  );
});

test('white noise yields a near-zero AR(1) coefficient', () => {
  const gauss = makeGauss(1234);
  const returns = Array.from({ length: 2000 }, () => 0.01 * gauss());
  const model = fitArima(pricesFromReturns(returns), { p: 1, q: 0 });
  assert.ok(
    Math.abs(model.phi[0]) < 0.07,
    `|phi[0]| = ${Math.abs(model.phi[0])} not < 0.07`,
  );
});

test('drift is carried into the forecast mean', () => {
  const gauss = makeGauss(777);
  const returns = Array.from({ length: 2000 }, () => 0.001 + 0.005 * gauss());
  const logPrices = pricesFromReturns(returns);
  const model = fitArima(logPrices, { p: 1, q: 0 });
  const { mean } = forecastArima(model, logPrices, 20);
  const last = logPrices[logPrices.length - 1];
  const expected = last + 20 * 0.001;
  assert.ok(
    Math.abs(mean[19] - expected) <= 0.005,
    `mean at h=20 = ${mean[19]}, expected ~${expected} (±0.005)`,
  );
});

test('95% band width is nondecreasing in the horizon', () => {
  const returns = simulateAr1({ n: 2000, phi: 0.4, sigma: 0.01, seed: 99 });
  const logPrices = pricesFromReturns(returns);
  const model = fitArima(logPrices, { p: 1, q: 0 });
  const { lower95, upper95 } = forecastArima(model, logPrices, 30);
  for (let h = 1; h < 30; h++) {
    const prev = upper95[h - 1] - lower95[h - 1];
    const cur = upper95[h] - lower95[h];
    assert.ok(cur >= prev, `band width shrank at h=${h + 1}: ${cur} < ${prev}`);
  }
});

test('fit and forecast are deterministic for identical inputs', () => {
  const returns = simulateAr1({ n: 500, phi: 0.3, sigma: 0.01, seed: 7 });
  const logPrices = pricesFromReturns(returns);
  const a = fitArima(logPrices, { p: 2, q: 1 });
  const b = fitArima(logPrices, { p: 2, q: 1 });
  assert.deepEqual(a.phi, b.phi);
  assert.deepEqual(a.theta, b.theta);
  assert.equal(a.sigma, b.sigma);
  const fa = forecastArima(a, logPrices, 15);
  const fb = forecastArima(b, logPrices, 15);
  assert.deepEqual(fa.mean, fb.mean);
  assert.deepEqual(fa.lower95, fb.lower95);
  assert.deepEqual(fa.upper95, fb.upper95);
});

test('throws the exact error on short input', () => {
  const gauss = makeGauss(5);
  // 60 prices -> 59 differences (< 60) -> must throw.
  const short = pricesFromReturns(Array.from({ length: 59 }, () => 0.01 * gauss()));
  assert.equal(short.length, 60);
  assert.throws(() => fitArima(short), { message: 'Need at least 60 data points' });
});

test('psi weights: AR(1) phi=0.5 gives var(2)/var(1) = 1 + 1.5^2', () => {
  // Hand-built model: intercept 0 so the mean path is flat; only the band
  // growth (psi-weight variance accumulation) is under test.
  const model = {
    p: 1,
    q: 0,
    phi: [0.5],
    theta: [],
    intercept: 0,
    sigma: 0.01,
    residuals: [],
    n: 100,
  };
  const gauss = makeGauss(11);
  const logPrices = pricesFromReturns(Array.from({ length: 100 }, () => 0.01 * gauss()));
  const { lower95, upper95 } = forecastArima(model, logPrices, 2);
  const w1 = upper95[0] - lower95[0];
  const w2 = upper95[1] - lower95[1];
  // width(h) ∝ sqrt(var(h)), so (w2/w1)^2 = var(2)/var(1).
  const ratio = (w2 / w1) ** 2;
  assert.ok(
    Math.abs(ratio - (1 + 1.5 ** 2)) < 1e-9,
    `var(2)/var(1) = ${ratio}, expected ${1 + 1.5 ** 2}`,
  );
});
