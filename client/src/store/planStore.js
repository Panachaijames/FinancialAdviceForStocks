// Zustand store for the Retirement & Financial Freedom planner inputs,
// persisted to localStorage (pt-plan) so the plan survives reloads and app
// restarts, and included in the one-time cross-device transfer (lib/sync.js).
//
// Values are kept as the raw strings the user typed (same as the previous
// useState fields) so the controlled inputs behave identically; the planner
// converts to numbers when projecting.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { RETIREMENT_DEFAULTS } from '../lib/retirement.js';

export const PLAN_DEFAULTS = {
  currentAge: '30',
  retireAge: String(RETIREMENT_DEFAULTS.retireAge),
  endAge: String(RETIREMENT_DEFAULTS.endAge),
  useNet: true,
  startManual: '',
  monthly: '15000',
  expense: '30000',
  pension: '',
  preReturn: String(RETIREMENT_DEFAULTS.preReturnPct),
  postReturn: String(RETIREMENT_DEFAULTS.postReturnPct),
  inflation: String(RETIREMENT_DEFAULTS.inflationPct),
  swr: String(RETIREMENT_DEFAULTS.swrPct),
  invTax: String(RETIREMENT_DEFAULTS.investmentTaxPct),
  // Refinements ("More variables") — empty = default behavior.
  contributionGrowth: '',
  retireSpendPct: '',
  pensionStartAge: '',
  lumpSum: '',
  lumpSumAge: '',
  careBumpPct: '',
  careFromAge: '',
};

export const usePlanStore = create(
  persist(
    (set) => ({
      ...PLAN_DEFAULTS,

      /** Set one planner field (raw string; booleans pass through). */
      setField(key, value) {
        if (!(key in PLAN_DEFAULTS)) return;
        set({ [key]: value });
      },

      /** Reset the whole plan to defaults. */
      resetPlan() {
        set({ ...PLAN_DEFAULTS });
      },
    }),
    { name: 'pt-plan', version: 1 }
  )
);

export default usePlanStore;
