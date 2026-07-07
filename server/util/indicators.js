// Server-side technical-indicator snapshot for the AI Trade Scout.
// Pure math over the candle shape used across the app: { time (epoch sec),
// open, high, low, close, volume }. Everything returns null when there is not
// enough history — the prompt builder simply omits missing lines.

const last = (arr) => (arr.length ? arr[arr.length - 1] : null);

export function sma(values, n) {
  if (!Array.isArray(values) || values.length < n || n <= 0) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i += 1) s += values[i];
  return s / n;
}

export function emaSeries(values, n) {
  if (!Array.isArray(values) || values.length < n || n <= 0) return null;
  const k = 2 / (n + 1);
  // Seed with the SMA of the first n values.
  let prev = 0;
  for (let i = 0; i < n; i += 1) prev += values[i];
  prev /= n;
  const out = [prev];
  for (let i = n; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/** Wilder RSI. Returns the latest value (0-100) or null. */
export function rsi(closes, n = 14) {
  if (!Array.isArray(closes) || closes.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i += 1) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / n;
  let avgLoss = loss / n;
  for (let i = n + 1; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (n - 1) + Math.max(0, d)) / n;
    avgLoss = (avgLoss * (n - 1) + Math.max(0, -d)) / n;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** MACD(12,26,9): latest line, signal, histogram and the previous histogram. */
export function macd(closes, fast = 12, slow = 26, signalN = 9) {
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  if (!emaFast || !emaSlow) return null;
  // Align: emaSlow starts (slow - fast) points later than emaFast.
  const offset = slow - fast;
  const line = [];
  for (let i = 0; i < emaSlow.length; i += 1) line.push(emaFast[i + offset] - emaSlow[i]);
  const signal = emaSeries(line, signalN);
  if (!signal) return null;
  const histSeries = [];
  const sOffset = line.length - signal.length;
  for (let i = 0; i < signal.length; i += 1) histSeries.push(line[i + sOffset] - signal[i]);
  return {
    line: last(line),
    signal: last(signal),
    histogram: last(histSeries),
    prevHistogram: histSeries.length > 1 ? histSeries[histSeries.length - 2] : null,
  };
}

/**
 * Build a compact technical snapshot from daily candles (oldest -> newest).
 * @param {{time:number, open:number, high:number, low:number, close:number, volume:number}[]} candles
 */
export function technicalSnapshot(candles = []) {
  const rows = (candles || []).filter((c) => c && Number.isFinite(c.close) && c.close > 0);
  if (rows.length < 2) return null;
  rows.sort((a, b) => a.time - b.time);
  const closes = rows.map((c) => c.close);
  const vols = rows.map((c) => Number(c.volume) || 0);
  const price = closes[closes.length - 1];

  const pctFrom = (n) => {
    if (closes.length <= n) return null;
    const base = closes[closes.length - 1 - n];
    return base > 0 ? ((price - base) / base) * 100 : null;
  };

  const win = rows.slice(-63); // ~3 months of trading days
  const hi3m = Math.max(...win.map((c) => c.high ?? c.close));
  const lo3m = Math.min(...win.map((c) => c.low ?? c.close));

  return {
    price,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    ret5d: pctFrom(5),
    ret1m: pctFrom(21),
    ret3m: pctFrom(63),
    hi3m,
    lo3m,
    avgVol20: sma(vols, 20),
    lastVol: vols[vols.length - 1],
    bars: rows.length,
  };
}

const f2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

/** Render the snapshot as prompt-friendly bullet lines (skips missing data). */
export function describeSnapshot(s) {
  if (!s) return [];
  const lines = [];
  const rel = (ma, label) => {
    if (ma == null) return;
    const pct = ((s.price - ma) / ma) * 100;
    lines.push(`- Price vs ${label}: ${pct >= 0 ? '+' : ''}${f2(pct)}% (${label} ${f2(ma)})`);
  };
  lines.push(`- Last close: ${f2(s.price)} (${s.bars} daily bars of history)`);
  rel(s.sma20, 'SMA20');
  rel(s.sma50, 'SMA50');
  rel(s.sma200, 'SMA200');
  if (s.rsi14 != null) lines.push(`- RSI(14): ${f2(s.rsi14)}`);
  if (s.macd && s.macd.histogram != null) {
    const dir =
      s.macd.prevHistogram == null
        ? ''
        : s.macd.histogram >= s.macd.prevHistogram
          ? ' (rising)'
          : ' (falling)';
    lines.push(`- MACD(12,26,9) histogram: ${f2(s.macd.histogram)}${dir}`);
  }
  if (s.ret5d != null) lines.push(`- Return 5d/1m/3m: ${f2(s.ret5d)}% / ${f2(s.ret1m)}% / ${f2(s.ret3m)}%`);
  if (Number.isFinite(s.hi3m) && Number.isFinite(s.lo3m)) {
    lines.push(`- 3-month range: ${f2(s.lo3m)} – ${f2(s.hi3m)} (now ${f2(((s.price - s.lo3m) / (s.hi3m - s.lo3m || 1)) * 100)}% of range)`);
  }
  if (s.avgVol20 != null && s.avgVol20 > 0 && s.lastVol != null) {
    lines.push(`- Volume: last ${Math.round(s.lastVol).toLocaleString('en-US')} vs 20d avg ${Math.round(s.avgVol20).toLocaleString('en-US')} (${f2((s.lastVol / s.avgVol20) * 100)}%)`);
  }
  return lines;
}

export default { sma, emaSeries, rsi, macd, technicalSnapshot, describeSnapshot };
