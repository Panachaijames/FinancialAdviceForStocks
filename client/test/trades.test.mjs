// Unit tests for the trade-ledger math (average-cost basis).
// Run with:  npm test   (node --test client/test/)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBuy, applySell, realizedByCurrency, realizedBySymbol } from '../src/lib/trades.js';

// ── applyBuy ────────────────────────────────────────────────────────────────

test('buy into an empty position sets shares and avg cost (fee raises basis)', () => {
  const r = applyBuy({ shares: 0, avgCost: 0 }, { qty: 10, price: 100, fee: 20 });
  assert.equal(r.shares, 10);
  // (10×100 + 20) / 10 = 102
  assert.equal(r.avgCost, 102);
});

test('buy blends into the existing average cost', () => {
  // 10 @ 100 held; buy 10 @ 200 -> 20 @ 150
  const r = applyBuy({ shares: 10, avgCost: 100 }, { qty: 10, price: 200 });
  assert.equal(r.shares, 20);
  assert.equal(r.avgCost, 150);
});

test('buy with zero/invalid qty is a no-op', () => {
  const pos = { shares: 5, avgCost: 80 };
  assert.deepEqual(applyBuy(pos, { qty: 0, price: 100 }), { shares: 5, avgCost: 80 });
  assert.deepEqual(applyBuy(pos, { qty: -3, price: 100 }), { shares: 5, avgCost: 80 });
  assert.deepEqual(applyBuy(pos, { qty: 'abc', price: 100 }), { shares: 5, avgCost: 80 });
});

// ── applySell ───────────────────────────────────────────────────────────────

test('sell realizes P/L against avg cost; average is unchanged', () => {
  // 20 @ 150; sell 5 @ 180 with 10 fee -> realized (180-150)×5 − 10 = 140
  const r = applySell({ shares: 20, avgCost: 150 }, { qty: 5, price: 180, fee: 10 });
  assert.equal(r.shares, 15);
  assert.equal(r.avgCost, 150);
  assert.equal(r.soldQty, 5);
  assert.equal(r.realized, 140);
  assert.equal(r.costBasis, 150);
});

test('sell at a loss produces negative realized P/L', () => {
  const r = applySell({ shares: 10, avgCost: 100 }, { qty: 4, price: 90 });
  assert.equal(r.realized, -40);
});

test('sell is clamped to the shares held', () => {
  const r = applySell({ shares: 3, avgCost: 100 }, { qty: 10, price: 120 });
  assert.equal(r.soldQty, 3);
  assert.equal(r.shares, 0);
  assert.equal(r.realized, 60); // (120-100)×3
});

test('sell from an empty position is a no-op', () => {
  const r = applySell({ shares: 0, avgCost: 0 }, { qty: 5, price: 100 });
  assert.equal(r.soldQty, 0);
  assert.equal(r.realized, 0);
});

test('round-trip: buy → sell everything realizes exactly the price difference minus fees', () => {
  let pos = applyBuy({ shares: 0, avgCost: 0 }, { qty: 100, price: 10, fee: 5 }); // avg 10.05
  const sale = applySell(pos, { qty: 100, price: 12, fee: 5 });
  // (12 − 10.05)×100 − 5 = 190 == total proceeds 1195 − total cost 1005
  assert.ok(Math.abs(sale.realized - 190) < 1e-9);
  assert.equal(sale.shares, 0);
});

// ── aggregation ─────────────────────────────────────────────────────────────

test('realizedByCurrency sums sells per currency and ignores buys/garbage', () => {
  const txs = [
    { side: 'buy', symbol: 'AAPL', currency: 'USD' },
    { side: 'sell', symbol: 'AAPL', currency: 'USD', realized: 100 },
    { side: 'sell', symbol: 'NVDA', currency: 'USD', realized: -30 },
    { side: 'sell', symbol: 'PTT.BK', currency: 'THB', realized: 500 },
    { side: 'sell', symbol: 'X', currency: 'USD', realized: 'bad' },
    null,
  ];
  assert.deepEqual(realizedByCurrency(txs), { USD: 70, THB: 500 });
});

test('realizedBySymbol groups by symbol with native currency', () => {
  const txs = [
    { side: 'sell', symbol: 'AAPL', currency: 'USD', realized: 100 },
    { side: 'sell', symbol: 'AAPL', currency: 'USD', realized: 50 },
    { side: 'sell', symbol: 'PTT.BK', currency: 'THB', realized: -200 },
  ];
  assert.deepEqual(realizedBySymbol(txs), {
    AAPL: { realized: 150, currency: 'USD' },
    'PTT.BK': { realized: -200, currency: 'THB' },
  });
});
