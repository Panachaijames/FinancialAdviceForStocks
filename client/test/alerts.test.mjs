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

test('reconcileFired keeps fired only for triggered alerts; re-arm clears it', () => {
  // a1 already triggered (client fired it), a2 active -> only a1 stays "fired"
  // (watcher skips it); a2 is watchable.
  const fired = reconcileFired({ a1: 111, a2: 222 }, [
    { id: 'a1', triggeredAt: '2026-07-15T00:00:00.000Z' },
    { id: 'a2' },
  ]);
  assert.ok(fired.a1, 'triggered alert keeps a fired flag');
  assert.equal(fired.a2, undefined, 're-armed/active alert has no fired flag');
  // a still-triggered alert preserves its prior timestamp (no re-fire churn)
  assert.equal(reconcileFired({ a1: 999 }, [{ id: 'a1', triggeredAt: '2026-07-15T00:00:00.000Z' }]).a1, 999);
  // a re-armed alert (was fired, now active) is cleared so it can fire again
  assert.deepEqual(reconcileFired({ a1: 999 }, [{ id: 'a1' }]), {});
});
