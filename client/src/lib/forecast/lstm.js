// LSTM wrapper around TensorFlow.js for the Forecast page.
//
// The `tf` module is injected (the page lazy-loads @tensorflow/tfjs in a
// separate chunk so the main bundle stays lean). Features are standardized
// with train-set statistics; the network is a small LSTM -> dropout -> dense
// head predicting the next-day log return from a sliding window of feature
// rows. Training yields to the browser every epoch so the UI stays live.

/**
 * Standardize columns to zero mean / unit variance using given stats.
 */
function normalizeRows(rows, means, stds) {
  return rows.map((r) => r.map((v, j) => (v - means[j]) / stds[j]));
}

function columnStats(rows) {
  const f = rows[0].length;
  const means = new Array(f).fill(0);
  const stds = new Array(f).fill(0);
  for (const r of rows) for (let j = 0; j < f; j += 1) means[j] += r[j];
  for (let j = 0; j < f; j += 1) means[j] /= rows.length;
  for (const r of rows) for (let j = 0; j < f; j += 1) stds[j] += (r[j] - means[j]) ** 2;
  for (let j = 0; j < f; j += 1) {
    stds[j] = Math.sqrt(stds[j] / Math.max(1, rows.length - 1));
    if (!(stds[j] > 1e-9)) stds[j] = 1; // constant column — leave centered
  }
  return { means, stds };
}

/**
 * Train an LSTM on sliding windows of feature rows.
 * @param {object} tf — the imported @tensorflow/tfjs module
 * @param {number[][]} rows — feature rows (time-ordered)
 * @param {number[]} targets — next-day log return aligned to rows
 * @param {{window?:number, units?:number, epochs?:number, batchSize?:number,
 *          learningRate?:number, validationSplit?:number,
 *          onEpoch?:(epoch:number, total:number, loss:number, valLoss:number|null)=>void}} opts
 * @returns {Promise<{
 *   predictOne:(rowsHistory:number[][]) => number,
 *   history:{loss:number[], valLoss:number[]},
 *   window:number, dispose:() => void
 * }>}
 */
export async function trainLSTM(tf, rows, targets, opts = {}) {
  const {
    window = 30,
    units = 32,
    epochs = 40,
    batchSize = 32,
    learningRate = 0.005,
    validationSplit = 0.1,
    onEpoch = null,
  } = opts;

  if (rows.length - window < 60) {
    throw new Error(`LSTM needs at least ${window + 60} feature rows — got ${rows.length}. Use a longer range or a smaller window.`);
  }

  const { means, stds } = columnStats(rows);
  const norm = normalizeRows(rows, means, stds);
  const f = norm[0].length;

  // Sliding windows: sample i = rows [i-window+1 .. i] -> targets[i].
  const xs = [];
  const ys = [];
  for (let i = window - 1; i < norm.length; i += 1) {
    xs.push(norm.slice(i - window + 1, i + 1));
    ys.push(targets[i]);
  }

  // Scale the target so MSE gradients aren't vanishingly small (daily returns
  // are ~1e-2); predictions are scaled back on the way out.
  const Y_SCALE = 100;
  const xT = tf.tensor3d(xs, [xs.length, window, f]);
  const yT = tf.tensor2d(ys.map((v) => [v * Y_SCALE]), [ys.length, 1]);

  const model = tf.sequential();
  model.add(tf.layers.lstm({ units, inputShape: [window, f] }));
  model.add(tf.layers.dropout({ rate: 0.1 }));
  model.add(tf.layers.dense({ units: 1 }));
  model.compile({ optimizer: tf.train.adam(learningRate), loss: 'meanSquaredError' });

  const history = { loss: [], valLoss: [] };
  await model.fit(xT, yT, {
    epochs,
    batchSize,
    validationSplit,
    shuffle: true,
    verbose: 0,
    callbacks: {
      onEpochEnd: async (epoch, logs) => {
        history.loss.push(logs.loss);
        history.valLoss.push(logs.val_loss ?? null);
        if (onEpoch) onEpoch(epoch + 1, epochs, logs.loss, logs.val_loss ?? null);
        await tf.nextFrame(); // let the browser paint the progress bar
      },
    },
  });
  xT.dispose();
  yT.dispose();

  function predictOne(rowsHistory) {
    if (rowsHistory.length < window) return 0;
    const win = normalizeRows(rowsHistory.slice(-window), means, stds);
    return tf.tidy(() => {
      const out = model.predict(tf.tensor3d([win], [1, window, f]));
      return out.dataSync()[0] / Y_SCALE;
    });
  }

  return { predictOne, history, window, dispose: () => model.dispose() };
}

export default { trainLSTM };
