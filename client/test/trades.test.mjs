// Unit tests for the trade-ledger math (average-cost basis).
// Run with:  npm test   (node --test client/test/)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBuy, applySell, realizedByCurrency, realizedBySymbol, sharesToReachAvg } from '../src/lib/trades.js';

// ── sharesToReachAvg (what-if / average-down inverse solve) ──────────────────

test('sharesToReachAvg: buying below the average pulls it down to a reachable target', () => {
  // hold 10 @ 100, buy @ 80, want avg 90 -> buy 10 (verified: (10·100+10·80)/20 = 90)
  const q = sharesToReachAvg(10, 100, 80, 90);
  assert.ok(Math.abs(q - 10) < 1e-9);
  const after = applyBuy({ shares: 10, avgCost: 100 }, { qty: q, price: 80, fee: 0 });
  assert.ok(Math.abs(after.avgCost - 90) < 1e-9); // round-trips through applyBuy

  // averaging UP works too: hold 10 @ 100, buy @ 130, want avg 110 -> buy 5
  assert.ok(Math.abs(sharesToReachAvg(10, 100, 130, 110) - 5) < 1e-9);
});

test('sharesToReachAvg: folds the fee into the basis (inverse of applyBuy with fee)', () => {
  // hold 10 @ 100, buy @ 80 with a 50 fee, want avg 90 -> buy 15 (not 10)
  const q = sharesToReachAvg(10, 100, 80, 90, 50);
  assert.ok(Math.abs(q - 15) < 1e-9);
  const after = applyBuy({ shares: 10, avgCost: 100 }, { qty: q, price: 80, fee: 50 });
  assert.ok(Math.abs(after.avgCost - 90) < 1e-9); // round-trips through applyBuy with fee
});

test('sharesToReachAvg: null when unreachable or inputs invalid', () => {
  assert.equal(sharesToReachAvg(10, 100, 80, 70), null); // target below the buy price — impossible
  assert.equal(sharesToReachAvg(10, 100, 120, 90), null); // buying up can't lower the avg
  assert.equal(sharesToReachAvg(10, 100, 90, 90), null); // target == price
  assert.equal(sharesToReachAvg(0, 100, 80, 90), null); // no position
  assert.equal(sharesToReachAvg(10, 100, 0, 90), null); // bad price
});

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

// ── replayPosition (backdate / edit / delete) ────────────────────────────────

import { replayPosition } from '../src/lib/trades.js';

test('replayPosition: chronological replay recomputes avg cost regardless of entry order', () => {
  // Entered out of order: the 200-priced buy recorded first but dated LATER.
  const txs = [
    { id: 't2', side: 'buy', qty: 10, price: 200, fee: 0, at: '2026-03-01T12:00:00.000Z' },
    { id: 't1', side: 'buy', qty: 10, price: 100, fee: 0, at: '2026-01-01T12:00:00.000Z' },
  ];
  const r = replayPosition(txs);
  assert.equal(r.shares, 20);
  assert.equal(r.avgCost, 150); // (10·100 + 10·200)/20 — order-independent blend
  assert.equal(r.transactions[0].id, 't1'); // sorted chronologically
});

test('replayPosition: backdated sell realizes against the avg cost held at its date', () => {
  const txs = [
    { id: 'b1', side: 'buy', qty: 10, price: 100, fee: 0, at: '2026-01-01T12:00:00.000Z' },
    { id: 's1', side: 'sell', qty: 4, price: 130, fee: 0, at: '2026-02-01T12:00:00.000Z' },
  ];
  const r = replayPosition(txs);
  assert.equal(r.shares, 6);
  const sell = r.transactions.find((t) => t.id === 's1');
  assert.equal(sell.realized, 120); // (130−100)·4
  assert.equal(sell.prevShares, 10);
});

test('replayPosition: a sell is clamped to shares held at that time', () => {
  const txs = [
    { id: 'b1', side: 'buy', qty: 5, price: 100, fee: 0, at: '2026-01-01T12:00:00.000Z' },
    { id: 's1', side: 'sell', qty: 10, price: 120, fee: 0, at: '2026-02-01T12:00:00.000Z' },
  ];
  const r = replayPosition(txs);
  const sell = r.transactions.find((t) => t.id === 's1');
  assert.equal(sell.qty, 5); // clamped
  assert.equal(r.shares, 0);
});

test('replayPosition: dividends pass through and do not affect the position', () => {
  const txs = [
    { id: 'b1', side: 'buy', qty: 10, price: 100, fee: 0, at: '2026-01-01T12:00:00.000Z' },
    { id: 'd1', side: 'dividend', amount: 20, wht: 2, at: '2026-02-01T12:00:00.000Z' },
  ];
  const r = replayPosition(txs);
  assert.equal(r.shares, 10);
  assert.equal(r.avgCost, 100);
  assert.ok(r.transactions.find((t) => t.id === 'd1'));
});
