// Tests for the server TTL cache — the subtle rules (empty-result no-cache,
// opt-in negative caching, concurrent de-dupe, sweep + hard cap) regress
// silently as blank prices or a leaking dyno. Run: node --test server/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, set, wrap, clear, size, sweep } from '../cache.js';

test('set/get: returns fresh value, undefined once expired', () => {
  clear();
  set('k', 42, 10_000);
  assert.equal(get('k'), 42);
  // ttl <= 0 expires immediately (expires === now, and get checks <= now).
  set('k2', 7, 0);
  assert.equal(get('k2'), undefined);
  assert.equal(get('missing'), undefined);
});

test('wrap: de-dupes concurrent calls to one asyncFn run', async () => {
  clear();
  let calls = 0;
  const fn = async () => {
    calls += 1;
    return ['v'];
  };
  const [a, b] = await Promise.all([wrap('key', 10_000, fn), wrap('key', 10_000, fn)]);
  assert.deepEqual(a, ['v']);
  assert.deepEqual(b, ['v']);
  assert.equal(calls, 1); // second concurrent call shared the inflight promise
});

test('wrap: empty result is NOT cached by default (retries)', async () => {
  clear();
  let calls = 0;
  const fn = async () => {
    calls += 1;
    return [];
  };
  await wrap('empty', 10_000, fn);
  await wrap('empty', 10_000, fn); // sequential — inflight already cleared
  assert.equal(calls, 2); // not pinned, so it retried
  assert.equal(get('empty'), undefined);
});

test('wrap: emptyTtlMs caches an empty result briefly', async () => {
  clear();
  let calls = 0;
  const fn = async () => {
    calls += 1;
    return [];
  };
  await wrap('e2', 10_000, fn, { emptyTtlMs: 10_000 });
  await wrap('e2', 10_000, fn, { emptyTtlMs: 10_000 });
  assert.equal(calls, 1); // negative-cached, so the 2nd call was served from cache
  assert.deepEqual(get('e2'), []);
});

test('sweep: drops expired entries and hard-caps size', () => {
  clear();
  set('fresh', 1, 10_000);
  set('stale', 1, 0); // already expired
  const removed = sweep();
  assert.ok(removed >= 1);
  assert.equal(get('fresh'), 1);
  assert.equal(get('stale'), undefined);

  // Hard cap at 1000: over-fill then sweep back down.
  clear();
  for (let i = 0; i < 1050; i += 1) set(`k${i}`, i, 10_000);
  sweep();
  assert.ok(size() <= 1000, `expected <= 1000, got ${size()}`);
});
