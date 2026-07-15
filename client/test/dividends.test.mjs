// Tests for dividend-ledger support (task 1.3): the net/aggregation helpers in
// lib/trades.js and the per-year dividend section in lib/taxReport.js. These lock
// two invariants: (1) dividends never leak into the capital-gains realized-P/L
// helpers, and (2) withholding is clamped to the gross and netted correctly.
// Run with:  node --test client/test/dividends.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dividendNet,
  dividendsByCurrency,
  dividendsBySymbol,
  realizedByCurrency,
  realizedBySymbol,
} from '../src/lib/trades.js';
import {
  dividendYears,
  taxYears,
  sellYears,
  buildDividendReport,
  buildTaxReport,
} from '../src/lib/taxReport.js';

const DIVS = [
  { side: 'dividend', symbol: 'AAPL', type: 'us_stock', currency: 'USD', amount: 100, wht: 15, at: '2026-03-01T12:00:00.000Z' },
  { side: 'dividend', symbol: 'AAPL', type: 'us_stock', currency: 'USD', amount: 100, wht: 15, at: '2026-06-01T12:00:00.000Z' },
  { side: 'dividend', symbol: 'PTT.BK', type: 'th_stock', currency: 'THB', amount: 500, wht: 50, at: '2026-05-01T12:00:00.000Z' },
  { side: 'dividend', symbol: 'KO', type: 'us_stock', currency: 'USD', amount: 40, at: '2025-12-01T12:00:00.000Z' }, // no wht
  { side: 'sell', symbol: 'AAPL', type: 'us_stock', currency: 'USD', realized: 200, at: '2026-04-01T12:00:00.000Z' },
  { side: 'buy', symbol: 'NVDA', currency: 'USD', at: '2026-01-01T12:00:00.000Z' },
];

test('dividendNet: amount − withholding, clamped, and rejects non-dividends', () => {
  assert.equal(dividendNet({ side: 'dividend', amount: 100, wht: 15 }), 85);
  assert.equal(dividendNet({ side: 'dividend', amount: 40 }), 40); // missing wht -> 0
  assert.equal(dividendNet({ side: 'dividend', amount: 50, wht: 80 }), 0); // wht clamped to gross
  assert.equal(dividendNet({ side: 'dividend', amount: 50, wht: -5 }), 50); // negative wht ignored
  assert.equal(dividendNet({ side: 'sell', amount: 100 }), null);
  assert.equal(dividendNet({ side: 'dividend', amount: 'x' }), null);
  assert.equal(dividendNet(null), null);
});

test('dividendsByCurrency: nets by currency, ignores sells/buys', () => {
  assert.deepEqual(dividendsByCurrency(DIVS), { USD: 85 + 85 + 40, THB: 450 });
});

test('dividendsBySymbol: nets per symbol with native currency', () => {
  assert.deepEqual(dividendsBySymbol(DIVS), {
    AAPL: { net: 170, currency: 'USD' },
    'PTT.BK': { net: 450, currency: 'THB' },
    KO: { net: 40, currency: 'USD' },
  });
});

test('dividends never leak into the capital-gains (sells) helpers', () => {
  // Only the one sell (realized 200) counts — dividends are excluded.
  assert.deepEqual(realizedByCurrency(DIVS), { USD: 200 });
  assert.deepEqual(realizedBySymbol(DIVS), { AAPL: { realized: 200, currency: 'USD' } });
});

test('year helpers: dividend years, and taxYears is the union with sells', () => {
  assert.deepEqual(dividendYears(DIVS), [2026, 2025]);
  assert.deepEqual(sellYears(DIVS), [2026]);
  assert.deepEqual(taxYears(DIVS), [2026, 2025]); // union, desc
});

test('buildDividendReport: groups by class with gross/wht/net per currency + totals', () => {
  const rep = buildDividendReport(DIVS, 2026);
  assert.equal(rep.year, 2026);
  assert.equal(rep.count, 3); // 2×AAPL + 1×PTT.BK in 2026 (KO is 2025)
  // Totals: USD gross 200 / wht 30 / net 170; THB gross 500 / wht 50 / net 450
  assert.deepEqual(rep.totals.gross, { USD: 200, THB: 500 });
  assert.deepEqual(rep.totals.wht, { USD: 30, THB: 50 });
  assert.deepEqual(rep.totals.net, { USD: 170, THB: 450 });
  const us = rep.groups.find((g) => g.type === 'us_stock');
  const th = rep.groups.find((g) => g.type === 'th_stock');
  assert.ok(us && th);
  assert.deepEqual(us.net, { USD: 170 });
  assert.deepEqual(th.net, { THB: 450 });
  assert.equal(us.count, 2);
});

test('buildTaxReport (capital gains) ignores dividend entries entirely', () => {
  const rep = buildTaxReport(DIVS, 2026);
  assert.equal(rep.sellCount, 1);
  const us = rep.groups.find((g) => g.type === 'us_stock');
  assert.deepEqual(us.byCurrency, { USD: 200 });
});
