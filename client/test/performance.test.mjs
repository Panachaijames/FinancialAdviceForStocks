// Tests for the historical-performance ledger replay (Quarter task 1). Locks the
// day-by-day market value / net invested / realized math and the summarize()
// headline (Total P/L = market value − net invested).
// Run with:  node --test client/test/performance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPerformanceSeries, summarize } from '../src/lib/performance.js';

const DAY = 86400;
const D0 = 20000; // arbitrary UTC day numbers
const D1 = 20001;
const D2 = 20002;
const at = (day, hour = 1) => new Date(day * DAY * 1000 + hour * 3600 * 1000).toISOString();

test('replays buy → hold → sell into per-day value / invested / realized', () => {
  const closesBySymbol = {
    AAPL: [
      { time: D0 * DAY, close: 100 },
      { time: D1 * DAY, close: 110 },
      { time: D2 * DAY, close: 120 },
    ],
  };
  const transactions = [
    { symbol: 'AAPL', side: 'buy', qty: 10, price: 100, fee: 0, currency: 'USD', at: at(D0) },
    { symbol: 'AAPL', side: 'sell', qty: 5, price: 120, fee: 0, realized: 100, currency: 'USD', at: at(D2) },
  ];
  const r = buildPerformanceSeries({ transactions, closesBySymbol, currencyBySymbol: { AAPL: 'USD' } });
  assert.deepEqual(r.times, [D0 * DAY, D1 * DAY, D2 * DAY]);
  assert.deepEqual(r.marketValue, [1000, 1100, 600]); // 10·100, 10·110, 5·120
  assert.deepEqual(r.invested, [1000, 1000, 400]); // buy 1000; sell returns 600 -> net 400
  assert.deepEqual(r.realized, [0, 0, 100]); // realized banked on the sell day

  // Total P/L = 600 − 400 = 200 (held 5·120=600 + 600 cash out − 1000 in).
  const s = summarize(r);
  assert.equal(s.currentValue, 600);
  assert.equal(s.netInvested, 400);
  assert.equal(s.totalPL, 200);
  assert.equal(s.realized, 100);
  assert.equal(s.plPct, 50); // 200 / 400
});

test('carries prices forward across a gap day anchored by another symbol', () => {
  // AAPL trades all 3 days (so D1 is on the axis); BTC has no D1 bar -> it must
  // carry D0's price into D1. Only BTC is held, so market value is BTC-only.
  const closesBySymbol = {
    AAPL: [
      { time: D0 * DAY, close: 100 },
      { time: D1 * DAY, close: 110 },
      { time: D2 * DAY, close: 120 },
    ],
    BTC: [
      { time: D0 * DAY, close: 200 },
      { time: D2 * DAY, close: 400 }, // gap on D1
    ],
  };
  const transactions = [
    { symbol: 'BTC', side: 'buy', qty: 1, price: 200, fee: 0, currency: 'USD', at: at(D0) },
  ];
  const r = buildPerformanceSeries({ transactions, closesBySymbol, currencyBySymbol: { BTC: 'USD' } });
  assert.deepEqual(r.times, [D0 * DAY, D1 * DAY, D2 * DAY]);
  assert.deepEqual(r.marketValue, [200, 200, 400]); // D1 carried forward from D0; AAPL unheld -> 0
});

test('dividends add to realized only, never to market value or invested', () => {
  const closesBySymbol = { KO: [{ time: D0 * DAY, close: 50 }, { time: D1 * DAY, close: 50 }] };
  const transactions = [
    { symbol: 'KO', side: 'buy', qty: 10, price: 50, fee: 0, currency: 'USD', at: at(D0) },
    { symbol: 'KO', side: 'dividend', amount: 12, wht: 2, currency: 'USD', at: at(D1) },
  ];
  const r = buildPerformanceSeries({ transactions, closesBySymbol, currencyBySymbol: { KO: 'USD' } });
  assert.deepEqual(r.marketValue, [500, 500]);
  assert.deepEqual(r.invested, [500, 500]);
  assert.deepEqual(r.realized, [0, 10]); // 12 − 2 withholding
});

test('applies fx conversion to both cash flows and market value', () => {
  const closesBySymbol = { 'PTT.BK': [{ time: D0 * DAY, close: 40 }] };
  const transactions = [
    { symbol: 'PTT.BK', side: 'buy', qty: 100, price: 40, fee: 0, currency: 'THB', at: at(D0) },
  ];
  // convert THB->USD at 0.03; USD passthrough
  const convert = (v, cur) => (cur === 'THB' ? v * 0.03 : v);
  const r = buildPerformanceSeries({ transactions, closesBySymbol, currencyBySymbol: { 'PTT.BK': 'THB' }, convert });
  assert.equal(r.marketValue[0], 100 * 40 * 0.03); // 120 USD
  assert.equal(r.invested[0], 100 * 40 * 0.03);
});

test('empty inputs are safe', () => {
  assert.deepEqual(buildPerformanceSeries({}), { times: [], marketValue: [], invested: [], realized: [] });
  assert.deepEqual(summarize({}), { currentValue: 0, netInvested: 0, realized: 0, totalPL: 0, plPct: null });
});
