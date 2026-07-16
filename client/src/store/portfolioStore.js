// Zustand portfolio store with localStorage persistence.
//
// Two collections: `holdings` (current positions, authoritative) and
// `transactions` (the trade ledger — what the user DID at their broker, so the
// app can compute realized P/L; it never places real orders). Buys/sells go
// through recordTrade(), which updates the position with average-cost math
// (lib/trades.js) and appends a ledger entry that snapshots the prior position
// so the latest trade per symbol can be undone safely.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createSafeStorage } from '../lib/safeStorage.js';
import { classify } from '../lib/assetType.js';
import { replayPosition } from '../lib/trades.js';

function nativeCurrencyForType(type) {
  return type === 'th_stock' ? 'THB' : 'USD';
}

/**
 * Recompute one symbol's position + its entries' realized/snapshot fields by
 * replaying its ledger chronologically (lib/trades.replayPosition), keeping the
 * transactions array's existing ORDER (only the per-entry fields change) so the
 * insertion-order LIFO undo stays valid. This is the single consistency path for
 * backdated / edited / deleted trades. Returns { transactions, holdings }.
 */
function replayInto(transactions, holdings, symbol) {
  const symTxs = transactions.filter((t) => t && t.symbol === symbol);
  // Only the ledger's buy/sell entries define a position. If a symbol has none
  // (e.g. a holding entered manually via "Add asset", or one that only has a
  // logged dividend), its position is NOT ledger-derived — leave the holding's
  // shares/avgCost untouched so a replay can't wipe manually-entered shares.
  const hasTrades = symTxs.some((t) => t.side === 'buy' || t.side === 'sell');
  const { shares, avgCost, transactions: replayed } = replayPosition(symTxs);
  const byId = new Map(replayed.map((t) => [t.id, t]));
  return {
    transactions: transactions.map((t) => (t && t.symbol === symbol ? byId.get(t.id) || t : t)),
    holdings: hasTrades
      ? holdings.map((h) => (h.symbol === symbol ? { ...h, shares, avgCost } : h))
      : holdings,
  };
}

function makeId(symbol) {
  const base = (symbol || 'asset').replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
  return `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const usePortfolioStore = create(
  persist(
    (set, get) => ({
      holdings: [],
      transactions: [], // trade: { id, symbol, side:'buy'|'sell', qty, price, fee, currency, at, realized?, costBasis?, prevShares, prevAvgCost }
                        // dividend: { id, symbol, side:'dividend', amount, wht, currency, at, prevShares, prevAvgCost }
      watchlist: [], // [{ id, symbol, type, name, currency, addedAt }] — symbols to track WITHOUT a position
      snapshots: [], // [{ d:'YYYY-MM-DD', usd:number }] — cheap daily portfolio-value history (see recordSnapshot)
      lastRemoved: null, // { holding, index, at } — most recent removeHolding, for undo (not persisted)

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
                    ...(position.goldUnit ? { goldUnit: position.goldUnit } : {}),
                  }
                : h
            ),
            // A symbol is never both held and watched — drop any watch entry.
            watchlist: state.watchlist.filter((w) => w.symbol !== symbol),
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
          ...(position.goldUnit ? { goldUnit: position.goldUnit } : {}),
          addedAt: new Date().toISOString(),
        };
        set((state) => ({
          holdings: [...state.holdings, holding],
          // A symbol is never both held and watched — drop any watch entry.
          watchlist: state.watchlist.filter((w) => w.symbol !== symbol),
        }));
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
       * already banked should not vanish with the card). Stashes the removed
       * holding in `lastRemoved` so the UI can offer a brief undo.
       */
      removeHolding(id) {
        const idx = get().holdings.findIndex((h) => h.id === id);
        if (idx === -1) return;
        const holding = get().holdings[idx];
        set((state) => ({
          holdings: state.holdings.filter((h) => h.id !== id),
          lastRemoved: { holding, index: idx, at: Date.now() },
        }));
      },

      /** Restore the last removed holding at its original position. */
      restoreRemoved() {
        const lr = get().lastRemoved;
        if (!lr || !lr.holding) return;
        set((state) => {
          // Guard against double-restore or a re-added symbol in the meantime.
          if (state.holdings.some((h) => h.id === lr.holding.id || h.symbol === lr.holding.symbol)) {
            return { lastRemoved: null };
          }
          const next = state.holdings.slice();
          next.splice(Math.min(lr.index, next.length), 0, lr.holding);
          return { holdings: next, lastRemoved: null };
        });
      },

      /** Dismiss the pending undo without restoring. */
      clearRemoved() {
        if (get().lastRemoved) set({ lastRemoved: null });
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

        const currency = h.currency || nativeCurrencyForType(h.type);
        const at = t.at || new Date().toISOString();
        const txs = get().transactions;
        const symTxs = txs.filter((x) => x.symbol === h.symbol);
        const hasTrades = symTxs.some((x) => x.side === 'buy' || x.side === 'sell');

        // Preserve a manually-entered base position (added via "Add asset", not the
        // ledger) as an OPENING lot the first time a trade is recorded — otherwise
        // the replay (which knows only the ledger) would discard those shares.
        const additions = [];
        const heldShares = Number(h.shares) || 0;
        if (!hasTrades && heldShares > 0) {
          const newMs = Date.parse(at) || Date.now();
          const addedMs = Date.parse(h.addedAt);
          const openMs = Math.min(Number.isFinite(addedMs) ? addedMs : newMs - 1000, newMs - 1000);
          additions.push({
            id: `tx-open-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            symbol: h.symbol,
            type: h.type,
            side: 'buy',
            qty: heldShares,
            price: Number(h.avgCost) || 0,
            fee: 0,
            currency,
            at: new Date(openMs).toISOString(),
            opening: true, // synthetic opening balance for a manually-entered position
          });
        }

        // A sell records nothing if there's nothing held once the opening lot is
        // accounted for — return null so callers (import) skip/report it rather
        // than persisting a phantom qty-0 row.
        if (side === 'sell' && replayPosition([...symTxs, ...additions]).shares <= 0) return null;

        const tx = {
          id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          symbol: h.symbol,
          type: h.type, // asset class — the tax report groups by it
          side,
          qty,
          price,
          fee,
          currency,
          at,
        };
        additions.push(tx);

        // Append, then replay the symbol chronologically — so a BACKDATED `at`
        // blends into avg cost / realizes at the right point, not "as of now".
        const replayed = replayInto([...txs, ...additions], get().holdings, h.symbol);
        set(replayed);
        return replayed.transactions.find((x) => x.id === tx.id) || tx;
      },

      /**
       * Apply a detected stock split to a holding: ×ratio shares, ÷ratio average
       * cost, recorded as a side:'split' ledger entry (which also marks the split
       * handled so it isn't re-prompted). Seeds an opening lot for a manually-
       * entered base position — exactly like recordTrade — so the chronological
       * replay can't discard it. Returns the split entry, or null if invalid /
       * already applied.
       * @param {string} holdingId
       * @param {{ date?:string, ratio:number, numerator?:number, denominator?:number }} split
       */
      applySplit(holdingId, split = {}) {
        const h = get().holdings.find((x) => x.id === holdingId);
        if (!h) return null;
        const ratio = Number(split.ratio);
        if (!(ratio > 0) || ratio === 1) return null;

        const currency = h.currency || nativeCurrencyForType(h.type);
        const at = split.date || new Date().toISOString();
        const dayKey = String(at).slice(0, 10);
        const txs = get().transactions;
        const symTxs = txs.filter((x) => x.symbol === h.symbol);
        // Idempotent: never record the same split (symbol+day) twice.
        if (symTxs.some((x) => x.side === 'split' && String(x.at).slice(0, 10) === dayKey)) return null;
        const hasTrades = symTxs.some((x) => x.side === 'buy' || x.side === 'sell');

        const additions = [];
        const heldShares = Number(h.shares) || 0;
        if (!hasTrades && heldShares > 0) {
          const splitMs = Date.parse(at) || Date.now();
          const addedMs = Date.parse(h.addedAt);
          const openMs = Math.min(Number.isFinite(addedMs) ? addedMs : splitMs - 1000, splitMs - 1000);
          additions.push({
            id: `tx-open-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            symbol: h.symbol,
            type: h.type,
            side: 'buy',
            qty: heldShares,
            price: Number(h.avgCost) || 0,
            fee: 0,
            currency,
            at: new Date(openMs).toISOString(),
            opening: true,
          });
        }

        const tx = {
          id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          symbol: h.symbol,
          type: h.type,
          side: 'split',
          ratio,
          ...(Number(split.numerator) > 0 ? { numerator: Number(split.numerator) } : {}),
          ...(Number(split.denominator) > 0 ? { denominator: Number(split.denominator) } : {}),
          currency,
          at,
        };
        additions.push(tx);

        const replayed = replayInto([...txs, ...additions], get().holdings, h.symbol);
        set(replayed);
        return tx;
      },

      /**
       * Edit a recorded buy/sell (qty / price / fee / date / side), then replay
       * the symbol so avg cost and every downstream sell's realized P/L are
       * recomputed — fixing an old typo without undoing everything after it.
       * @param {string} txId
       * @param {{ qty?:number, price?:number, fee?:number, at?:string, side?:'buy'|'sell' }} patch
       * @returns {object|null} the replayed (possibly clamped) entry, or null if invalid
       */
      editTransaction(txId, patch = {}) {
        const txs = get().transactions;
        const tx = txs.find((x) => x.id === txId);
        if (!tx || (tx.side !== 'buy' && tx.side !== 'sell')) return null;
        const clean = {};
        if ('qty' in patch) clean.qty = Number(patch.qty) || 0;
        if ('price' in patch) clean.price = Number(patch.price) || 0;
        if ('fee' in patch) clean.fee = Math.max(0, Number(patch.fee) || 0);
        if ('at' in patch && patch.at) clean.at = patch.at;
        if ('side' in patch && (patch.side === 'buy' || patch.side === 'sell')) clean.side = patch.side;
        if ((clean.qty != null && clean.qty <= 0) || (clean.price != null && clean.price <= 0)) return null;
        const nextTxs = txs.map((x) => (x.id === txId ? { ...x, ...clean } : x));
        const replayed = replayInto(nextTxs, get().holdings, tx.symbol);
        set(replayed);
        return replayed.transactions.find((x) => x.id === txId) || null;
      },

      /**
       * Delete any ledger entry (trade or dividend), then replay its symbol so the
       * position and realized P/L stay consistent — no LIFO restriction.
       * @param {string} txId
       * @returns {boolean}
       */
      deleteTransaction(txId) {
        const txs = get().transactions;
        const tx = txs.find((x) => x.id === txId);
        if (!tx) return false;
        const nextTxs = txs.filter((x) => x.id !== txId);
        set(replayInto(nextTxs, get().holdings, tx.symbol));
        return true;
      },

      /**
       * Record a dividend the user RECEIVED for a holding (income, not a trade).
       * It never moves the position (deleteTransaction just removes the row and a
       * replay leaves the position untouched). Returns the ledger entry, or null
       * if invalid (unknown holding, amount <= 0, negative withholding).
       * @param {string} holdingId
       * @param {{ amount:number, wht?:number, at?:string }} d  amounts in native currency
       */
      recordDividend(holdingId, d = {}) {
        const h = get().holdings.find((x) => x.id === holdingId);
        if (!h) return null;
        const amount = Number(d.amount) || 0;
        const whtRaw = Number(d.wht) || 0;
        if (amount <= 0 || whtRaw < 0) return null;
        const wht = Math.min(whtRaw, amount); // withholding can't exceed the gross dividend

        const prev = { shares: Number(h.shares) || 0, avgCost: Number(h.avgCost) || 0 };
        const tx = {
          id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          symbol: h.symbol,
          type: h.type, // asset class — the tax report groups dividends by it
          side: 'dividend',
          qty: 0,
          price: 0,
          fee: 0,
          amount, // gross dividend received
          wht, // withholding tax deducted
          currency: h.currency || nativeCurrencyForType(h.type),
          at: d.at || new Date().toISOString(),
          prevShares: prev.shares, // dividends don't change the position; snapshot
          prevAvgCost: prev.avgCost, // = current so undo is a safe no-op
        };
        set((state) => ({ transactions: [...state.transactions, tx] }));
        return tx;
      },

      /**
       * Bulk-import parsed broker trades (lib/csvImport.js output, oldest
       * first). Unknown symbols become new holdings (0 shares) so the buys
       * replay into them; each trade goes through recordTrade so average-cost
       * math and the ledger stay consistent. Trades are applied to the
       * CURRENT position state — importing a full history into an empty
       * portfolio reproduces exact avg cost and realized P/L.
       * @param {{date:string, side:'buy'|'sell', symbol:string, qty:number, price:number, fee:number}[]} trades
       * @returns {{applied:number, skipped:string[]}}
       */
      importTrades(trades = []) {
        const skipped = [];
        let applied = 0;
        for (const t of trades) {
          if (!t || !t.symbol) continue;
          let holding = get().holdings.find((x) => x.symbol === t.symbol);
          if (!holding) {
            get().addHolding({ symbol: t.symbol }, { shares: 0, avgCost: 0 });
            holding = get().holdings.find((x) => x.symbol === t.symbol);
          }
          if (!holding) {
            skipped.push(`${t.symbol}: could not create holding`);
            continue;
          }
          if (t.side === 'split') {
            const s = get().applySplit(holding.id, { date: t.date, ratio: t.ratio });
            if (s) applied += 1;
            else skipped.push(`${t.symbol} split ${t.ratio}: invalid or already applied`);
            continue;
          }
          const tx = get().recordTrade(holding.id, {
            side: t.side,
            qty: t.qty,
            price: t.price,
            fee: t.fee,
            at: t.date,
          });
          if (tx) applied += 1;
          else skipped.push(`${t.symbol} ${t.side} ${t.qty} @ ${t.price}: invalid (selling more than held?)`);
        }
        return { applied, skipped };
      },

      /**
       * Get the list of distinct symbols in the portfolio.
       */
      getSymbols() {
        return Array.from(new Set(get().holdings.map((h) => h.symbol)));
      },

      /**
       * Record today's total portfolio value (USD) for the performance history.
       * One entry per calendar day (later values overwrite the same day); capped
       * to ~2 years. This is the cheap fallback that gives EVERY user a value
       * history — including holdings added without a trade ledger — but it only
       * accrues on days the app is open. See lib/performance.js for the (more
       * precise) ledger-replay path.
       * @param {number} usdValue total portfolio market value in USD
       */
      recordSnapshot(usdValue) {
        const v = Number(usdValue);
        if (!Number.isFinite(v) || v <= 0) return;
        const d = new Date().toISOString().slice(0, 10);
        const snaps = get().snapshots || [];
        const last = snaps.length ? snaps[snaps.length - 1] : null;
        if (last && last.d === d) {
          if (last.usd === v) return; // unchanged — skip the write
          set({ snapshots: [...snaps.slice(0, -1), { d, usd: v }] });
          return;
        }
        const next = [...snaps, { d, usd: v }];
        set({ snapshots: next.length > 730 ? next.slice(next.length - 730) : next });
      },

      // ── watchlist ───────────────────────────────────────────────────────────
      // A watchlist entry tracks a symbol WITHOUT a position. It's a separate
      // collection (not a flag on holdings) on purpose: `holdings` stays purely
      // positions, so every totals/allocation/dividend/rebalance consumer keeps
      // ignoring watched symbols automatically — no chance of a 0-share "watch"
      // leaking into portfolio value the way the old 0-share-holding hack did.

      /**
       * Add a symbol to the watchlist. No-op if it's already watched or already a
       * real holding (a position you own doesn't also need watching).
       * @param {{symbol,name?,type?,currency?}} searchResultLike
       */
      addToWatchlist(searchResultLike) {
        const sr = searchResultLike || {};
        const symbol = (sr.symbol || '').trim();
        if (!symbol) return;
        if (get().holdings.some((h) => h.symbol === symbol)) return;
        if (get().watchlist.some((w) => w.symbol === symbol)) return;
        const type = sr.type || classify(symbol);
        const item = {
          id: makeId(symbol),
          symbol,
          type,
          name: sr.name || symbol,
          currency: sr.currency || nativeCurrencyForType(type),
          addedAt: new Date().toISOString(),
        };
        set((state) => ({ watchlist: [...state.watchlist, item] }));
      },

      /** Remove a watchlist entry by id. */
      removeFromWatchlist(id) {
        if (!id) return;
        set((state) => ({ watchlist: state.watchlist.filter((w) => w.id !== id) }));
      },

      /**
       * Promote a watched symbol into a real holding with a position, dropping it
       * from the watchlist. Reuses addHolding so the position/currency logic and
       * dedupe stay in one place.
       * @param {string} id watchlist entry id
       * @param {{shares:number, avgCost:number}} position
       */
      promoteToHolding(id, position = {}) {
        const w = get().watchlist.find((x) => x.id === id);
        if (!w) return;
        get().addHolding(
          { symbol: w.symbol, name: w.name, type: w.type, currency: w.currency },
          position
        );
        set((state) => ({ watchlist: state.watchlist.filter((x) => x.id !== id) }));
      },
    }),
    {
      name: 'pt-portfolio',
      version: 4,
      // Corruption-safe storage: quarantines unparseable JSON to pt-portfolio.corrupt
      // and keeps a one-deep pt-portfolio.bak, so a bad write can't silently wipe
      // the only copy of the user's holdings/ledger.
      storage: createJSONStorage(() => createSafeStorage()),
      // Only the real collections persist; transient undo state stays in memory.
      partialize: (state) => ({
        holdings: state.holdings,
        transactions: state.transactions,
        watchlist: state.watchlist,
        snapshots: state.snapshots,
      }),
      // v1 -> v2: trade ledger. v2 -> v3: watchlist. v3 -> v4: value snapshots.
      // All defaults are empty arrays, so this stays version-agnostic.
      migrate(persisted) {
        const state = persisted || {};
        if (!Array.isArray(state.transactions)) state.transactions = [];
        if (!Array.isArray(state.watchlist)) state.watchlist = [];
        if (!Array.isArray(state.snapshots)) state.snapshots = [];
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
