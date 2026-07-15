// Pure ensemble + uncertainty-band math, extracted from ForecastView's run()
// pipeline so it can be unit-tested (every model it combines is already a tested
// pure module; only this combining math lived untestably inside a 777-line
// component). Behaviour is identical to the inline versions it replaced.

/**
 * Geometric 95% uncertainty band around a forecast path: value × exp(±1.96·σ·√h),
 * where σ is the model's 1-step holdout RMSE and h is the step (1-indexed) — so
 * the band widens with the square root of horizon.
 * @param {number[]} path forecast closes
 * @param {number} sigma 1-step RMSE (in log/return space)
 * @returns {{ lower:number[], upper:number[] }}
 */
export function bandFor(path, sigma) {
  return {
    lower: path.map((c, i) => c * Math.exp(-1.96 * sigma * Math.sqrt(i + 1))),
    upper: path.map((c, i) => c * Math.exp(1.96 * sigma * Math.sqrt(i + 1))),
  };
}

/**
 * Equal-weight ensemble: the per-day mean across the enabled models' forecast
 * closes, ignoring non-finite entries. NaN for a day where no model has a value.
 * @param {{closes:number[]}[]} forecasts
 * @param {number} [length] number of days (defaults to the first forecast's length)
 * @returns {number[]}
 */
export function ensembleCloses(forecasts, length) {
  const list = Array.isArray(forecasts) ? forecasts : [];
  const n = length != null ? length : list[0]?.closes?.length || 0;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const vals = list.map((f) => f.closes?.[i]).filter(Number.isFinite);
    out.push(vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : NaN);
  }
  return out;
}

/**
 * Total return % of each forecast's terminal close vs the last actual close,
 * keyed by forecast key. Skips non-finite terminals; empty if lastClose <= 0.
 * @param {{key:string, closes:number[]}[]} forecasts
 * @param {number} lastClose
 * @returns {Record<string, number>}
 */
export function forecastReturnsPct(forecasts, lastClose) {
  const out = {};
  if (!(lastClose > 0)) return out;
  for (const f of Array.isArray(forecasts) ? forecasts : []) {
    const end = f.closes?.[f.closes.length - 1];
    if (Number.isFinite(end)) out[f.key] = (end / lastClose - 1) * 100;
  }
  return out;
}

export default { bandFor, ensembleCloses, forecastReturnsPct };
