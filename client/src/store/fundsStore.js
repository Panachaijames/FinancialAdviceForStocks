// Zustand store for tracked Thai mutual funds (RMF/LTF/SSF/etc.), persisted.
// NAVs are in THB (Thai funds), fetched live from the SEC API via useFunds.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

function makeId(projId) {
  return `fund-${(projId || 'x').replace(/[^A-Za-z0-9]/g, '')}-${Math.random().toString(36).slice(2, 6)}`;
}

export const useFundsStore = create(
  persist(
    (set, get) => ({
      funds: [], // [{ id, projId, abbr, name, units, avgCost }]

      addFund(fund) {
        const projId = fund && fund.projId;
        if (!projId) return;
        if (get().funds.some((f) => f.projId === projId)) return; // no dupes
        set((state) => ({
          funds: [
            ...state.funds,
            {
              id: makeId(projId),
              projId,
              abbr: fund.abbr || projId,
              name: fund.nameEn || fund.nameTh || fund.abbr || projId,
              units: Number(fund.units) || 0,
              avgCost: Number(fund.avgCost) || 0,
              addedAt: new Date().toISOString(),
            },
          ],
        }));
      },

      updateFund(id, patch) {
        if (!id || !patch) return;
        const clean = { ...patch };
        if ('units' in clean) clean.units = Number(clean.units) || 0;
        if ('avgCost' in clean) clean.avgCost = Number(clean.avgCost) || 0;
        set((state) => ({ funds: state.funds.map((f) => (f.id === id ? { ...f, ...clean } : f)) }));
      },

      removeFund(id) {
        set((state) => ({ funds: state.funds.filter((f) => f.id !== id) }));
      },
    }),
    { name: 'pt-funds', version: 1 }
  )
);

export default useFundsStore;
