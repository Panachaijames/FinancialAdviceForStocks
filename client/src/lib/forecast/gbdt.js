// Gradient boosting in the style of XGBoost — squared-loss regression trees
// in pure JS, used client-side to predict next-day returns from tabular
// features. This is NOT a binding of the XGBoost library: it reimplements the
// core recipe (exact greedy variance-reduction splits over quantile candidate
// thresholds, shrinkage, seeded row subsampling) with zero dependencies so it
// runs in the browser and is deterministic for a given seed.

/**
 * Seeded PRNG (mulberry32). Returns a function yielding floats in [0, 1).
 * @param {number} seed
 * @returns {() => number}
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

/**
 * Traverse one tree for one row. Missing/NaN feature values go left,
 * matching the split rule used during training.
 * @param {object} node — tree root ({feature,threshold,left,right} | {value})
 * @param {number[]} row — feature vector
 * @returns {number} raw leaf value (no shrinkage applied)
 */
function predictTree(node, row) {
  while (node.left) {
    const v = row[node.feature];
    node = v <= node.threshold || Number.isNaN(v) ? node.left : node.right;
  }
  return node.value;
}

/**
 * Build one regression tree on the residuals of the given rows.
 * Splits maximize SSE reduction (parent SSE − left SSE − right SSE), which
 * for squared loss is exactly variance reduction; SSEs come from running
 * sums/sum-of-squares so each candidate threshold is O(1) after a sort.
 * @param {number[][]} X — full feature matrix
 * @param {Float64Array} residuals — current residual per row of X
 * @param {number[]} rowIdx — indices of the (subsampled) rows to fit
 * @param {{maxDepth:number, minSamplesLeaf:number, maxThresholds:number}} params
 * @param {Float64Array} gains — per-feature accumulator for split gains (mutated)
 * @returns {object} tree root node
 */
function buildTree(X, residuals, rowIdx, params, gains) {
  const { maxDepth, minSamplesLeaf, maxThresholds } = params;
  const nFeatures = X[0] ? X[0].length : 0;

  function leafOf(idx) {
    let s = 0;
    for (const i of idx) s += residuals[i];
    return { value: idx.length > 0 ? s / idx.length : 0 };
  }

  function build(idx, depth) {
    if (depth >= maxDepth || idx.length < 2 * minSamplesLeaf) return leafOf(idx);

    let sum = 0;
    let sumSq = 0;
    for (const i of idx) {
      const r = residuals[i];
      sum += r;
      sumSq += r * r;
    }
    const parentSSE = sumSq - (sum * sum) / idx.length;

    let bestGain = 0;
    let bestFeature = -1;
    let bestThreshold = 0;

    for (let f = 0; f < nFeatures; f++) {
      // NaN rows always travel left, so fold them into the left stats up front.
      const pairs = [];
      let nanCount = 0;
      let nanSum = 0;
      let nanSumSq = 0;
      for (const i of idx) {
        const v = X[i][f];
        if (Number.isNaN(v)) {
          const r = residuals[i];
          nanCount += 1;
          nanSum += r;
          nanSumSq += r * r;
        } else {
          pairs.push([v, residuals[i]]);
        }
      }
      const m = pairs.length;
      if (m === 0) continue;
      pairs.sort((a, b) => a[0] - b[0]);

      // Candidate thresholds: up to maxThresholds evenly-spaced quantiles of
      // this feature among the node's rows, deduplicated.
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

      // Single sweep over the sorted rows: advance a pointer per threshold
      // and derive both children's SSE from left-side sums/sum-of-squares.
      let p = 0;
      let leftSum = nanSum;
      let leftSumSq = nanSumSq;
      for (const thr of cands) {
        while (p < m && pairs[p][0] <= thr) {
          const r = pairs[p][1];
          leftSum += r;
          leftSumSq += r * r;
          p += 1;
        }
        const leftCount = nanCount + p;
        const rightCount = idx.length - leftCount;
        if (leftCount < minSamplesLeaf || rightCount < minSamplesLeaf) continue;
        const rightSum = sum - leftSum;
        const rightSumSq = sumSq - leftSumSq;
        const leftSSE = leftSumSq - (leftSum * leftSum) / leftCount;
        const rightSSE = rightSumSq - (rightSum * rightSum) / rightCount;
        const gain = parentSSE - leftSSE - rightSSE;
        if (gain > 1e-12 && gain > bestGain) {
          bestGain = gain;
          bestFeature = f;
          bestThreshold = thr;
        }
      }
    }

    if (bestFeature < 0) return leafOf(idx);

    gains[bestFeature] += bestGain;
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
      left: build(leftIdx, depth + 1),
      right: build(rightIdx, depth + 1),
    };
  }

  return build(rowIdx, 0);
}

/**
 * Train a gradient-boosted tree ensemble with squared loss.
 * Starts from baseScore = mean(y); each tree fits the current residuals on a
 * seeded row subsample and its output is added with shrinkage (learningRate).
 * Async so a browser UI can repaint between progress callbacks.
 * @param {number[][]} X — rows × features
 * @param {number[]} y — targets, one per row
 * @param {{
 *   nTrees?: number, maxDepth?: number, learningRate?: number,
 *   subsample?: number, minSamplesLeaf?: number, maxThresholds?: number,
 *   seed?: number, onProgress?: ((built:number, total:number) => void)|null,
 * }} [opts]
 * @returns {Promise<{
 *   baseScore:number, learningRate:number, trees:object[],
 *   featureImportance:number[], trainRmse:number[]
 * }>} featureImportance is normalized to sum to 1 (uniform zeros if no
 *   split ever gained); trainRmse holds rmse(y, preds) after each tree.
 */
export async function trainGBDT(X, y, {
  nTrees = 200, maxDepth = 3, learningRate = 0.05, subsample = 0.8,
  minSamplesLeaf = 20, maxThresholds = 32, seed = 42, onProgress = null,
} = {}) {
  const n = X.length;
  const nFeatures = X[0] ? X[0].length : 0;
  const baseScore = n > 0 ? y.reduce((s, v) => s + v, 0) / n : 0;

  const preds = new Float64Array(n).fill(baseScore);
  const residuals = new Float64Array(n);
  const gains = new Float64Array(nFeatures);
  const rand = mulberry32(seed);
  const params = { maxDepth, minSamplesLeaf, maxThresholds };
  const trees = [];
  const trainRmse = [];
  const allIdx = Array.from({ length: n }, (_, i) => i);
  const sampleSize = Math.min(n, Math.max(1, Math.round(n * subsample)));
  const rounds = n > 0 ? nTrees : 0;

  for (let t = 0; t < rounds; t++) {
    for (let i = 0; i < n; i++) residuals[i] = y[i] - preds[i];

    // Seeded row subsample: partial Fisher-Yates, take the first sampleSize.
    for (let i = 0; i < sampleSize; i++) {
      const j = i + Math.floor(rand() * (n - i));
      const tmp = allIdx[i];
      allIdx[i] = allIdx[j];
      allIdx[j] = tmp;
    }
    const sampleIdx = allIdx.slice(0, sampleSize);

    const tree = buildTree(X, residuals, sampleIdx, params, gains);
    trees.push(tree);

    // Update running predictions over ALL rows, then record training RMSE.
    let sse = 0;
    for (let i = 0; i < n; i++) {
      preds[i] += learningRate * predictTree(tree, X[i]);
      const d = y[i] - preds[i];
      sse += d * d;
    }
    trainRmse.push(Math.sqrt(sse / n));

    const built = t + 1;
    if (onProgress && (built % 10 === 0 || built === rounds)) {
      onProgress(built, nTrees);
      await new Promise((r) => setTimeout(r, 0)); // let the UI repaint
    }
  }

  const totalGain = gains.reduce((s, g) => s + g, 0);
  const featureImportance = Array.from(gains, (g) => (totalGain > 0 ? g / totalGain : 0));

  return { baseScore, learningRate, trees, featureImportance, trainRmse };
}

/**
 * Predict one row with a trained model:
 * baseScore + learningRate · Σ tree traversals.
 * @param {{baseScore:number, learningRate:number, trees:object[]}} model
 * @param {number[]} row — feature vector
 * @returns {number}
 */
export function predictGBDT(model, row) {
  let s = model.baseScore;
  for (const tree of model.trees) s += model.learningRate * predictTree(tree, row);
  return s;
}

export default { trainGBDT, predictGBDT };
