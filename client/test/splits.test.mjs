// Tests for stock-split detection + ledger-replay handling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayPosition } from '../src/lib/trades.js';
import { pendingSplits, applySplitToPosition, appliedSplitDays, splitLabel } from '../src/lib/splits.js';

test('replayPosition: a split multiplies shares and divides avg cost, cost basis unchanged', () => {
  const txs = [
    { id: 'b1', symbol: 'NVDA', side: 'buy', qty: 10, price: 1000, fee: 0, at: '2024-01-01T00:00:00Z' },
    { id: 's1', symbol: 'NVDA', side: 'split', ratio: 10, numerator: 10, denominator: 1, at: '2024-06-10T00:00:00Z' },
  ];
  const r = replayPosition(txs);
  assert.ok(Math.abs(r.shares - 100) < 1e-9); // 10 × 10
  assert.ok(Math.abs(r.avgCost - 100) < 1e-9); // 1000 ÷ 10
  // total cost basis preserved: 10×1000 == 100×100
  assert.ok(Math.abs(r.shares * r.avgCost - 10 * 1000) < 1e-6);
});

test('replayPosition: split composes chronologically with a later buy', () => {
  const txs = [
    { id: 'b1', symbol: 'X', side: 'buy', qty: 10, price: 1000, at: '2024-01-01T00:00:00Z' },
    { id: 's1', symbol: 'X', side: 'split', ratio: 4, at: '2024-06-01T00:00:00Z' },
    { id: 'b2', symbol: 'X', side: 'buy', qty: 10, price: 260, at: '2024-07-01T00:00:00Z' }, // post-split price
  ];
  const r = replayPosition(txs);
  // after split: 40 sh @ 250; then +10 @ 260 -> 50 sh, avg (40*250+10*260)/50 = 252
  assert.ok(Math.abs(r.shares - 50) < 1e-9);
  assert.ok(Math.abs(r.avgCost - 252) < 1e-9);
});

test('applySplitToPosition: ×ratio shares, ÷ratio cost', () => {
  assert.deepEqual(applySplitToPosition(5, 200, 2), { shares: 10, avgCost: 100 });
  assert.deepEqual(applySplitToPosition(5, 200, 0), { shares: 5, avgCost: 200 }); // guard: ratio 0 -> no-op
});

test('pendingSplits: only real, post-tracking, not-yet-applied splits', () => {
  const holding = { symbol: 'NVDA', addedAt: '2024-03-01T00:00:00Z' };
  const splits = [
    { date: '2021-07-20T00:00:00Z', ratio: 4 }, // predates tracking -> ignored
    { date: '2024-06-10T00:00:00Z', ratio: 10 }, // pending
    { date: '2025-01-01T00:00:00Z', ratio: 1 }, // ratio 1 -> ignored
  ];
  const txs = [];
  const pend = pendingSplits(splits, txs, holding);
  assert.equal(pend.length, 1);
  assert.equal(pend[0].date, '2024-06-10T00:00:00Z');

  // once a split ledger entry exists for that day, it's no longer pending
  const applied = [{ symbol: 'NVDA', side: 'split', at: '2024-06-10T09:30:00Z', ratio: 10 }];
  assert.equal(pendingSplits(splits, applied, holding).length, 0);
  assert.deepEqual([...appliedSplitDays(applied, 'NVDA')], ['2024-06-10']);
});

test('splitLabel: N-for-M', () => {
  assert.equal(splitLabel({ numerator: 10, denominator: 1 }), '10-for-1');
  assert.equal(splitLabel({ text: '3:2' }), '3:2');
});
