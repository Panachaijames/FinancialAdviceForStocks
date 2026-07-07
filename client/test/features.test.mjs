// Unit tests for the analytics/feature libs: tax report, benchmark math,
// rebalance math, alert evaluation, CSV import.
// Run with:  npm test   (node --test client/test/)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaxReport, sellYears, TAX_TREATMENT } from '../src/lib/taxReport.js';
import { alignSeries, indexTo100, blendIndexed, totalReturnPct } from '../src/lib/benchmark.js';
import { computeRebalance } from '../src/lib/rebalance.js';
import { evaluateAlert, describeAlert } from '../src/lib/alerts.js';
import { parseCsv, parseTradesCsv } from '../src/lib/csvImport.js';

// ── taxReport ───────────────────────────────────────────────────────────────

const LEDGER = [
  { side: 'buy', symbol: 'AAPL', type: 'us_stock', currency: 'USD', at: '2026-01-05T00:00:00Z' },
  { side: 'sell', symbol: 'AAPL', type: 'us_stock', currency: 'USD', realized: 500, at: '2026-02-01T00:00:00Z' },
  { side: 'sell', symbol: 'PTT.BK', type: 'th_stock', currency: 'THB', realized: -1200, at: '2026-03-15T00:00:00Z' },
  { side: 'sell', symbol: 'BTC-USD', currency: 'USD', realized: 90, at: '2025-11-30T00:00:00Z' }, // no type -> classified
];

test('sellYears: distinct years with sells, newest first', () => {
  assert.deepEqual(sellYears(LEDGER), [2026, 2025]);
});

test('buildTaxReport groups sells by asset class with treatments attached', () => {
  const r = buildTaxReport(LEDGER, 2026);
  assert.equal(r.sellCount, 2);
  const byType = Object.fromEntries(r.groups.map((g) => [g.type, g]));
  assert.equal(byType.us_stock.byCurrency.USD, 500);
  assert.equal(byType.th_stock.byCurrency.THB, -1200);
  assert.equal(byType.th_stock.treatment.taxable, 'no'); // SET exempt
  assert.equal(byType.us_stock.treatment.taxable, 'conditional'); // remittance rule
});

test('buildTaxReport classifies entries that predate the type field', () => {
  const r = buildTaxReport(LEDGER, 2025);
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].type, 'crypto'); // BTC-USD classified by symbol
  assert.equal(TAX_TREATMENT.crypto.taxable, 'conditional');
});

// ── benchmark ───────────────────────────────────────────────────────────────

const DAY = 86400;
const mk = (startDay, closes) => closes.map((c, i) => ({ time: (startDay + i) * DAY, close: c }));

test('alignSeries keeps only common days across series', () => {
  const a = mk(100, [10, 11, 12, 13]); // days 100-103
  const b = mk(101, [20, 22, 24]); // days 101-103
  const { times, closes } = alignSeries({ A: a, B: b });
  assert.equal(times.length, 3); // days 101,102,103
  assert.deepEqual(closes.A, [11, 12, 13]);
  assert.deepEqual(closes.B, [20, 22, 24]);
});

test('indexTo100 and totalReturnPct', () => {
  const idx = indexTo100([50, 55, 60]);
  assert.equal(idx.length, 3);
  [100, 110, 120].forEach((exp, i) => assert.ok(Math.abs(idx[i] - exp) < 1e-9, `idx[${i}]`));
  assert.ok(Math.abs(totalReturnPct([100, 120]) - 20) < 1e-9);
});

test('blendIndexed weights normalized: 50/50 of +20% and 0% ends at 110', () => {
  const blended = blendIndexed({ A: [100, 120], B: [200, 200] }, { A: 500, B: 500 });
  assert.deepEqual(blended, [100, 110]);
});

test('blendIndexed ignores zero-weight and empty series', () => {
  const blended = blendIndexed({ A: [100, 150], B: [] }, { A: 100, B: 0 });
  assert.deepEqual(blended, [100, 150]);
});

// ── rebalance ───────────────────────────────────────────────────────────────

test('computeRebalance: drift and trade amounts restore the targets', () => {
  const { rows, total, targetSum, maxDrift } = computeRebalance(
    { us_stock: 700, th_stock: 300 },
    { us_stock: 50, th_stock: 50 }
  );
  assert.equal(total, 1000);
  assert.equal(targetSum, 100);
  const us = rows.find((r) => r.type === 'us_stock');
  const th = rows.find((r) => r.type === 'th_stock');
  assert.equal(us.currentPct, 70);
  assert.equal(us.amount, -200); // sell 200
  assert.equal(th.amount, 200); // buy 200
  assert.equal(maxDrift, 20);
  assert.equal(rows[0].type, 'us_stock'); // sorted by |drift|
});

test('computeRebalance includes targeted types the user does not hold yet', () => {
  const { rows } = computeRebalance({ us_stock: 1000 }, { us_stock: 80, gold: 20 });
  const gold = rows.find((r) => r.type === 'gold');
  assert.equal(gold.currentPct, 0);
  assert.equal(gold.amount, 200);
});

// ── alerts ──────────────────────────────────────────────────────────────────

test('evaluateAlert: above / below / move', () => {
  assert.equal(evaluateAlert({ kind: 'above', value: 100 }, { price: 101 }), true);
  assert.equal(evaluateAlert({ kind: 'above', value: 100 }, { price: 99 }), false);
  assert.equal(evaluateAlert({ kind: 'below', value: 90 }, { price: 89 }), true);
  assert.equal(evaluateAlert({ kind: 'below', value: 90 }, { price: 95 }), false);
  assert.equal(evaluateAlert({ kind: 'move', value: 5 }, { changePct: -6.2 }), true);
  assert.equal(evaluateAlert({ kind: 'move', value: 5 }, { changePct: 4.9 }), false);
});

test('evaluateAlert: disabled/triggered/invalid never fire', () => {
  assert.equal(evaluateAlert({ kind: 'above', value: 100, enabled: false }, { price: 200 }), false);
  assert.equal(evaluateAlert({ kind: 'above', value: 100, triggeredAt: 'x' }, { price: 200 }), false);
  assert.equal(evaluateAlert({ kind: 'above', value: NaN }, { price: 200 }), false);
  assert.equal(evaluateAlert({ kind: 'above', value: 100 }, null), false);
});

test('describeAlert renders each kind', () => {
  assert.equal(describeAlert({ kind: 'above', symbol: 'NVDA', value: 200 }), 'NVDA ≥ 200');
  assert.equal(describeAlert({ kind: 'move', symbol: 'AAPL', value: 5 }), 'AAPL moves ±5% in a day');
});

// ── csvImport ───────────────────────────────────────────────────────────────

test('parseCsv handles quoted fields with commas and escaped quotes', () => {
  const rows = parseCsv('a,"b,c","say ""hi"""\n1,2,3');
  assert.deepEqual(rows, [['a', 'b,c', 'say "hi"'], ['1', '2', '3']]);
});

test('parseTradesCsv maps synonym headers and sorts oldest first', () => {
  const csv = [
    'Trade Date,Action,Ticker,Shares,Unit Price,Commission',
    '2026-03-02,SELL,AAPL,5,180.50,1.2',
    '2026-01-15,Buy,AAPL,10,"1,500.00",',
  ].join('\n');
  const { trades, errors } = parseTradesCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(trades.length, 2);
  assert.equal(trades[0].side, 'buy'); // oldest first
  assert.equal(trades[0].price, 1500); // thousand separator stripped
  assert.equal(trades[0].fee, 0); // empty fee -> 0
  assert.equal(trades[1].side, 'sell');
  assert.equal(trades[1].fee, 1.2);
  assert.equal(trades[1].symbol, 'AAPL');
});

test('parseTradesCsv reports bad rows with line numbers and missing columns', () => {
  const bad = parseTradesCsv('Date,Side,Symbol,Qty,Price\n2026-01-01,hold,AAPL,10,100\nnot-a-date,buy,AAPL,10,100\n2026-01-02,buy,AAPL,-5,100');
  assert.equal(bad.trades.length, 0);
  assert.equal(bad.errors.length, 3);
  assert.match(bad.errors[0], /Line 2/);
  assert.match(bad.errors[1], /Line 3/);

  const missing = parseTradesCsv('Date,Symbol\n2026-01-01,AAPL');
  assert.match(missing.errors[0], /Missing column/);
});
