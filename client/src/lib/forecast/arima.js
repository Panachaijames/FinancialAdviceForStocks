// ARIMA(p,1,q) forecaster for daily LOG prices — a classical baseline for the
// client-side forecasting page. Estimation uses the Hannan–Rissanen two-stage
// OLS method (Hannan & Rissanen 1982, "Recursive estimation of mixed
// autoregressive-moving average order", Biometrika 69):
//   Stage 1 fits a long AR(m) to the differenced series to proxy the
//   unobservable innovations; Stage 2 regresses each return on lagged returns
//   AND those innovation proxies. Both stages are plain OLS via normal
//   equations, so no iterative optimizer dependency is needed — everything is
//   small, pure, deterministic math suitable for the browser.
// Forecast intervals come from the ARMA psi-weight expansion, accumulated for
// the integrated (price-level) forecast.

/**
 * Solve A x = b (A: k x k, b: length k) by Gaussian elimination with partial
 * pivoting. Mutates local copies only. Throws on a (near-)singular matrix.
 */
function solveLinear(A, b) {
  const k = b.length;
  // Work on copies so callers' arrays are untouched.
  const M = A.map((row) => row.slice());
  const y = b.slice();
  for (let col = 0; col < k; col++) {
    // Partial pivot: pick the row with the largest magnitude in this column.
    let pivotRow = col;
    let pivotAbs = Math.abs(M[col][col]);
    for (let row = col + 1; row < k; row++) {
      const a = Math.abs(M[row][col]);
      if (a > pivotAbs) {
        pivotAbs = a;
        pivotRow = row;
      }
    }
    if (!(pivotAbs > 1e-12)) {
      throw new Error('Singular matrix in OLS fit');
    }
    if (pivotRow !== col) {
      [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
      [y[col], y[pivotRow]] = [y[pivotRow], y[col]];
    }
    const pivot = M[col][col];
    for (let row = col + 1; row < k; row++) {
      const factor = M[row][col] / pivot;
      if (factor === 0) continue;
      for (let c = col; c < k; c++) M[row][c] -= factor * M[col][c];
      y[row] -= factor * y[col];
    }
  }
  const x = new Array(k).fill(0);
  for (let row = k - 1; row >= 0; row--) {
    let s = y[row];
    for (let c = row + 1; c < k; c++) s -= M[row][c] * x[c];
    x[row] = s / M[row][row];
  }
  return x;
}

/**
 * OLS via normal equations: beta = (X'X)^-1 X'y.
 * rows: array of regressor rows (each length k), y: targets.
 */
function olsFit(rows, y) {
  const k = rows[0].length;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  for (let t = 0; t < rows.length; t++) {
    const row = rows[t];
    for (let i = 0; i < k; i++) {
      Xty[i] += row[i] * y[t];
      for (let j = i; j < k; j++) XtX[i][j] += row[i] * row[j];
    }
  }
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < i; j++) XtX[i][j] = XtX[j][i];
  }
  return solveLinear(XtX, Xty);
}

/** Validate and return log prices as plain finite numbers; throw otherwise. */
function checkLogPrices(logPrices) {
  if (!Array.isArray(logPrices)) throw new Error('logPrices must be an array');
  for (let i = 0; i < logPrices.length; i++) {
    if (!Number.isFinite(logPrices[i])) {
      throw new Error('logPrices contains non-finite values');
    }
  }
  return logPrices;
}

/** First differences (log returns) of a log-price series. */
function diff(logPrices) {
  const r = new Array(Math.max(0, logPrices.length - 1));
  for (let i = 1; i < logPrices.length; i++) r[i - 1] = logPrices[i] - logPrices[i - 1];
  return r;
}

/**
 * Fit ARIMA(p,1,q) on log prices via Hannan–Rissanen two-stage OLS.
 * Throws Error('Need at least 60 data points') when diff length < 60.
 *
 * @param {number[]} logPrices  daily log prices (finite numbers)
 * @param {{p?: number, q?: number}} [opts]  AR / MA orders (default 5 / 1)
 * @returns {{p: number, q: number, phi: number[], theta: number[],
 *   intercept: number, sigma: number, residuals: number[], n: number}}
 *   `residuals` is aligned to the return series (length n); entries before the
 *   stage-2 overlap are 0 so the array can be indexed directly by return index.
 */
export function fitArima(logPrices, { p = 5, q = 1 } = {}) {
  checkLogPrices(logPrices);
  const r = diff(logPrices);
  const n = r.length;
  if (n < 60) throw new Error('Need at least 60 data points');

  p = Math.max(0, Math.floor(p));
  q = Math.max(0, Math.floor(q));
  if (p + q < 1) p = 1;

  // ── Stage 1: long AR(m) by OLS with intercept -> innovation proxies e_t ──
  const m = Math.min(20, Math.max(p + q, Math.floor(n / 10)));
  const arRows = [];
  const arY = [];
  for (let t = m; t < n; t++) {
    const row = new Array(1 + m);
    row[0] = 1;
    for (let i = 1; i <= m; i++) row[i] = r[t - i];
    arRows.push(row);
    arY.push(r[t]);
  }
  const arBeta = olsFit(arRows, arY);
  // e aligned to r; unknown (pre-m) entries stay 0 and are never used as
  // regressors because the stage-2 overlap starts at m+q when q > 0.
  const e = new Array(n).fill(0);
  for (let t = m; t < n; t++) {
    let fitted = arBeta[0];
    for (let i = 1; i <= m; i++) fitted += arBeta[i] * r[t - i];
    e[t] = r[t] - fitted;
  }

  // ── Stage 2: OLS of r_t on [1, r_(t-1..t-p), e_(t-1..t-q)] ──
  const t0 = q > 0 ? Math.max(p, m + q) : p;
  const k = 1 + p + q;
  const rows = [];
  const y = [];
  for (let t = t0; t < n; t++) {
    const row = new Array(k);
    row[0] = 1;
    for (let i = 1; i <= p; i++) row[i] = r[t - i];
    for (let j = 1; j <= q; j++) row[p + j] = e[t - j];
    rows.push(row);
    y.push(r[t]);
  }
  const beta = olsFit(rows, y);
  const intercept = beta[0];
  const phi = beta.slice(1, 1 + p);
  const theta = beta.slice(1 + p, 1 + p + q);

  // Stage-2 residuals, aligned to r (zeros before the overlap start).
  const residuals = new Array(n).fill(0);
  let sse = 0;
  for (let t = t0; t < n; t++) {
    let fitted = intercept;
    for (let i = 1; i <= p; i++) fitted += phi[i - 1] * r[t - i];
    for (let j = 1; j <= q; j++) fitted += theta[j - 1] * e[t - j];
    const res = r[t] - fitted;
    residuals[t] = res;
    sse += res * res;
  }
  const N = n - t0;
  const dof = N - k;
  if (dof <= 0) throw new Error('Not enough observations for the requested orders');
  const sigma = Math.sqrt(sse / dof);

  return { p, q, phi, theta, intercept, sigma, residuals, n };
}

/**
 * Forecast `horizon` steps ahead on the LOG-price scale.
 * Point forecasts iterate the ARMA recursion with future shocks set to 0;
 * the 95% band uses psi weights accumulated for the integrated series.
 *
 * @param {ReturnType<typeof fitArima>} model
 * @param {number[]} logPrices  the series the model was fit on
 * @param {number} horizon  number of steps ahead (positive integer)
 * @returns {{mean: number[], lower95: number[], upper95: number[]}}
 */
export function forecastArima(model, logPrices, horizon) {
  checkLogPrices(logPrices);
  horizon = Math.floor(horizon);
  if (!Number.isFinite(horizon) || horizon < 1) {
    throw new Error('horizon must be a positive integer');
  }
  const { p, q, phi, theta, intercept, sigma } = model;
  const residuals = Array.isArray(model.residuals) ? model.residuals : [];
  const r = diff(logPrices);
  const n = r.length;

  // Extended return series: observed r followed by point forecasts.
  const rExt = r.slice();
  const eAt = (t) => (t >= 0 && t < residuals.length ? residuals[t] : 0);

  const mean = new Array(horizon);
  let level = logPrices[logPrices.length - 1];
  for (let h = 1; h <= horizon; h++) {
    const t = n + h - 1; // index of the return being forecast
    let rhat = intercept;
    for (let i = 1; i <= p; i++) rhat += phi[i - 1] * (t - i >= 0 ? rExt[t - i] : 0);
    for (let j = 1; j <= q; j++) {
      const s = t - j;
      rhat += theta[j - 1] * (s < n ? eAt(s) : 0); // future shocks are 0
    }
    rExt.push(rhat);
    level += rhat;
    mean[h - 1] = level;
  }

  // psi weights of the ARMA part, then PSI (cumulative) for the I(1) series.
  const psi = new Array(horizon).fill(0);
  psi[0] = 1;
  for (let k = 1; k < horizon; k++) {
    let v = k <= q ? theta[k - 1] : 0;
    const top = Math.min(k, p);
    for (let i = 1; i <= top; i++) v += phi[i - 1] * psi[k - i];
    psi[k] = v;
  }
  const lower95 = new Array(horizon);
  const upper95 = new Array(horizon);
  let PSI = 0; // running cumulative sum of psi
  let varSum = 0; // running sum of PSI_j^2
  for (let h = 1; h <= horizon; h++) {
    PSI += psi[h - 1];
    varSum += PSI * PSI;
    const half = 1.96 * sigma * Math.sqrt(varSum);
    lower95[h - 1] = mean[h - 1] - half;
    upper95[h - 1] = mean[h - 1] + half;
  }

  return { mean, lower95, upper95 };
}
