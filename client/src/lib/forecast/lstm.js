// LSTM wrapper around TensorFlow.js for the Forecast page — an architecture
// tuned for noisy, fat-tailed daily financial returns rather than a textbook
// single-layer net:
//   • A single LSTM layer by default (fast + reliable in the browser), with
//     optional 2-layer stacking (opts.layers = 2). We deliberately avoid the
//     LSTM layers' built-in dropout/recurrentDropout AND the default orthogonal
//     recurrent initializer — in TensorFlow.js/WebGL those make training many
//     times slower (or stall model build) — using Dropout LAYERS + a Glorot
//     recurrent init instead.
//   • A small ReLU dense head before the linear output.
//   • L2 weight regularization.
//   • MAE loss instead of MSE — its linear tail is robust to the occasional
//     huge return spike (earnings gaps, crashes) that would dominate MSE
//     gradients, and unlike a custom Huber closure it keeps TensorFlow.js's
//     fast compiled training path (a JS loss function makes it ~10x slower).
//   • Early stopping on validation loss (chronological split — the last slice
//     of windows is held out, never shuffled into training), so training stops
//     when generalization stalls instead of memorizing the training tail.
//
// The `tf` module is injected (lazy-loaded chunk). Interface is unchanged:
// trainLSTM(tf, rows, targets, opts) -> { predictOne, history, window, dispose }.

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
    if (!(stds[j] > 1e-9)) stds[j] = 1;
  }
  return { means, stds };
}

/**
 * Train the LSTM on sliding windows of feature rows.
 * @param {object} tf @tensorflow/tfjs module
 * @param {number[][]} rows feature rows (time-ordered)
 * @param {number[]} targets next-day log return aligned to rows
 * @param {object} opts
 * @param {number} [opts.window=30] sequence length
 * @param {number} [opts.units=32] hidden units in the first LSTM layer
 * @param {number} [opts.epochs=60] max epochs (early stopping may end sooner)
 * @param {number} [opts.batchSize=32]
 * @param {number} [opts.learningRate=0.005]
 * @param {number} [opts.validationSplit=0.15]
 * @param {number} [opts.layers=1] 1 or 2 stacked LSTM layers (1 is much faster)
 * @param {number} [opts.dropout=0.2] regular + recurrent dropout rate
 * @param {number} [opts.l2=1e-4] L2 weight penalty
 * @param {number} [opts.patience=8] early-stopping patience (0 disables)
 * @param {(epoch:number,total:number,loss:number,valLoss:number|null)=>void} [opts.onEpoch]
 * @returns {Promise<{predictOne:(rowsHistory:number[][])=>number,
 *   history:{loss:number[],valLoss:number[],stoppedEpoch:number|null,epochs:number},
 *   window:number, dispose:()=>void}>}
 */
export async function trainLSTM(tf, rows, targets, opts = {}) {
  const {
    window = 30,
    units = 32,
    epochs = 60,
    batchSize = 32,
    learningRate = 0.005,
    validationSplit = 0.15,
    layers = 1,
    dropout = 0.2,
    l2 = 1e-4,
    patience = 8,
    onEpoch = null,
  } = opts;

  if (rows.length - window < 60) {
    throw new Error(`LSTM needs at least ${window + 60} feature rows — got ${rows.length}. Use a longer range or a smaller window.`);
  }

  const { means, stds } = columnStats(rows);
  const norm = normalizeRows(rows, means, stds);
  const f = norm[0].length;

  const xs = [];
  const ys = [];
  for (let i = window - 1; i < norm.length; i += 1) {
    xs.push(norm.slice(i - window + 1, i + 1));
    ys.push(targets[i]);
  }

  // Scale the target (~1e-2 daily returns) so gradients aren't vanishing.
  const Y_SCALE = 100;
  const xT = tf.tensor3d(xs, [xs.length, window, f]);
  const yT = tf.tensor2d(ys.map((v) => [v * Y_SCALE]), [ys.length, 1]);

  const model = tf.sequential();
  const stacked = layers >= 2;
  // recurrentInitializer defaults to 'orthogonal', whose GPU QR decomposition
  // is extremely slow in TensorFlow.js (it warns "Slowness may result" on
  // matrices > 2000 elements and can stall model build for tens of seconds).
  // Glorot is a fine, fast alternative for this size of net.
  const RECURRENT_INIT = 'glorotUniform';
  model.add(
    tf.layers.lstm({
      units,
      inputShape: [window, f],
      returnSequences: stacked,
      recurrentInitializer: RECURRENT_INIT,
      kernelRegularizer: tf.regularizers.l2({ l2 }),
    })
  );
  model.add(tf.layers.dropout({ rate: dropout }));
  if (stacked) {
    model.add(
      tf.layers.lstm({
        units: Math.max(8, Math.floor(units / 2)),
        returnSequences: false,
        recurrentInitializer: RECURRENT_INIT,
        kernelRegularizer: tf.regularizers.l2({ l2 }),
      })
    );
    model.add(tf.layers.dropout({ rate: dropout }));
  }
  model.add(tf.layers.dense({ units: Math.max(8, Math.floor(units / 2)), activation: 'relu', kernelRegularizer: tf.regularizers.l2({ l2 }) }));
  model.add(tf.layers.dense({ units: 1 }));

  model.compile({
    optimizer: tf.train.adam(learningRate),
    // MAE: robust to return spikes; built-in string keeps the fast fit path.
    loss: 'meanAbsoluteError',
  });

  // Manual early stopping: we track the best validation loss inside our own
  // onEpochEnd and call model.stopTraining = true. (We deliberately do NOT use
  // tf.callbacks.earlyStopping mixed into the callbacks array — combining a
  // BaseCallback instance with a plain-object callback breaks tfjs's callback
  // list and stalls training. A single object callback is the reliable form.)
  const history = { loss: [], valLoss: [], stoppedEpoch: null, epochs: 0 };
  let bestVal = Infinity;
  let bestEpoch = 0;
  const usePatience = patience > 0 && validationSplit > 0;

  await model.fit(xT, yT, {
    epochs,
    batchSize,
    validationSplit,
    shuffle: true, // shuffles TRAIN batches only; the val split is the last slice, taken pre-shuffle
    verbose: 0,
    callbacks: {
      onEpochEnd: async (epoch, logs) => {
        history.loss.push(logs.loss);
        const valLoss = logs.val_loss ?? null;
        history.valLoss.push(valLoss);
        history.epochs = epoch + 1;
        if (onEpoch) onEpoch(epoch + 1, epochs, logs.loss, valLoss);
        if (usePatience && valLoss != null) {
          if (valLoss < bestVal - 1e-4) {
            bestVal = valLoss;
            bestEpoch = epoch;
          } else if (epoch - bestEpoch >= patience) {
            history.stoppedEpoch = epoch + 1;
            model.stopTraining = true;
          }
        }
        // Yield with setTimeout (NOT tf.nextFrame — rAF is starved in hidden
        // tabs, which would silently stall training there).
        await new Promise((r) => setTimeout(r, 0));
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
