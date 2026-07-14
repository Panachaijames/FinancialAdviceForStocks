// Unit tests for isChunkLoadError — the stale-chunk detector behind the
// Forecast tab's error boundary. Run with: node --test client/test/chunkError.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChunkLoadError } from '../src/lib/chunkError.js';

test('detects Vite/browser dynamic-import failures', () => {
  const positives = [
    Object.assign(new Error('Loading chunk 42 failed'), { name: 'ChunkLoadError' }),
    new Error('Loading CSS chunk forecast-a1b2c3 failed'),
    new Error('Failed to fetch dynamically imported module: https://x/assets/ForecastView-abc123.js'),
    new Error('error loading dynamically imported module'),
    new Error('Importing a module script failed.'),
  ];
  for (const e of positives) {
    assert.equal(isChunkLoadError(e), true, `expected true for: ${e.message}`);
  }
});

test('name alone identifies a ChunkLoadError even with an odd message', () => {
  assert.equal(isChunkLoadError(Object.assign(new Error('boom'), { name: 'ChunkLoadError' })), true);
});

test('ordinary render errors are not chunk errors', () => {
  const negatives = [
    new Error("Cannot read properties of undefined (reading 'map')"),
    new TypeError('x is not a function'),
    new Error('Network request failed'),
    'some string',
    null,
    undefined,
    {},
  ];
  for (const e of negatives) {
    assert.equal(isChunkLoadError(e), false, `expected false for: ${String(e && e.message ? e.message : e)}`);
  }
});
