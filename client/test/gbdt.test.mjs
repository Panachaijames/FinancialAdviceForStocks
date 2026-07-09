// Unit tests for the gradient-boosted trees lib (client/src/lib/forecast/gbdt.js).
// All randomness is seeded (mulberry32 implemented inline) so runs are
// deterministic. Run with:  node --test client/test/gbdt.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trainGBDT, predictGBDT } from '../src/lib/forecast/gbdt.js';

// ── seeded helpers ──────────────────────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller on a seeded uniform PRNG. */
function gaussian(rand) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function makeRows(n, nFeatures, rand) {
  return Array.from({ length: n }, () =>
    Array.from({ length: nFeatures }, () => rand())
  );
}

function rmse(yTrue, yPred) {
  let sse = 0;
  for (let i = 0; i < yTrue.length; i++) {
    const d = yTrue[i] - yPred[i];
    sse += d * d;
  }
  return Math.sqrt(sse / yTrue.length);
}

function treeDepth(node) {
  if (!node.left) return 0;
  return 1 + Math.max(treeDepth(node.left), treeDepth(node.right));
}

// ── tests ───────────────────────────────────────────────────────────────────

test('step function: low train RMSE and importance concentrated on x0', async () => {
  const rand = mulberry32(1);
  const X = makeRows(600, 4, rand);
  const y = X.map((row) => (row[0] > 0.5 ? 1 : -1));

  const model = await trainGBDT(X, y, { nTrees: 150, seed: 42 });

  const finalRmse = model.trainRmse[model.trainRmse.length - 1];
  assert.ok(finalRmse < 0.15, `final trainRmse ${finalRmse} should be < 0.15`);
  assert.ok(
    model.featureImportance[0] > 0.8,
    `featureImportance[0] ${model.featureImportance[0]} should be > 0.8`
  );
  const impSum = model.featureImportance.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(impSum - 1) < 1e-9, 'importance sums to 1');
});

test('nonlinear target: holdout RMSE < 0.25 on fresh seeded rows', async () => {
  const target = (row, noise) => Math.sin(3 * row[0]) + 0.5 * row[1] + noise;

  const randTrain = mulberry32(7);
  const Xtrain = makeRows(500, 4, randTrain);
  const yTrain = Xtrain.map((row) => target(row, 0.05 * gaussian(randTrain)));

  const randTest = mulberry32(99);
  const Xtest = makeRows(200, 4, randTest);
  const yTest = Xtest.map((row) => target(row, 0.05 * gaussian(randTest)));

  const model = await trainGBDT(Xtrain, yTrain, { nTrees: 300, seed: 42 });
  const preds = Xtest.map((row) => predictGBDT(model, row));
  const holdout = rmse(yTest, preds);
  assert.ok(holdout < 0.25, `holdout RMSE ${holdout} should be < 0.25`);
});

test('trainRmse improves: last entry < first entry', async () => {
  const rand = mulberry32(3);
  const X = makeRows(300, 3, rand);
  const y = X.map((row) => 2 * row[0] - row[1]);

  const model = await trainGBDT(X, y, { nTrees: 50, seed: 42 });
  assert.equal(model.trainRmse.length, 50);
  assert.ok(
    model.trainRmse[49] < model.trainRmse[0],
    `rmse should fall: first ${model.trainRmse[0]}, last ${model.trainRmse[49]}`
  );
});

test('determinism: same seed reproduces, different seed diverges', async () => {
  const rand = mulberry32(11);
  const X = makeRows(300, 4, rand);
  const y = X.map((row) => (row[0] > 0.5 ? 1 : -1) + 0.3 * row[2]);
  const probes = makeRows(5, 4, mulberry32(1234));

  const a = await trainGBDT(X, y, { nTrees: 40, seed: 42 });
  const b = await trainGBDT(X, y, { nTrees: 40, seed: 42 });
  const c = await trainGBDT(X, y, { nTrees: 40, seed: 43 });

  for (const p of probes) {
    assert.equal(predictGBDT(a, p), predictGBDT(b, p), 'same seed -> identical prediction');
  }
  const anyDiff = probes.some((p) => predictGBDT(a, p) !== predictGBDT(c, p));
  assert.ok(anyDiff, 'different seed should (very likely) change some prediction');
});

test('nTrees=0: predictGBDT returns baseScore exactly', async () => {
  const rand = mulberry32(5);
  const X = makeRows(50, 2, rand);
  const y = X.map((row) => row[0] + row[1]);
  const mean = y.reduce((s, v) => s + v, 0) / y.length;

  const model = await trainGBDT(X, y, { nTrees: 0 });
  assert.equal(model.trees.length, 0);
  assert.equal(model.trainRmse.length, 0);
  assert.equal(model.baseScore, mean);
  assert.equal(predictGBDT(model, [0.3, 0.7]), mean);
});

test('onProgress: called every 10 trees and on the last, ending at (nTrees, nTrees)', async () => {
  const rand = mulberry32(9);
  const X = makeRows(100, 3, rand);
  const y = X.map((row) => row[0]);

  const calls = [];
  const nTrees = 25;
  await trainGBDT(X, y, { nTrees, onProgress: (built, total) => calls.push([built, total]) });

  assert.deepEqual(calls, [[10, 25], [20, 25], [25, 25]]);
  assert.deepEqual(calls[calls.length - 1], [nTrees, nTrees]);
});

test('minSamplesLeaf respected: 200-row leaves on 300 rows keep every tree depth <= 1', async () => {
  const rand = mulberry32(21);
  const X = makeRows(300, 3, rand);
  const y = X.map((row) => (row[0] > 0.5 ? 1 : -1));

  const model = await trainGBDT(X, y, { nTrees: 30, minSamplesLeaf: 200, seed: 42 });
  for (const tree of model.trees) {
    assert.ok(treeDepth(tree) <= 1, `tree depth ${treeDepth(tree)} should be <= 1`);
  }
});

// ── XGBoost regularization + early stopping ─────────────────────────────────

test('regLambda shrinks leaf weights toward zero', async () => {
  const rand = mulberry32(3);
  const X = makeRows(400, 3, rand);
  const y = X.map((row) => (row[0] > 0.5 ? 1 : -1));
  // One tree, no shrinkage, so leaf values are directly comparable.
  const noReg = await trainGBDT(X, y, { nTrees: 1, learningRate: 1, regLambda: 0, subsample: 1, seed: 7 });
  const bigReg = await trainGBDT(X, y, { nTrees: 1, learningRate: 1, regLambda: 500, subsample: 1, seed: 7 });
  const leaves = (node, out = []) => { if (node.left) { leaves(node.left, out); leaves(node.right, out); } else out.push(Math.abs(node.value)); return out; };
  const maxNo = Math.max(...leaves(noReg.trees[0]));
  const maxBig = Math.max(...leaves(bigReg.trees[0]));
  assert.ok(maxBig < maxNo, `lambda should shrink leaves: ${maxBig} < ${maxNo}`);
});

test('gamma (min split gain) prunes weak splits down to a stump/leaf', async () => {
  const rand = mulberry32(5);
  const X = makeRows(400, 3, rand);
  const y = X.map((row) => (row[0] > 0.5 ? 1 : -1));
  const treeDepth = (node) => (node.left ? 1 + Math.max(treeDepth(node.left), treeDepth(node.right)) : 0);
  // A huge gamma makes no split worth its complexity cost -> leaf-only trees.
  const model = await trainGBDT(X, y, { nTrees: 5, gamma: 1e6, seed: 9 });
  for (const t of model.trees) assert.equal(treeDepth(t), 0);
});

test('colsample < 1 still learns the dominant feature and stays deterministic', async () => {
  const rand = mulberry32(13);
  const X = makeRows(500, 6, rand);
  const y = X.map((row) => (row[0] > 0.5 ? 1 : -1));
  const a = await trainGBDT(X, y, { nTrees: 120, colsample: 0.5, seed: 42 });
  const b = await trainGBDT(X, y, { nTrees: 120, colsample: 0.5, seed: 42 });
  assert.deepEqual(a.featureImportance, b.featureImportance); // deterministic
  // x0 drives y, so even with half the columns sampled it should dominate.
  const top = a.featureImportance.indexOf(Math.max(...a.featureImportance));
  assert.equal(top, 0);
});

test('early stopping picks a bestIteration and truncates the ensemble', async () => {
  const rand = mulberry32(17);
  // Signal only in the first ~150 rows' relationship; later rows are noisier so
  // validation stops improving well before nTrees.
  const X = makeRows(600, 4, rand);
  const y = X.map((row) => Math.sin(3 * row[0]) + 0.3 * row[1] + (rand() - 0.5) * 0.2);
  const model = await trainGBDT(X, y, {
    nTrees: 400, learningRate: 0.1, valFraction: 0.2, earlyStoppingRounds: 15, seed: 1,
  });
  assert.ok(model.bestIteration >= 1);
  assert.ok(model.bestIteration <= 400);
  assert.equal(model.trees.length, model.bestIteration); // truncated to best
  assert.ok(model.valRmse.length >= model.bestIteration);
  // The kept ensemble is the val-RMSE minimizer among what was recorded.
  const minVal = Math.min(...model.valRmse);
  assert.ok(Math.abs(model.valRmse[model.bestIteration - 1] - minVal) < 1e-9);
});
