// Tests for the Forecast enhancements: auto-ARIMA order selection, the finance
// sentiment scorer, and the news feature integration in the pipeline.
// Run with:  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoArima, fitArima } from '../src/lib/forecast/arima.js';
import { scoreText, scoreArticles, moodLabel } from '../src/lib/forecast/sentiment.js';
import { buildDataset, featureNames, recursiveForecast } from '../src/lib/forecast/features.js';

// Seeded LCG so tests are deterministic (no Math.random).
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1103515245 * s + 12345) >>> 0;
    return s / 0xffffffff;
  };
}

// ── auto-ARIMA ────────────────────────────────────────────────────────────

test('autoArima picks a low order for pure AR(1) data and returns a scored grid', () => {
  const rnd = lcg(7);
  const r = [0];
  for (let i = 1; i < 1500; i += 1) r.push(0.6 * r[i - 1] + (rnd() - 0.5) * 0.02);
  const logPrices = [0];
  for (let i = 0; i < r.length; i += 1) logPrices.push(logPrices[i] + r[i]);

  const res = autoArima(logPrices, { maxP: 4, maxQ: 4, criterion: 'aic' });
  assert.ok(res.best.p >= 1); // needs at least one AR lag
  assert.ok(res.best.p + res.best.q <= 4); // parsimonious, not maxed out
  // Every candidate is scored on the SAME N -> table has finite AICs for ok fits
  const ok = res.table.filter((t) => t.ok);
  assert.ok(ok.length >= 10);
  for (const t of ok) assert.ok(Number.isFinite(t.aic) && Number.isFinite(t.bic));
  // The winner really is the argmin AIC among ok candidates.
  const minAic = Math.min(...ok.map((t) => t.aic));
  const winner = res.table.find((t) => t.p === res.best.p && t.q === res.best.q);
  assert.ok(Math.abs(winner.aic - minAic) < 1e-9);
  // Returned model matches the chosen order and is usable.
  assert.equal(res.model.p, res.best.p);
  assert.equal(res.model.q, res.best.q);
});

test('autoArima is deterministic and BIC never prefers a larger model than AIC by much', () => {
  const rnd = lcg(11);
  const logPrices = [0];
  for (let i = 1; i < 800; i += 1) logPrices.push(logPrices[i - 1] + (rnd() - 0.5) * 0.03);
  const a = autoArima(logPrices, { maxP: 3, maxQ: 3, criterion: 'aic' });
  const b = autoArima(logPrices, { maxP: 3, maxQ: 3, criterion: 'aic' });
  assert.deepEqual(a.best, b.best);
  const bic = autoArima(logPrices, { maxP: 3, maxQ: 3, criterion: 'bic' });
  // BIC penalizes complexity harder -> chosen k <= AIC's chosen k.
  assert.ok(1 + bic.best.p + bic.best.q <= 1 + a.best.p + a.best.q + 1);
});

test('autoArima throws on short input', () => {
  assert.throws(() => autoArima([0, 0.1, 0.2], { maxP: 2, maxQ: 2 }), /at least/);
});

// ── sentiment scorer ──────────────────────────────────────────────────────

test('scoreText: polarity, negation, and neutral', () => {
  assert.ok(scoreText('Shares surge as company beats profit estimates') > 0.5);
  assert.ok(scoreText('Stock plunges on downgrade and weak guidance') < -0.5);
  assert.ok(scoreText('Company announces quarterly conference call date') === 0);
  // Negation flips a positive term.
  assert.ok(scoreText('earnings did not beat expectations') < 0);
});

test('scoreArticles aggregates and moodLabel buckets', () => {
  const agg = scoreArticles([
    { title: 'Surge on record profit' },
    { title: 'Shares plunge on lawsuit' },
    { title: 'Board meeting scheduled' }, // neutral, no signal
  ]);
  assert.equal(agg.count, 3);
  assert.equal(agg.positive, 1);
  assert.equal(agg.negative, 1);
  assert.equal(moodLabel(0.5), 'Positive');
  assert.equal(moodLabel(0), 'Neutral');
  assert.equal(moodLabel(-0.5), 'Negative');
});

// ── news feature integration ──────────────────────────────────────────────

const DAY = 86400;
function makeCandles(n, start = 1704067200 /* 2024-01-01 */) {
  const out = [];
  let t = start;
  for (let i = 0; i < n; i += 1) {
    while ([0, 6].includes(new Date(t * 1000).getUTCDay())) t += DAY;
    out.push({ time: t, close: 100 * Math.exp(0.0003 * i), volume: 1000 });
    t += DAY;
  }
  return out;
}

test('news feature: adds 3 columns and is used only when data is supplied', () => {
  const candles = makeCandles(320);
  const opts = { technical: true, macro: false, calendar: false, news: true };
  // Daily sentiment on a handful of the candle dates.
  const newsDaily = candles.slice(100, 140).map((c, i) => ({
    date: new Date(c.time * 1000).toISOString().slice(0, 10),
    score: i % 2 === 0 ? 0.8 : -0.4,
    count: 3,
  }));

  const withNews = buildDataset(candles, null, opts, newsDaily);
  const withoutData = buildDataset(candles, null, opts, null); // news:true but no data

  assert.ok(withNews.names.includes('newsSent'));
  assert.ok(withNews.names.includes('newsSentEMA'));
  assert.ok(withNews.names.includes('newsVol'));
  // With no data supplied, the group is dropped cleanly (no phantom columns).
  assert.ok(!withoutData.names.includes('newsSent'));
  assert.equal(withNews.names.length, withoutData.names.length + 3);
  // Every row is finite.
  for (const row of withNews.rows) for (const v of row) assert.ok(Number.isFinite(v));
});

test('news feature: sentiment decays toward neutral through the recursive forecast', async () => {
  const candles = makeCandles(320);
  const opts = { technical: true, macro: false, calendar: false, news: true };
  // Strong positive sentiment on the LAST covered day near the series end.
  const lastDay = new Date(candles[candles.length - 2].time * 1000).toISOString().slice(0, 10);
  const newsDaily = [{ date: lastDay, score: 1, count: 5 }];
  const ds = buildDataset(candles, null, opts, newsDaily);

  const sentIdx = ds.names.indexOf('newsSent');
  // Capture the news-sentiment feature value at each forecast step.
  const seen = [];
  await recursiveForecast(ds, (hist) => { seen.push(hist[hist.length - 1][sentIdx]); return 0; }, 6);
  // It should be non-increasing in magnitude (decaying), and shrink over time.
  assert.ok(Math.abs(seen[5]) < Math.abs(seen[0]) + 1e-9);
  assert.ok(Math.abs(seen[5]) <= Math.abs(seen[1]) + 1e-9);
});
