// Zustand portfolio store with localStorage persistence.
//
// Two collections: `holdings` (current positions, authoritative) and
// `transactions` (the trade ledger — what the user DID at their broker, so the
// app can compute realized P/L; it never places real orders). Buys/sells go
// through recordTrade(), which updates the position with average-cost math
// (lib/trades.js) and appends a ledger entry that snapshots the prior position
// so the latest trade per symbol can be undone safely.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { classify } from '../lib/assetType.js';
import { applyBuy, applySell } from '../lib/trades.js';

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
      transactions: [], // [{ id, symbol, side:'buy'|'sell', qty, price, fee, currency, at, realized?, costBasis?, prevShares, prevAvgCost }]

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
       * Remove a holding by id (its ledger history is kept — realized P/L
       * already banked should not vanish with the card).
       */
      removeHolding(id) {
        set((state) => ({
          holdings: state.holdings.filter((h) => h.id !== id),
        }));
      },

      /**
       * Record a buy/sell the user made at their broker and update the
       * position (average-cost method). Returns the ledger entry, or null if
       * the trade was invalid (unknown holding, qty <= 0, sell with 0 held).
       * @param {string} holdingId
       * @param {{ side:'buy'|'sell', qty:number, price:number, fee?:number, at?:string }} t
       */
      recordTrade(holdingId, t = {}) {
        const h = get().holdings.find((x) => x.id === holdingId);
        if (!h) return null;
        const side = t.side === 'sell' ? 'sell' : 'buy';
        const qty = Number(t.qty) || 0;
        const price = Number(t.price) || 0;
        const fee = Number(t.fee) || 0;
        if (qty <= 0 || price <= 0 || fee < 0) return null;

        const prev = { shares: Number(h.shares) || 0, avgCost: Number(h.avgCost) || 0 };
        const tx = {
          id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          symbol: h.symbol,
          side,
          qty,
          price,
          fee,
          currency: h.currency || nativeCurrencyForType(h.type),
          at: t.at || new Date().toISOString(),
          prevShares: prev.shares,
          prevAvgCost: prev.avgCost,
        };

        let next;
        if (side === 'buy') {
          next = applyBuy(prev, { qty, price, fee });
        } else {
          const sale = applySell(prev, { qty, price, fee });
          if (sale.soldQty <= 0) return null;
          next = { shares: sale.shares, avgCost: sale.avgCost };
          tx.qty = sale.soldQty; // clamped to what was actually held
          tx.realized = sale.realized;
          tx.costBasis = sale.costBasis;
        }

        set((state) => ({
          holdings: state.holdings.map((x) =>
            x.id === holdingId ? { ...x, shares: next.shares, avgCost: next.avgCost } : x
          ),
          transactions: [...state.transactions, tx],
        }));
        return tx;
      },

      /**
       * Undo a ledger entry — only allowed for the LATEST transaction of its
       * symbol (LIFO), restoring the position snapshot taken when it was
       * recorded. Returns true if undone.
       */
      undoTransaction(txId) {
        const { transactions, holdings } = get();
        const tx = transactions.find((x) => x.id === txId);
        if (!tx) return false;
        const laterSameSymbol = transactions.some(
          (x) => x.symbol === tx.symbol && x.id !== tx.id && x.at > tx.at
        );
        if (laterSameSymbol) return false; // only the most recent per symbol is reversible
        const h = holdings.find((x) => x.symbol === tx.symbol);
        set((state) => ({
          holdings: h
            ? state.holdings.map((x) =>
                x.id === h.id ? { ...x, shares: tx.prevShares, avgCost: tx.prevAvgCost } : x
              )
            : state.holdings,
          transactions: state.transactions.filter((x) => x.id !== tx.id),
        }));
        return true;
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
      version: 2,
      // v1 -> v2: the trade ledger arrived; older snapshots just get an empty one.
      migrate(persisted) {
        const state = persisted || {};
        if (!Array.isArray(state.transactions)) state.transactions = [];
        return state;
      },
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
