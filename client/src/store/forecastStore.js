// Zustand store for the Forecast lab, persisted to localStorage (pt-forecast):
// the control settings (so the lab reopens exactly as you left it) and a run
// history — what was trained, with which hyperparameters, how many epochs/
// trees actually completed, and how each model scored. Capped at the last 20
// runs so localStorage stays small.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const FORECAST_DEFAULTS = {
  symbol: '',
  range: '2y',
  horizon: 30,
  models: { arima: true, gbdt: true, lstm: true },
  // news defaults off — it's US-equity-only and adds a fetch; opt in per run.
  feats: { technical: true, macro: true, calendar: true, news: false },
  params: {
    arimaAuto: true, arimaP: '5', arimaQ: '1', arimaMaxP: '5', arimaMaxQ: '5',
    trees: '300', depth: '3', lr: '0.05',
    // XGBoost regularization knobs (real reg_lambda / gamma / colsample_bytree)
    // + early stopping to auto-pick the tree count.
    regLambda: '1', gamma: '0', colsample: '0.8', earlyStop: '40',
    window: '30', units: '32', epochs: '60',
  },
};

const MAX_RUNS = 20;

export const useForecastStore = create(
  persist(
    (set) => ({
      ...FORECAST_DEFAULTS,
      runs: [], // newest first: { id, at, symbol, range, horizon, durationMs, nFeatures, nSamples, models:[{key,label,detail,dirAcc,rmse}], returns:{arima?,gbdt?,lstm?,ensemble?} }

      setSetting(key, value) {
        if (!(key in FORECAST_DEFAULTS)) return;
        set({ [key]: value });
      },

      /** Merge a patch into a nested settings object (models/feats/params). */
      patchSetting(key, patch) {
        if (!['models', 'feats', 'params'].includes(key)) return;
        set((state) => ({ [key]: { ...state[key], ...patch } }));
      },

      addRun(run) {
        if (!run || !run.symbol) return;
        const entry = {
          id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          at: new Date().toISOString(),
          ...run,
        };
        set((state) => ({ runs: [entry, ...state.runs].slice(0, MAX_RUNS) }));
      },

      clearRuns() {
        set({ runs: [] });
      },
    }),
    {
      name: 'pt-forecast',
      version: 1,
      // Deep-merge persisted state over the defaults so newly-added nested keys
      // (e.g. XGBoost λ/γ/colsample/early-stop, the news feature toggle) always
      // pick up their defaults for users who saved an older shape. (merge runs
      // on every rehydration — no version bump needed, which would instead
      // DISCARD old state when no migrate() is supplied.)
      merge: (persisted, current) => {
        const p = persisted || {};
        return {
          ...current,
          ...p,
          models: { ...current.models, ...(p.models || {}) },
          feats: { ...current.feats, ...(p.feats || {}) },
          params: { ...current.params, ...(p.params || {}) },
        };
      },
    }
  )
);

export default useForecastStore;
