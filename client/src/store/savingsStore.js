// Zustand store for cash / savings balances (separate from market holdings),
// persisted to localStorage. Used for Net Worth = investments + cash.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

function makeId() {
  return `cash-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useSavingsStore = create(
  persist(
    (set) => ({
      savings: [], // [{ id, label, amount, currency }]

      addSaving({ label, amount, currency } = {}) {
        const amt = Number(amount) || 0;
        if (amt <= 0) return;
        const entry = {
          id: makeId(),
          label: (label || 'Savings').trim() || 'Savings',
          amount: amt,
          currency: currency === 'THB' ? 'THB' : 'USD',
          addedAt: new Date().toISOString(),
        };
        set((state) => ({ savings: [...state.savings, entry] }));
      },

      updateSaving(id, patch) {
        if (!id || !patch) return;
        const clean = { ...patch };
        if ('amount' in clean) clean.amount = Number(clean.amount) || 0;
        set((state) => ({
          savings: state.savings.map((s) => (s.id === id ? { ...s, ...clean } : s)),
        }));
      },

      removeSaving(id) {
        set((state) => ({ savings: state.savings.filter((s) => s.id !== id) }));
      },
    }),
    { name: 'pt-savings', version: 1 }
  )
);

export default useSavingsStore;
