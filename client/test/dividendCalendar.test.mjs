// Tests for nextDividendDate() (task 1.4 — dividend calendar). Covers the three
// paths: a provider-confirmed upcoming ex-date, an estimate from history cadence
// (the cloud fallback, since quoteSummary is blocked on datacenter IPs), and a
// lapsed cadence that must NOT invent a phantom date.
// Run with:  node --test client/test/dividendCalendar.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDividendDate } from '../src/lib/dividends.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-15T00:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
// A quarterly history whose last payment was ~1 month ago (still on cadence).
const quarterlyHistory = [
  { date: iso(NOW - 280 * DAY), amount: 0.24 },
  { date: iso(NOW - 189 * DAY), amount: 0.24 },
  { date: iso(NOW - 98 * DAY), amount: 0.25 },
  { date: iso(NOW - 30 * DAY), amount: 0.25 },
];

test('confirmed upcoming ex-date is used as-is (not estimated)', () => {
  const d = { exDate: iso(NOW + 5 * DAY), payDate: iso(NOW + 19 * DAY), frequency: 'quarterly', history: quarterlyHistory };
  const r = nextDividendDate(d, NOW);
  assert.equal(r.estimated, false);
  assert.equal(Date.parse(r.exDate), NOW + 5 * DAY);
  assert.equal(Date.parse(r.payDate), NOW + 19 * DAY);
});

test('a past confirmed ex-date falls through to a history estimate', () => {
  const d = { exDate: iso(NOW - 40 * DAY), frequency: 'quarterly', history: quarterlyHistory };
  const r = nextDividendDate(d, NOW);
  assert.equal(r.estimated, true);
  // last payment NOW-30d + ~91d median gap -> ~61 days out, in the future
  assert.ok(Date.parse(r.exDate) > NOW);
  assert.equal(r.payDate, null); // pay date isn't estimated
});

test('estimates from history cadence when no ex-date is provided (cloud)', () => {
  const d = { frequency: 'quarterly', history: quarterlyHistory };
  const r = nextDividendDate(d, NOW);
  assert.equal(r.estimated, true);
  const days = Math.round((Date.parse(r.exDate) - NOW) / DAY);
  assert.ok(days > 0 && days <= 91, `expected next ex within a quarter, got ${days}d`);
});

test('no history and no ex-date -> null', () => {
  assert.equal(nextDividendDate({ frequency: 'quarterly', history: [] }, NOW), null);
  assert.equal(nextDividendDate({ frequency: 'quarterly' }, NOW), null);
  assert.equal(nextDividendDate(null, NOW), null);
});

test('lapsed cadence (stock stopped paying) -> null, no phantom date', () => {
  const stale = [
    { date: iso(NOW - 900 * DAY), amount: 0.5 },
    { date: iso(NOW - 800 * DAY), amount: 0.5 },
  ]; // last payment ~2.2 years ago, quarterly cadence -> way past 2.5 intervals
  assert.equal(nextDividendDate({ frequency: 'quarterly', history: stale }, NOW), null);
});

test('single-history-entry uses the frequency interval', () => {
  const d = { frequency: 'monthly', history: [{ date: iso(NOW - 10 * DAY), amount: 0.1 }] };
  const r = nextDividendDate(d, NOW);
  assert.equal(r.estimated, true);
  const days = Math.round((Date.parse(r.exDate) - NOW) / DAY);
  assert.ok(days > 0 && days <= 30, `expected within a month, got ${days}d`);
});
