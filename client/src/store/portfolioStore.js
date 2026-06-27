// Zustand portfolio store with localStorage persistence.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { classify } from '../lib/assetType.js';

function nativeCurrencyForType(type) {
  return type === 'th_stock' ? 'THB' : 'USD';
}

function makeId(symbol) {
  const base = (symbol || 'asset').replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
  return `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const usePortfolioStore = create(
  persist(
    (set, get) => ({
      holdings: [],

      /**
       * Add a holding from a search-result-like object.
       * @param {{symbol,name?,type?,currency?,exchange?}} searchResultLike
       * @param {{shares:number, avgCost:number}} position
       */
      addHolding(searchResultLike, position = {}) {
        const sr = searchResultLike || {};
        const symbol = (sr.symbol || '').trim();
        if (!symbol) return;
        const type = sr.type || classify(symbol);
        const currency = sr.currency || nativeCurrencyForType(type);
        const shares = Number(position.shares) || 0;
        const avgCost = Number(position.avgCost) || 0;

        // If the symbol already exists, update it instead of duplicating.
        const existing = get().holdings.find((h) => h.symbol === symbol);
        if (existing) {
          set((state) => ({
            holdings: state.holdings.map((h) =>
              h.id === existing.id
                ? {
                    ...h,
                    shares: shares || h.shares,
                    avgCost: avgCost || h.avgCost,
                    name: sr.name || h.name,
                  }
                : h
            ),
          }));
          return;
        }

        const holding = {
          id: makeId(symbol),
          symbol,
          type,
          name: sr.name || symbol,
          currency,
          shares,
          avgCost,
          addedAt: new Date().toISOString(),
        };
        set((state) => ({ holdings: [...state.holdings, holding] }));
      },

      /**
       * Patch an existing holding by id.
       */
      updateHolding(id, patch) {
        if (!id || !patch) return;
        const clean = { ...patch };
        if ('shares' in clean) clean.shares = Number(clean.shares) || 0;
        if ('avgCost' in clean) clean.avgCost = Number(clean.avgCost) || 0;
        set((state) => ({
          holdings: state.holdings.map((h) =>
            h.id === id ? { ...h, ...clean } : h
          ),
        }));
      },

      /**
       * Remove a holding by id.
       */
      removeHolding(id) {
        set((state) => ({
          holdings: state.holdings.filter((h) => h.id !== id),
        }));
      },

      /**
       * Get the list of distinct symbols in the portfolio.
       */
      getSymbols() {
        return Array.from(new Set(get().holdings.map((h) => h.symbol)));
      },
    }),
    {
      name: 'pt-portfolio',
      version: 1,
    }
  )
);

/**
 * Hook returning the distinct symbols in the portfolio (reactive).
 */
export function useSymbols() {
  return usePortfolioStore((state) =>
    Array.from(new Set(state.holdings.map((h) => h.symbol)))
  );
}
