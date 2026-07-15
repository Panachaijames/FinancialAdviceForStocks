// Tests for the shared alert eval (via the client re-export) and the server-side
// store's fired-flag preservation (Quarter task 2 — closed-app alerts).
// Run with:  node --test client/test/alerts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlert, describeAlert } from '../src/lib/alerts.js';
import { reconcileFired } from '../../server/alerts/store.js';

test('evaluateAlert: above / below / move + guards', () => {
  assert.equal(evaluateAlert({ kind: 'above', value: 100 }, { price: 101 }), true);
  assert.equal(evaluateAlert({ kind: 'above', value: 100 }, { price: 99 }), false);
  assert.equal(evaluateAlert({ kind: 'below', value: 100 }, { price: 99 }), true);
  assert.equal(evaluateAlert({ kind: 'move', value: 5 }, { changePct: -6 }), true);
  assert.equal(evaluateAlert({ kind: 'move', value: 5 }, { changePct: 3 }), false);
  // guards
  assert.equal(evaluateAlert({ kind: 'above', value: 100, triggeredAt: 'x' }, { price: 200 }), false);
  assert.equal(evaluateAlert({ kind: 'above', value: 100, enabled: false }, { price: 200 }), false);
  assert.equal(evaluateAlert({ kind: 'above', value: 100 }, null), false);
});

test('describeAlert renders each kind', () => {
  assert.equal(describeAlert({ symbol: 'AAPL', kind: 'above', value: 250 }), 'AAPL ≥ 250');
  assert.equal(describeAlert({ symbol: 'AAPL', kind: 'below', value: 200 }), 'AAPL ≤ 200');
  assert.equal(describeAlert({ symbol: 'BTC-USD', kind: 'move', value: 5 }), 'BTC-USD moves ±5% in a day');
});

test('reconcileFired: fired flag survives a plain reopen but clears on re-arm', () => {
  // a1 fired in-app (triggeredAt) -> kept; a2 active, fired against arm 100 and
  // re-PUT with the SAME arm (a plain app reopen) -> kept, so no duplicate push.
  const fired = reconcileFired({ a1: 40, a2: 100 }, [
    { id: 'a1', armedAt: 40, triggeredAt: '2026-07-15T00:00:00.000Z' },
    { id: 'a2', armedAt: 100 },
  ]);
  assert.ok(fired.a1, 'triggered alert keeps a fired flag');
  assert.equal(fired.a2, 100, 'reopen with the same arm keeps the fired flag (no re-fire)');
  // Re-arm a2 (armedAt bumped past the fired arm) -> flag drops -> watchable again.
  assert.equal(reconcileFired({ a2: 100 }, [{ id: 'a2', armedAt: 200 }]).a2, undefined);
  // A fresh active alert with no prior fired flag stays watchable.
  assert.deepEqual(reconcileFired({}, [{ id: 'a3', armedAt: 300 }]), {});
});
