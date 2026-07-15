// Regression tests for the shared asset-type logic (shared/assetType.js), asserted
// through the CLIENT surface (client/src/lib/assetType.js re-exports it). These
// lock the bugs that the client/server drift used to cause. Run with:
//   node --test client/test/assetTypeShared.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify,
  isCrypto,
  toBinanceSymbol,
  fromBinanceSymbol,
  normalizeInput,
  assetMeta,
} from '../src/lib/assetType.js';

test('normalizeInput: "dot" resolves to the crypto pair, not a bogus DOT stock', () => {
  assert.equal(normalizeInput('dot'), 'DOT-USD'); // the live bug
  assert.equal(normalizeInput('polkadot'), 'DOT-USD');
  assert.equal(classify(normalizeInput('dot')), 'crypto');
  assert.equal(normalizeInput('AAPL'), 'AAPL'); // plain ticker still a plain ticker
  assert.equal(normalizeInput('ethereum'), 'ETH-USD');
});

test('classify: fiat -USD pairs are NOT crypto', () => {
  assert.equal(classify('BTC-USD'), 'crypto');
  assert.notEqual(classify('HKD-USD'), 'crypto'); // was misclassified as crypto
  assert.notEqual(classify('SGD-USD'), 'crypto');
  assert.notEqual(classify('EUR-USD'), 'crypto');
  assert.equal(classify('USDTHB=X'), 'other'); // FX pair, not a holding type
  assert.equal(classify('GC=F'), 'gold');
  assert.equal(classify('PTT.BK'), 'th_stock');
  assert.equal(classify('^GSPC'), 'index');
});

test('toBinanceSymbol: only crypto maps; non-crypto -> ""', () => {
  assert.equal(toBinanceSymbol('BTC-USD'), 'btcusdt');
  assert.equal(toBinanceSymbol('AAPL'), ''); // was 'aaplusdt' on the client
  assert.equal(toBinanceSymbol('PTT.BK'), '');
  assert.equal(fromBinanceSymbol('btcusdt'), 'BTC-USD');
});

test('isCrypto agrees with classify', () => {
  assert.equal(isCrypto('BTC-USD'), true);
  assert.equal(isCrypto('AAPL'), false);
  assert.equal(isCrypto('HKD-USD'), false);
});

test('assetMeta (client-only UI) still works via the wrapper', () => {
  assert.equal(assetMeta('crypto').label, 'Crypto');
  assert.equal(assetMeta('nonsense').label, 'Other');
  assert.ok(assetMeta('us_stock').emoji);
});
