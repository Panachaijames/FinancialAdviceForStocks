// Gradient boosting in the style of XGBoost — regularized regression trees in
// pure JS, used client-side to predict next-day returns from tabular features.
// This is NOT a binding of the XGBoost library, but it now implements XGBoost's
// actual regularized objective rather than plain variance reduction:
//
//   • Similarity/gain uses the XGBoost formula with an L2 leaf penalty λ:
//       leaf weight  w* = G / (H + λ)             (G = Σ residual, H = count)
//       node score   S  = G² / (H + λ)
//       split gain   = ½(S_left + S_right − S_parent) − γ
//     so leaves shrink toward zero (λ) and a split must clear a complexity
//     cost (γ, "min split loss") to be taken. (Squared loss ⇒ hessian 1, so
//     H is just the row count.)
//   • Row subsampling (subsample) AND column subsampling (colsample_bytree),
//     both seeded/deterministic — XGBoost's two big variance reducers.
//   • Optional early stopping on a chronological validation tail: keep the
//     tree count that minimizes validation RMSE (bestIteration) instead of
//     guessing nTrees.
//
// Zero dependencies, deterministic for a given seed, async so the browser can
// repaint between progress callbacks.

/**
 * Seeded PRNG (mulberry32). Returns a function yielding floats in [0, 1).
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Traverse one tree for one row. Missing/NaN feature values go left. */
function predictTree(node, row) {
  while (node.left) {
    const v = row[node.feature];
    node = v <= node.threshold || Number.isNaN(v) ? node.left : node.right;
  }
  return node.value;
}

/**
 * Build one regularized regression tree on the residuals of the given rows.
 * @param {number[][]} X full feature matrix
 * @param {Float64Array} residuals current residual per row of X
 * @param {number[]} rowIdx indices of the (subsampled) rows to fit
 * @param {number[]} featCols the (subsampled) feature columns to consider
 * @param {{maxDepth:number, minSamplesLeaf:number, maxThresholds:number, regLambda:number, gamma:number}} params
 * @returns {object} tree root; internal nodes carry `.gain` for importances
 */
function buildTree(X, residuals, rowIdx, featCols, params) {
  const { maxDepth, minSamplesLeaf, maxThresholds, regLambda, gamma } = params;

  const leafOf = (idx) => {
    let s = 0;
    for (const i of idx) s += residuals[i];
    // Regularized (shrunk) leaf weight: Σresidual / (count + λ).
    return { value: idx.length > 0 ? s / (idx.length + regLambda) : 0 };
  };
  const score = (sum, count) => (sum * sum) / (count + regLambda);

  function build(idx, depth) {
    if (depth >= maxDepth || idx.length < 2 * minSamplesLeaf) return leafOf(idx);

    let sum = 0;
    for (const i of idx) sum += residuals[i];
    const parentScore = score(sum, idx.length);

    let bestGain = 0;
    let bestFeature = -1;
    let bestThreshold = 0;

    for (const f of featCols) {
      // NaN rows always travel left, so fold them into the left stats up front.
      const pairs = [];
      let nanCount = 0;
      let nanSum = 0;
      for (const i of idx) {
        const v = X[i][f];
        if (Number.isNaN(v)) {
          nanCount += 1;
          nanSum += residuals[i];
        } else {
          pairs.push([v, residuals[i]]);
        }
      }
      const m = pairs.length;
      if (m === 0) continue;
      pairs.sort((a, b) => a[0] - b[0]);

      // Candidate thresholds: up to maxThresholds evenly-spaced quantiles.
      const kMax = Math.min(maxThresholds, m);
      const cands = [];
      let prev = NaN;
      for (let k = 1; k <= kMax; k++) {
        const t = pairs[Math.floor((k * (m - 1)) / (kMax + 1))][0];
        if (t !== prev) {
          cands.push(t);
          prev = t;
        }
      }

      // Single sweep: advance a pointer per threshold, deriving child stats
      // from left-side running sums.
      let p = 0;
      let leftSum = nanSum;
      for (const thr of cands) {
        while (p < m && pairs[p][0] <= thr) {
          leftSum += pairs[p][1];
          p += 1;
        }
        const leftCount = nanCount + p;
        const rightCount = idx.length - leftCount;
        if (leftCount < minSamplesLeaf || rightCount < minSamplesLeaf) continue;
        const rightSum = sum - leftSum;
        // XGBoost gain: ½(S_L + S_R − S_parent) − γ.
        const gain = 0.5 * (score(leftSum, leftCount) + score(rightSum, rightCount) - parentScore) - gamma;
        if (gain > 1e-12 && gain > bestGain) {
          bestGain = gain;
          bestFeature = f;
          bestThreshold = thr;
        }
      }
    }

    if (bestFeature < 0) return leafOf(idx);

    const leftIdx = [];
    const rightIdx = [];
    for (const i of idx) {
      const v = X[i][bestFeature];
      if (v <= bestThreshold || Number.isNaN(v)) leftIdx.push(i);
      else rightIdx.push(i);
    }
    return {
      feature: bestFeature,
      threshold: bestThreshold,
      gain: bestGain,
      left: build(leftIdx, depth + 1),
      right: build(rightIdx, depth + 1),
    };
  }

  return build(rowIdx, 0);
}

/** Aggregate per-feature split gains by walking a set of trees. */
function importanceFromTrees(trees, nFeatures) {
  const gains = new Float64Array(nFeatures);
  const walk = (node) => {
    if (!node || !node.left) return;
    gains[node.feature] += node.gain || 0;
    walk(node.left);
    walk(node.right);
  };
  for (const t of trees) walk(t);
  const total = gains.reduce((s, g) => s + g, 0);
  return Array.from(gains, (g) => (total > 0 ? g / total : 0));
}

const rmseOver = (idx, y, preds) => {
  if (idx.length === 0) return 0;
  let sse = 0;
  for (const i of idx) {
    const d = y[i] - preds[i];
    sse += d * d;
  }
  return Math.sqrt(sse / idx.length);
};

/**
 * Train a regularized gradient-boosted tree ensemble (squared loss).
 * @param {number[][]} X rows × features
 * @param {number[]} y targets, one per row
 * @param {{
 *   nTrees?:number, maxDepth?:number, learningRate?:number,
 *   subsample?:number, colsample?:number, minSamplesLeaf?:number,
 *   maxThresholds?:number, regLambda?:number, gamma?:number,
 *   valFraction?:number, earlyStoppingRounds?:number,
 *   seed?:number, onProgress?:((built:number,total:number)=>void)|null,
 * }} [opts]
 * @returns {Promise<{
 *   baseScore:number, learningRate:number, trees:object[],
 *   featureImportance:number[], trainRmse:number[], valRmse:number[],
 *   bestIteration:number
 * }>}
 *   With early stopping the returned `trees` are already truncated to
 *   bestIteration (the val-RMSE minimizer); featureImportance reflects the
 *   kept trees and is normalized to sum to 1.
 */
export async function trainGBDT(X, y, {
  nTrees = 200, maxDepth = 3, learningRate = 0.05, subsample = 0.8,
  colsample = 1, minSamplesLeaf = 20, maxThresholds = 32,
  regLambda = 1, gamma = 0, valFraction = 0, earlyStoppingRounds = 0,
  seed = 42, onProgress = null,
} = {}) {
  const n = X.length;
  const nFeatures = X[0] ? X[0].length : 0;

  // Chronological train/validation split for early stopping (the LAST rows are
  // held out — never shuffled — because this is time-series data).
  const useEarlyStop = earlyStoppingRounds > 0 && valFraction > 0 && valFraction < 0.9;
  const trainCount = useEarlyStop ? Math.max(minSamplesLeaf * 2, Math.floor(n * (1 - valFraction))) : n;
  const trainIdxAll = Array.from({ length: trainCount }, (_, i) => i);
  const valIdx = [];
  for (let i = trainCount; i < n; i += 1) valIdx.push(i);

  const baseScore = trainCount > 0 ? trainIdxAll.reduce((s, i) => s + y[i], 0) / trainCount : 0;
  const preds = new Float64Array(n).fill(baseScore);
  const residuals = new Float64Array(n);
  const rand = mulberry32(seed);
  const params = { maxDepth, minSamplesLeaf, maxThresholds, regLambda, gamma };

  const featCount = Math.max(1, Math.min(nFeatures, Math.round(nFeatures * colsample)));
  const allFeat = Array.from({ length: nFeatures }, (_, i) => i);

  const trees = [];
  const trainRmse = [];
  const valRmse = [];
  const sampleSize = Math.min(trainCount, Math.max(1, Math.round(trainCount * subsample)));
  const rounds = n > 0 ? nTrees : 0;

  let bestVal = Infinity;
  let bestIteration = rounds;
  let sinceBest = 0;

  for (let t = 0; t < rounds; t++) {
    for (const i of trainIdxAll) residuals[i] = y[i] - preds[i];

    // Seeded row subsample (partial Fisher-Yates over the TRAIN rows).
    for (let i = 0; i < sampleSize; i++) {
      const j = i + Math.floor(rand() * (trainCount - i));
      const tmp = trainIdxAll[i];
      trainIdxAll[i] = trainIdxAll[j];
      trainIdxAll[j] = tmp;
    }
    const sampleIdx = trainIdxAll.slice(0, sampleSize);

    // Seeded column subsample (partial Fisher-Yates over the features).
    let featCols = allFeat;
    if (featCount < nFeatures) {
      for (let i = 0; i < featCount; i++) {
        const j = i + Math.floor(rand() * (nFeatures - i));
        const tmp = allFeat[i];
        allFeat[i] = allFeat[j];
        allFeat[j] = tmp;
      }
      featCols = allFeat.slice(0, featCount);
    }

    const tree = buildTree(X, residuals, sampleIdx, featCols, params);
    trees.push(tree);

    // Update running predictions over ALL rows, then record RMSEs.
    for (let i = 0; i < n; i++) preds[i] += learningRate * predictTree(tree, X[i]);
    trainRmse.push(rmseOver(trainIdxAll, y, preds));

    if (useEarlyStop) {
      const vr = rmseOver(valIdx, y, preds);
      valRmse.push(vr);
      if (vr < bestVal - 1e-7) {
        bestVal = vr;
        bestIteration = t + 1;
        sinceBest = 0;
      } else {
        sinceBest += 1;
        if (sinceBest >= earlyStoppingRounds) {
          const built = t + 1;
          if (onProgress) onProgress(built, nTrees);
          break;
        }
      }
    }

    const built = t + 1;
    if (onProgress && (built % 10 === 0 || built === rounds)) {
      onProgress(built, nTrees);
      await new Promise((r) => setTimeout(r, 0)); // let the UI repaint
    }
  }

  // Keep only the best-iteration prefix when early stopping was used.
  const kept = useEarlyStop ? trees.slice(0, bestIteration) : trees;
  const featureImportance = importanceFromTrees(kept, nFeatures);

  return {
    baseScore,
    learningRate,
    trees: kept,
    featureImportance,
    trainRmse,
    valRmse,
    bestIteration: useEarlyStop ? bestIteration : kept.length,
  };
}

/**
 * Predict one row: baseScore + learningRate · Σ tree traversals.
 * @param {{baseScore:number, learningRate:number, trees:object[]}} model
 * @param {number[]} row
 * @returns {number}
 */
export function predictGBDT(model, row) {
  let s = model.baseScore;
  for (const tree of model.trees) s += model.learningRate * predictTree(tree, row);
  return s;
}

export default { trainGBDT, predictGBDT };
