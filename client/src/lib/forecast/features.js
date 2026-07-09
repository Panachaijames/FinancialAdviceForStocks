// Feature engineering for the Forecast page — pure functions.
//
// Builds a tabular dataset from daily candles: technical indicators computed
// from CLOSES ONLY (so the same code can recompute them on a forecast path
// where future highs/lows/volumes don't exist), macro-economic context series
// (index/FX/rates/commodity candles aligned by forward-fill), and calendar
// features. The prediction target is the NEXT-DAY log return; multi-day
// forecasts roll the model forward recursively, appending each predicted
// close and recomputing every feature at each step.

/** Macro context series (fetched as regular candles through /api/candles). */
export const MACRO_SERIES = [
  { symbol: '^GSPC', key: 'sp500', label: 'S&P 500', mode: 'ret5' },
  { symbol: '^VIX', key: 'vix', label: 'VIX (fear index)', mode: 'level', scale: 1 / 100 },
  { symbol: '^TNX', key: 'us10y', label: 'US 10Y yield', mode: 'level', scale: 1 / 100 },
  { symbol: 'DX-Y.NYB', key: 'dxy', label: 'US Dollar index', mode: 'ret5' },
  { symbol: 'GC=F', key: 'gold', label: 'Gold', mode: 'ret5' },
  { symbol: 'CL=F', key: 'oil', label: 'Crude oil (WTI)', mode: 'ret5' },
  { symbol: 'THB=X', key: 'usdthb', label: 'USD/THB', mode: 'ret5' },
  { symbol: '^SET.BK', key: 'set', label: 'SET Index', mode: 'ret5' },
  { symbol: 'BTC-USD', key: 'btc', label: 'Bitcoin (risk appetite)', mode: 'ret5' },
];

const DAY = 86400;
const dayKey = (t) => Math.floor(t / DAY);

const log = Math.log;

function mean(a) {
  let s = 0;
  for (const v of a) s += v;
  return a.length ? s / a.length : 0;
}
function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (const v of a) s += (v - m) * (v - m);
  return Math.sqrt(s / (a.length - 1));
}

/** Simple moving average of the last n entries ending at index t (inclusive). */
function smaAt(values, t, n) {
  if (t + 1 < n) return null;
  let s = 0;
  for (let i = t - n + 1; i <= t; i += 1) s += values[i];
  return s / n;
}

/** EMA computed over the whole prefix ending at t (seeded with SMA of first n). */
function emaSeries(values, n) {
  if (values.length < n) return null;
  const k = 2 / (n + 1);
  const out = new Array(values.length).fill(null);
  let prev = 0;
  for (let i = 0; i < n; i += 1) prev += values[i];
  prev /= n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder RSI at index t. */
function rsiAt(closes, t, n = 14) {
  if (t < n) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i += 1) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / n;
  let avgLoss = loss / n;
  for (let i = n + 1; i <= t; i += 1) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (n - 1) + Math.max(0, d)) / n;
    avgLoss = (avgLoss * (n - 1) + Math.max(0, -d)) / n;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** How many rows of history the features need before they are all defined. */
export const WARMUP = 60;

/**
 * Names of the technical features (order matters — rows are built in this order).
 */
const TECH_NAMES = [
  'ret1', 'ret5', 'ret10', 'ret21',
  'smaRatio20', 'smaRatio50',
  'macdHist', 'rsi14', 'bbPos', 'bbWidth',
  'vol21', 'rangePos63', 'volRatio',
];
const NEWS_NAMES = ['newsSent', 'newsSentEMA', 'newsVol'];
const CAL_NAMES = ['dayOfWeek', 'monthFrac'];

// How fast stale news sentiment fades when there is no fresh coverage (per day),
// and the same decay applied to future (news-less) forecast steps.
const NEWS_DECAY = 0.85;

/**
 * Compute one feature row at time index t.
 * @param {object} s — prepared state: { closes, volumes, ema12, ema26, ema9OfMacd(unused), macroFF, dates, options }
 * @returns {number[]|null} null while inside the warmup window
 */
export function featureRowAt(s, t) {
  const { closes, volumes, macroFF, dates, options } = s;
  if (t < WARMUP) return null;
  const c = closes[t];
  const row = [];

  if (options.technical) {
    const r = (back) => log(c / closes[t - back]);
    row.push(r(1), r(5), r(10), r(21));

    const sma20 = smaAt(closes, t, 20);
    const sma50 = smaAt(closes, t, 50);
    row.push(c / sma20 - 1, c / sma50 - 1);

    // MACD histogram (12,26,9) normalized by price.
    const e12 = s.ema12[t];
    const e26 = s.ema26[t];
    const macdLine = e12 != null && e26 != null ? e12 - e26 : 0;
    // Signal: EMA9 of the macd line — approximate with SMA9 of recent line values
    // (cheap, close-only, stable under recursion).
    let sig = 0;
    let cnt = 0;
    for (let i = Math.max(26, t - 8); i <= t; i += 1) {
      if (s.ema12[i] != null && s.ema26[i] != null) {
        sig += s.ema12[i] - s.ema26[i];
        cnt += 1;
      }
    }
    sig = cnt ? sig / cnt : 0;
    row.push((macdLine - sig) / c);

    row.push((rsiAt(closes, t, 14) ?? 50) / 100);

    // Bollinger (20, 2)
    const win20 = closes.slice(t - 19, t + 1);
    const m20 = mean(win20);
    const s20 = std(win20);
    const upper = m20 + 2 * s20;
    const lower = m20 - 2 * s20;
    row.push(upper > lower ? (c - lower) / (upper - lower) : 0.5);
    row.push(m20 > 0 ? (upper - lower) / m20 : 0);

    // Realized volatility of last 21 daily returns.
    const rets = [];
    for (let i = t - 20; i <= t; i += 1) rets.push(log(closes[i] / closes[i - 1]));
    row.push(std(rets));

    // Position inside the 63-day range.
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = t - 62; i <= t; i += 1) {
      if (closes[i] > hi) hi = closes[i];
      if (closes[i] < lo) lo = closes[i];
    }
    row.push(hi > lo ? (c - lo) / (hi - lo) : 0.5);

    // Volume vs its 20d average (1 = normal; future steps hold at 1).
    const v = volumes[t];
    const vs = smaAt(volumes, t, 20);
    row.push(v != null && vs > 0 ? v / vs : 1);
  }

  if (options.macro && macroFF) {
    for (const m of MACRO_SERIES) {
      const arr = macroFF[m.key];
      if (!arr) continue;
      if (m.mode === 'level') {
        row.push((arr[t] ?? arr[arr.length - 1] ?? 0) * (m.scale || 1));
      } else {
        const now = arr[t];
        const then = arr[Math.max(0, t - 5)];
        row.push(now > 0 && then > 0 ? log(now / then) : 0);
      }
    }
  }

  if (options.news && s.newsSent) {
    row.push(s.newsSent[t] ?? 0); // decayed daily sentiment [-1,1]
    row.push(s.newsSentEMA[t] ?? 0); // 5-day EMA of sentiment
    row.push(Math.log1p(s.newsCount[t] ?? 0)); // article-volume (attention) signal
  }

  if (options.calendar) {
    const d = new Date(dates[t] * 1000);
    row.push(d.getUTCDay() / 6);
    row.push(d.getUTCMonth() / 11);
  }

  // NaN guard — models must never see non-finite values.
  for (let i = 0; i < row.length; i += 1) if (!Number.isFinite(row[i])) row[i] = 0;
  return row;
}

/** Feature names for the active option set (matches featureRowAt order). */
export function featureNames(options, macroKeys = MACRO_SERIES.map((m) => m.key)) {
  const names = [];
  if (options.technical) names.push(...TECH_NAMES);
  if (options.macro) {
    for (const m of MACRO_SERIES) if (macroKeys.includes(m.key)) names.push(`macro:${m.key}`);
  }
  if (options.news) names.push(...NEWS_NAMES);
  if (options.calendar) names.push(...CAL_NAMES);
  return names;
}

/**
 * Align a daily news-sentiment series onto candle dates: forward-fill sentiment
 * with per-day decay toward neutral (so stale headlines fade), keep the raw
 * article count per day (0 when none), and compute a 5-day EMA of sentiment.
 * @param {number[]} dates candle timestamps (epoch sec, ascending)
 * @param {{date:string, score:number, count:number}[]} newsDaily
 */
function alignNews(dates, newsDaily) {
  const byDay = new Map();
  for (const d of newsDaily || []) if (d && d.date) byDay.set(d.date, d);
  const sent = new Array(dates.length).fill(0);
  const count = new Array(dates.length).fill(0);
  const ema = new Array(dates.length).fill(0);
  const k = 2 / (5 + 1);
  for (let i = 0; i < dates.length; i += 1) {
    const day = new Date(dates[i] * 1000).toISOString().slice(0, 10);
    const hit = byDay.get(day);
    if (hit) {
      sent[i] = Number(hit.score) || 0;
      count[i] = Number(hit.count) || 0;
    } else {
      sent[i] = i > 0 ? sent[i - 1] * NEWS_DECAY : 0; // fade prior sentiment
      count[i] = 0;
    }
    ema[i] = i > 0 ? ema[i - 1] + k * (sent[i] - ema[i - 1]) : sent[i];
  }
  return { sent, count, ema };
}

/**
 * Build the supervised dataset from candles.
 * @param {{time:number, close:number, volume?:number}[]} targetCandles daily, ascending
 * @param {Record<string, {time:number, close:number}[]>} macroCandles by MACRO_SERIES key
 * @param {{technical:boolean, macro:boolean, calendar:boolean, news?:boolean}} options
 * @param {{date:string, score:number, count:number}[]} [newsDaily] daily sentiment (optional)
 * @returns {{
 *   dates:number[], closes:number[], volumes:number[], macroFF:Record<string,number[]>|null,
 *   state:object, names:string[], rows:number[][], targets:number[], firstRowIndex:number
 * }}
 *   rows[i] is the feature row at time index (firstRowIndex + i); targets[i] is
 *   the log return from that day to the next.
 */
export function buildDataset(targetCandles, macroCandles, options, newsDaily = null) {
  const rowsIn = (targetCandles || []).filter((c) => c && Number.isFinite(c.close) && c.close > 0);
  rowsIn.sort((a, b) => a.time - b.time);
  const dates = rowsIn.map((c) => c.time);
  const closes = rowsIn.map((c) => c.close);
  const volumes = rowsIn.map((c) => (Number.isFinite(c.volume) ? c.volume : null));
  if (closes.length < WARMUP + 80) {
    throw new Error(`Need at least ${WARMUP + 80} daily candles — got ${closes.length}. Try a longer range.`);
  }

  // Forward-fill each macro series onto the target's dates.
  let macroFF = null;
  if (options.macro && macroCandles) {
    macroFF = {};
    for (const m of MACRO_SERIES) {
      const src = (macroCandles[m.key] || []).filter((c) => c && Number.isFinite(c.close) && c.close > 0);
      if (src.length < 10) continue; // series unavailable — skipped consistently in rows/names
      src.sort((a, b) => a.time - b.time);
      const byDay = new Map(src.map((c) => [dayKey(c.time), c.close]));
      const out = new Array(dates.length).fill(null);
      let last = null;
      let si = 0;
      const srcDays = src.map((c) => dayKey(c.time));
      for (let i = 0; i < dates.length; i += 1) {
        const d = dayKey(dates[i]);
        while (si < srcDays.length && srcDays[si] <= d) {
          last = byDay.get(srcDays[si]);
          si += 1;
        }
        out[i] = last;
      }
      // Backfill the head so early rows aren't null (uses first known value).
      const firstVal = out.find((v) => v != null);
      for (let i = 0; i < out.length && out[i] == null; i += 1) out[i] = firstVal ?? 0;
      macroFF[m.key] = out;
    }
  }
  const macroKeys = macroFF ? Object.keys(macroFF) : [];

  // Align the daily news sentiment onto candle dates (forward-fill + decay).
  let news = null;
  if (options.news && newsDaily && newsDaily.length) news = alignNews(dates, newsDaily);

  const state = {
    closes,
    volumes,
    dates,
    macroFF,
    options: { ...options, news: !!news }, // if no news data, drop the feature group cleanly
    newsSent: news ? news.sent : null,
    newsCount: news ? news.count : null,
    newsSentEMA: news ? news.ema : null,
    ema12: emaSeries(closes, 12),
    ema26: emaSeries(closes, 26),
  };

  // Names must match the EFFECTIVE options (news is dropped when no data), so
  // rows and names always have the same width.
  const names = featureNames(state.options, macroKeys);
  const rows = [];
  const targets = [];
  const firstRowIndex = WARMUP;
  for (let t = firstRowIndex; t < closes.length - 1; t += 1) {
    rows.push(featureRowAt(state, t));
    targets.push(log(closes[t + 1] / closes[t]));
  }
  return { dates, closes, volumes, macroFF, state, names, rows, targets, firstRowIndex };
}

/** Next business day (skips Sat/Sun) as an epoch-seconds timestamp. */
export function nextBusinessDay(epochSec) {
  let d = new Date(epochSec * 1000);
  do {
    d = new Date(d.getTime() + 86400000);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return Math.floor(d.getTime() / 1000);
}

/**
 * Roll a 1-step model forward `horizon` business days, recomputing every
 * feature on the growing synthetic path (macro held at last known values,
 * volume at its 20d average).
 * @param {object} dataset — output of buildDataset
 * @param {(rowsHistory:number[][]) => number|Promise<number>} predictFn
 *   receives ALL feature rows built so far (last entry = today) and returns
 *   the predicted next-day log return.
 * @param {number} horizon business days
 * @returns {Promise<{dates:number[], closes:number[]}>} the forecast path
 */
export async function recursiveForecast(dataset, predictFn, horizon) {
  const closes = dataset.closes.slice();
  const volumes = dataset.volumes.slice();
  const dates = dataset.dates.slice();
  const macroFF = dataset.macroFF
    ? Object.fromEntries(Object.entries(dataset.macroFF).map(([k, v]) => [k, v.slice()]))
    : null;
  const hasNews = !!dataset.state.newsSent;
  const state = {
    ...dataset.state,
    closes,
    volumes,
    dates,
    macroFF,
    ema12: dataset.state.ema12.slice(),
    ema26: dataset.state.ema26.slice(),
    newsSent: hasNews ? dataset.state.newsSent.slice() : null,
    newsCount: hasNews ? dataset.state.newsCount.slice() : null,
    newsSentEMA: hasNews ? dataset.state.newsSentEMA.slice() : null,
  };

  // Rebuild the rows history (training rows end one day early — add today's).
  const rowsHistory = dataset.rows.slice();
  rowsHistory.push(featureRowAt(state, closes.length - 1));

  const lastVol = () => {
    const v = smaAt(volumes.map((x) => x ?? 0), volumes.length - 1, 20);
    return v ?? 0;
  };

  const outDates = [];
  const outCloses = [];
  const k12 = 2 / 13;
  const k26 = 2 / 27;

  for (let h = 0; h < horizon; h += 1) {
    const r = Number(await predictFn(rowsHistory));
    // Clamp: a single predicted daily move beyond ±20% is a model blow-up.
    const step = Number.isFinite(r) ? Math.max(-0.2, Math.min(0.2, r)) : 0;
    const newClose = closes[closes.length - 1] * Math.exp(step);

    dates.push(nextBusinessDay(dates[dates.length - 1]));
    closes.push(newClose);
    volumes.push(lastVol());
    if (macroFF) for (const k of Object.keys(macroFF)) macroFF[k].push(macroFF[k][macroFF[k].length - 1]);
    // Extend the EMA caches incrementally.
    state.ema12.push(state.ema12[state.ema12.length - 1] == null ? null : newClose * k12 + state.ema12[state.ema12.length - 1] * (1 - k12));
    state.ema26.push(state.ema26[state.ema26.length - 1] == null ? null : newClose * k26 + state.ema26[state.ema26.length - 1] * (1 - k26));
    // No future news exists — decay sentiment toward neutral, zero the volume.
    if (hasNews) {
      const prevSent = state.newsSent[state.newsSent.length - 1] * 0.85;
      state.newsSent.push(prevSent);
      state.newsCount.push(0);
      const kEma = 2 / 6;
      state.newsSentEMA.push(state.newsSentEMA[state.newsSentEMA.length - 1] + kEma * (prevSent - state.newsSentEMA[state.newsSentEMA.length - 1]));
    }

    rowsHistory.push(featureRowAt(state, closes.length - 1));
    outDates.push(dates[dates.length - 1]);
    outCloses.push(newClose);
  }
  return { dates: outDates, closes: outCloses };
}

/**
 * 1-step-ahead accuracy metrics for a list of predicted vs actual log returns.
 * dirAcc counts sign agreement (ties count as wrong — no free lunch).
 */
export function evaluateOneStep(preds, actuals) {
  const n = Math.min(preds.length, actuals.length);
  if (n === 0) return { n: 0, rmse: 0, mae: 0, dirAcc: 0 };
  let se = 0;
  let ae = 0;
  let dir = 0;
  for (let i = 0; i < n; i += 1) {
    const e = preds[i] - actuals[i];
    se += e * e;
    ae += Math.abs(e);
    if (Math.sign(preds[i]) !== 0 && Math.sign(preds[i]) === Math.sign(actuals[i])) dir += 1;
  }
  return { n, rmse: Math.sqrt(se / n), mae: ae / n, dirAcc: (dir / n) * 100 };
}

/**
 * One-step ARIMA predictions over a evaluation stretch of returns, filtering
 * residuals sequentially with the FITTED (train-only) parameters — the honest
 * way to score ARIMA on unseen data without refitting at every step.
 * @param {{phi:number[], theta:number[], intercept:number}} model
 * @param {number[]} returns full return series (train + test)
 * @param {number} testStart index in `returns` where evaluation begins
 */
export function arimaOneStepPreds(model, returns, testStart) {
  const { phi, theta, intercept } = model;
  const p = phi.length;
  const q = theta.length;
  const e = new Array(returns.length).fill(0);
  const preds = [];
  const start = Math.max(p, q);
  for (let t = start; t < returns.length; t += 1) {
    let f = intercept;
    for (let i = 0; i < p; i += 1) f += phi[i] * returns[t - 1 - i];
    for (let j = 0; j < q; j += 1) f += theta[j] * e[t - 1 - j];
    e[t] = returns[t] - f;
    if (t >= testStart) preds.push(f);
  }
  return preds;
}

export default {
  MACRO_SERIES,
  WARMUP,
  buildDataset,
  featureRowAt,
  featureNames,
  recursiveForecast,
  evaluateOneStep,
  arimaOneStepPreds,
  nextBusinessDay,
};
