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

/**
 * Bend a base forecast path toward a terminal log-deviation, ramped linearly
 * from ~0 at the first step to `totalLogShift` at the last, so the divergence
 * grows smoothly over the horizon. Multiplicative (exp) so prices stay positive
 * and the shift is scale-free. scenarioPath(base, 0) === base.
 * @param {number[]} base
 * @param {number} totalLogShift  log-deviation reached at the final step (may be < 0)
 * @returns {number[]}
 */
export function scenarioPath(base, totalLogShift) {
  const arr = Array.isArray(base) ? base : [];
  const n = arr.length;
  if (n === 0 || !Number.isFinite(totalLogShift) || totalLogShift === 0) return arr.slice();
  return arr.map((c, i) => c * Math.exp(totalLogShift * ((i + 1) / n)));
}

/**
 * News-driven scenario cone around a base forecast path. NOT a prediction — an
 * illustration of "what if the recent-headline narrative plays out". The cone
 * is anchored to the stock's OWN realised volatility (σ_daily·√horizon = its 1σ
 * move over the horizon), so a calm stock gets gentle branches and a volatile
 * one gets wide ones; the news `tilt` (aggregate headline polarity in [-1, 1])
 * only amplifies whichever side it leans toward, never invents magnitude.
 * Neutral news → a symmetric ±1σ_H cone; strongly bullish news → up-branch ~2×,
 * down-branch ~1×; and vice-versa.
 * @param {number[]} base       base forecast closes (e.g. the ensemble)
 * @param {number}   sigmaDaily std-dev of daily log returns (>= 0)
 * @param {number}   tilt       aggregate news polarity in [-1, 1] (0 = neutral)
 * @param {number}   [k=1]      overall sensitivity multiplier
 * @returns {{ upShift:number, downShift:number, up:number[], down:number[] }}
 */
export function newsScenario(base, sigmaDaily, tilt, k = 1) {
  const arr = Array.isArray(base) ? base : [];
  const h = arr.length;
  const t = Math.max(-1, Math.min(1, Number(tilt) || 0));
  const volH = Math.max(0, Number(sigmaDaily) || 0) * Math.sqrt(Math.max(1, h)); // 1σ over the horizon, log space
  const upShift = volH * k * (1 + Math.max(0, t));
  const downShift = -volH * k * (1 + Math.max(0, -t));
  return { upShift, downShift, up: scenarioPath(arr, upShift), down: scenarioPath(arr, downShift) };
}

export default { bandFor, ensembleCloses, forecastReturnsPct, scenarioPath, newsScenario };
