// Benchmark-comparison math — pure functions.
//
// "How did my current mix perform vs an index?" — takes each holding's daily
// candles, indexes every series to 100 at the first COMMON date, and blends
// them by the holdings' current weights. This is a fixed-weight comparison of
// the present portfolio composition (it does not replay past trades), which is
// the honest way to compare a mix against a benchmark without full
// time-weighted return accounting.

/**
 * Intersect candle series on their common timestamps (daily bars; different
 * markets have different holidays, crypto trades weekends — only days present
 * in EVERY series are kept, so all series stay comparable).
 * @param {Record<string, {time:number, close:number}[]>} candlesBySymbol
 * @returns {{ times:number[], closes: Record<string, number[]> }}
 */
export function alignSeries(candlesBySymbol = {}) {
  const symbols = Object.keys(candlesBySymbol).filter(
    (s) => Array.isArray(candlesBySymbol[s]) && candlesBySymbol[s].length > 1
  );
  if (symbols.length === 0) return { times: [], closes: {} };

  // Bucket by UTC day so slightly different intraday stamps still match.
  const dayKey = (t) => Math.floor(t / 86400);
  const maps = new Map();
  for (const s of symbols) {
    const m = new Map();
    for (const c of candlesBySymbol[s]) {
      if (c && Number.isFinite(c.close) && c.close > 0 && Number.isFinite(c.time)) {
        m.set(dayKey(c.time), c.close); // last bar of the day wins
      }
    }
    maps.set(s, m);
  }

  const first = maps.get(symbols[0]);
  const commonDays = [];
  for (const day of first.keys()) {
    if (symbols.every((s) => maps.get(s).has(day))) commonDays.push(day);
  }
  commonDays.sort((a, b) => a - b);

  const closes = {};
  for (const s of symbols) closes[s] = commonDays.map((d) => maps.get(s).get(d));
  return { times: commonDays.map((d) => d * 86400), closes };
}

/**
 * Index a close series to 100 at its first value.
 * @param {number[]} closes
 * @returns {number[]}
 */
export function indexTo100(closes = []) {
  if (!closes.length || !(closes[0] > 0)) return [];
  return closes.map((c) => (c / closes[0]) * 100);
}

/**
 * Blend aligned close series into one indexed portfolio line using weights
 * (normalized internally, so absolute market values work directly).
 * @param {Record<string, number[]>} closesBySymbol — aligned (same length)
 * @param {Record<string, number>} weights — e.g. market value per symbol
 * @returns {number[]} indexed series starting at 100
 */
export function blendIndexed(closesBySymbol = {}, weights = {}) {
  const symbols = Object.keys(closesBySymbol).filter(
    (s) => Array.isArray(closesBySymbol[s]) && closesBySymbol[s].length > 0 && Number(weights[s]) > 0
  );
  const totalW = symbols.reduce((s, sym) => s + Number(weights[sym]), 0);
  if (symbols.length === 0 || totalW <= 0) return [];
  const len = Math.min(...symbols.map((s) => closesBySymbol[s].length));
  const indexed = {};
  for (const s of symbols) indexed[s] = indexTo100(closesBySymbol[s].slice(0, len));
  const out = [];
  for (let i = 0; i < len; i += 1) {
    let v = 0;
    for (const s of symbols) v += (Number(weights[s]) / totalW) * indexed[s][i];
    out.push(v);
  }
  return out;
}

/** Total return % of an indexed (or price) series. */
export function totalReturnPct(series = []) {
  if (!series.length || !(series[0] > 0)) return 0;
  return (series[series.length - 1] / series[0] - 1) * 100;
}

export default { alignSeries, indexTo100, blendIndexed, totalReturnPct };
