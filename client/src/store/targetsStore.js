// Zustand store for target allocation weights (percent per asset type),
// persisted to localStorage (pt-targets). Used by the rebalance helper.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useTargetsStore = create(
  persist(
    (set) => ({
      targets: {}, // { us_stock: 50, th_stock: 30, gold: 10, cash: 10, ... }

      /** Set one type's target percent (0 clears it). */
      setTarget(type, pct) {
        if (!type) return;
        const v = Number(pct);
        set((state) => {
          const targets = { ...state.targets };
          if (Number.isFinite(v) && v > 0) targets[type] = v;
          else delete targets[type];
          return { targets };
        });
      },

      clearTargets() {
        set({ targets: {} });
      },
    }),
    { name: 'pt-targets', version: 1 }
  )
);

export default useTargetsStore;
