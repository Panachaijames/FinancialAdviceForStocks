// Tests for Thai gold (บาททอง) unit math. Run: node --test client/test/gold.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OZ_PER_BAHT, bahtToOz, ozToBaht, bahtPriceThb, thbPerBahtToUsdPerOz } from '../src/lib/gold.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('OZ_PER_BAHT matches the 15.244g @ 96.5% / troy-oz definition', () => {
  assert.ok(near(OZ_PER_BAHT, (15.244 / 31.1035) * 0.965));
  assert.ok(OZ_PER_BAHT > 0.472 && OZ_PER_BAHT < 0.473); // ≈ 0.47289
});

test('bahtToOz / ozToBaht round-trip', () => {
  assert.ok(near(bahtToOz(1), OZ_PER_BAHT));
  assert.ok(near(ozToBaht(bahtToOz(3.5)), 3.5));
  assert.equal(bahtToOz('x'), 0); // non-finite guard
  assert.equal(ozToBaht(NaN), 0);
});

test('bahtPriceThb: shop price = XAU × FX × ozPerBaht', () => {
  // XAU $2400/oz, 34 THB/USD → one baht ≈ 2400·34·0.47289 ≈ 38,588 THB
  const p = bahtPriceThb(2400, 34);
  assert.ok(near(p, 2400 * 34 * OZ_PER_BAHT));
  assert.ok(p > 38000 && p < 39000);
  assert.equal(bahtPriceThb(0, 34), 0); // bad inputs
  assert.equal(bahtPriceThb(2400, 0), 0);
});

test('thbPerBahtToUsdPerOz is the exact inverse of bahtPriceThb', () => {
  const rate = 33.5;
  const usdPerOz = 2350;
  const thbPerBaht = bahtPriceThb(usdPerOz, rate);
  assert.ok(near(thbPerBahtToUsdPerOz(thbPerBaht, rate), usdPerOz, 1e-6));
  assert.equal(thbPerBahtToUsdPerOz(0, rate), 0);
});
