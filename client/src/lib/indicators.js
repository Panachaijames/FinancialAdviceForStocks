// Technical indicators. All array outputs are aligned to input length,
// using null for warmup positions where a value cannot be computed.

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Simple Moving Average.
 */
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (!period || period <= 0) return out;
  let sum = 0;
  let count = 0;
  const window = [];
  for (let i = 0; i < values.length; i++) {
    const v = toNum(values[i]);
    window.push(v);
    if (v !== null) {
      sum += v;
      count += 1;
    }
    if (window.length > period) {
      const removed = window.shift();
      if (removed !== null) {
        sum -= removed;
        count -= 1;
      }
    }
    if (window.length === period && count === period) {
      out[i] = sum / period;
    }
  }
  return out;
}

/**
 * Exponential Moving Average. Seeded with the SMA of the first `period` values.
 */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (!period || period <= 0) return out;
  const k = 2 / (period + 1);
  let prev = null;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < values.length; i++) {
    const v = toNum(values[i]);
    if (prev === null) {
      if (v !== null) {
        seedSum += v;
        seedCount += 1;
      }
      if (seedCount === period) {
        prev = seedSum / period;
        out[i] = prev;
      }
    } else {
      if (v !== null) {
        prev = v * k + prev * (1 - k);
      }
      out[i] = prev;
    }
  }
  return out;
}

/**
 * Weighted Moving Average (linear weights).
 */
export function wma(values, period) {
  const out = new Array(values.length).fill(null);
  if (!period || period <= 0) return out;
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let acc = 0;
    let ok = true;
    for (let j = 0; j < period; j++) {
      const v = toNum(values[i - period + 1 + j]);
      if (v === null) {
        ok = false;
        break;
      }
      acc += v * (j + 1);
    }
    out[i] = ok ? acc / denom : null;
  }
  return out;
}

/**
 * Bollinger Bands.
 */
export function bollingerBands(values, period = 20, mult = 2) {
  const middle = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (middle[i] === null) continue;
    let sumSq = 0;
    let ok = true;
    for (let j = i - period + 1; j <= i; j++) {
      const v = toNum(values[j]);
      if (v === null) {
        ok = false;
        break;
      }
      sumSq += (v - middle[i]) ** 2;
    }
    if (!ok) continue;
    const sd = Math.sqrt(sumSq / period);
    upper[i] = middle[i] + mult * sd;
    lower[i] = middle[i] - mult * sd;
  }
  return { upper, middle, lower };
}

/**
 * Relative Strength Index with Wilder smoothing.
 */
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period || period <= 0) return out;
  let gainSum = 0;
  let lossSum = 0;
  // seed with first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = toNum(values[i]) - toNum(values[i - 1]);
    if (change >= 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const change = toNum(values[i]) - toNum(values[i - 1]);
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/**
 * MACD line, signal line, and histogram.
 */
export function macd(values, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) {
      macdLine[i] = emaFast[i] - emaSlow[i];
    }
  }
  // signal = EMA of macdLine, only over the contiguous non-null region.
  const signalLine = new Array(values.length).fill(null);
  const firstIdx = macdLine.findIndex((v) => v !== null);
  if (firstIdx !== -1) {
    const slice = macdLine.slice(firstIdx).map((v) => (v === null ? 0 : v));
    const sig = ema(slice, signal);
    for (let i = 0; i < sig.length; i++) {
      signalLine[firstIdx + i] = sig[i];
    }
  }
  const hist = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (macdLine[i] !== null && signalLine[i] !== null) {
      hist[i] = macdLine[i] - signalLine[i];
    }
  }
  return { macd: macdLine, signal: signalLine, hist };
}

/**
 * Stochastic oscillator (%K, %D).
 */
export function stochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  const n = closes.length;
  const k = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i < kPeriod - 1) continue;
    let hh = -Infinity;
    let ll = Infinity;
    let ok = true;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      const h = toNum(highs[j]);
      const l = toNum(lows[j]);
      if (h === null || l === null) {
        ok = false;
        break;
      }
      if (h > hh) hh = h;
      if (l < ll) ll = l;
    }
    const c = toNum(closes[i]);
    if (!ok || c === null) continue;
    const denom = hh - ll;
    k[i] = denom === 0 ? 100 : ((c - ll) / denom) * 100;
  }
  const d = sma(k, dPeriod);
  return { k, d };
}

/**
 * Average True Range with Wilder smoothing.
 */
export function atr(highs, lows, closes, period = 14) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (n === 0 || period <= 0) return out;
  const tr = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const h = toNum(highs[i]);
    const l = toNum(lows[i]);
    if (h === null || l === null) continue;
    if (i === 0) {
      tr[i] = h - l;
    } else {
      const pc = toNum(closes[i - 1]);
      const a = h - l;
      const b = pc === null ? a : Math.abs(h - pc);
      const c = pc === null ? a : Math.abs(l - pc);
      tr[i] = Math.max(a, b, c);
    }
  }
  if (n <= period) return out;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i] === null ? 0 : tr[i];
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < n; i++) {
    const t = tr[i] === null ? prev : tr[i];
    prev = (prev * (period - 1) + t) / period;
    out[i] = prev;
  }
  return out;
}

/**
 * Volume-Weighted Average Price (cumulative, from candles).
 * @param {Array<{high,low,close,volume}>} candles
 */
export function vwap(candles) {
  const out = new Array(candles.length).fill(null);
  let cumPV = 0;
  let cumVol = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i] || {};
    const high = toNum(c.high);
    const low = toNum(c.low);
    const close = toNum(c.close);
    const vol = toNum(c.volume);
    if (high === null || low === null || close === null || vol === null) {
      out[i] = cumVol > 0 ? cumPV / cumVol : null;
      continue;
    }
    const tp = (high + low + close) / 3;
    cumPV += tp * vol;
    cumVol += vol;
    out[i] = cumVol > 0 ? cumPV / cumVol : null;
  }
  return out;
}

/**
 * On-Balance Volume.
 */
export function obv(closes, volumes) {
  const out = new Array(closes.length).fill(null);
  if (closes.length === 0) return out;
  let running = 0;
  out[0] = 0;
  for (let i = 1; i < closes.length; i++) {
    const c = toNum(closes[i]);
    const pc = toNum(closes[i - 1]);
    const v = toNum(volumes[i]) || 0;
    if (c === null || pc === null) {
      out[i] = running;
      continue;
    }
    if (c > pc) running += v;
    else if (c < pc) running -= v;
    out[i] = running;
  }
  return out;
}

/**
 * Build lightweight-charts line data [{time,value}] from candles + a values array.
 * Skips null/undefined values. time comes from candle.time (UNIX seconds).
 */
export function toLineData(candles, valuesArray) {
  const out = [];
  const len = Math.min(candles.length, valuesArray.length);
  for (let i = 0; i < len; i++) {
    const v = valuesArray[i];
    if (v === null || v === undefined || Number.isNaN(Number(v))) continue;
    const candle = candles[i];
    if (!candle || candle.time === null || candle.time === undefined) continue;
    out.push({ time: candle.time, value: Number(v) });
  }
  return out;
}
