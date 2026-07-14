// Unit tests for the 0.5 backup/restore + CSV-export cores:
//   - tradesToCsv round-trips through parseTradesCsv (import/export are inverses)
//   - parseBackup accepts our envelope + a bare snapshot, rejects junk
//   - createSafeStorage quarantines corrupt JSON and keeps a one-deep .bak
// Run with: node --test client/test/backupCsv.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTradesCsv, tradesToCsv } from '../src/lib/csvImport.js';
import { parseBackup, serializeBackup, backupFilename } from '../src/lib/backup.js';
import { createSafeStorage } from '../src/lib/safeStorage.js';

test('tradesToCsv round-trips through parseTradesCsv (sorted oldest-first)', () => {
  const txs = [
    { at: '2026-01-02T00:00:00.000Z', side: 'buy', symbol: 'AAPL', qty: 10, price: 150, fee: 1 },
    { at: '2026-02-03T00:00:00.000Z', side: 'sell', symbol: 'AAPL', qty: 4, price: 170, fee: 0.5 },
    { at: '2026-01-15T00:00:00.000Z', side: 'buy', symbol: 'VOO', qty: 2, price: 400, fee: 0 },
  ];
  const { trades, errors } = parseTradesCsv(tradesToCsv(txs));
  assert.deepEqual(errors, []);
  assert.equal(trades.length, 3);
  assert.equal(trades[0].symbol, 'AAPL'); // 2026-01-02
  assert.equal(trades[0].qty, 10);
  assert.equal(trades[1].symbol, 'VOO'); // 2026-01-15
  assert.equal(trades[2].side, 'sell'); // 2026-02-03
  assert.equal(trades[2].price, 170);
});

test('tradesToCsv skips non-buy/sell rows and preserves dotted tickers', () => {
  const csv = tradesToCsv([
    { at: '2026-01-01T00:00:00Z', side: 'buy', symbol: 'BRK.B', qty: 1, price: 1, fee: 0 },
    { at: '2026-01-01T00:00:00Z', side: 'dividend', symbol: 'X', qty: 0, price: 0 }, // skipped
    null,
  ]);
  const { trades } = parseTradesCsv(csv);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].symbol, 'BRK.B');
});

test('parseBackup accepts the envelope and a bare snapshot, rejects junk', () => {
  const snap = { holdings: [{ symbol: 'AAPL' }], transactions: [] };
  const wrapped = serializeBackup(snap, '2026-07-14T00:00:00.000Z');
  assert.deepEqual(parseBackup(wrapped).holdings, snap.holdings);
  assert.deepEqual(parseBackup(JSON.stringify(snap)).holdings, snap.holdings);
  assert.throws(() => parseBackup('not json'), /valid JSON/);
  assert.throws(() => parseBackup(JSON.stringify({ foo: 1 })), /PT backup/);
  assert.throws(() => parseBackup(JSON.stringify([1, 2, 3])), /PT backup/);
});

test('backupFilename pads month/day', () => {
  assert.equal(backupFilename(new Date('2026-07-04T12:00:00Z')), 'pt-backup-2026-07-04.json');
});

function fakeStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

test('safeStorage quarantines corrupt JSON to .corrupt and clears the main key', () => {
  const backend = fakeStore();
  backend.setItem('pt-portfolio', '{bad json');
  const s = createSafeStorage(backend);
  assert.equal(s.getItem('pt-portfolio'), null);
  assert.equal(backend.getItem('pt-portfolio.corrupt'), '{bad json');
  assert.equal(backend.getItem('pt-portfolio'), null);
});

test('safeStorage passes valid JSON through and keeps a one-deep .bak on overwrite', () => {
  const backend = fakeStore();
  const s = createSafeStorage(backend);
  s.setItem('pt-portfolio', '{"a":1}');
  assert.equal(s.getItem('pt-portfolio'), '{"a":1}');
  assert.equal(backend.getItem('pt-portfolio.bak'), null); // nothing to back up yet
  s.setItem('pt-portfolio', '{"a":2}');
  assert.equal(backend.getItem('pt-portfolio.bak'), '{"a":1}'); // previous value preserved
  assert.equal(s.getItem('pt-portfolio'), '{"a":2}');
});
