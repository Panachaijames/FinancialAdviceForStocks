// useQuotes hook: a SHARED, coalesced REST snapshot + live WS updates.
//
// Every useQuotes() caller funnels through a single module-level manager. Opening
// the app with many holdings mounts a dozen useQuotes() instances at once (each
// card, each mini-chart, the summary, the dividend panel). Previously each fired
// its own /api/quote request, so a 5-holding portfolio made ~12 overlapping
// requests in one tick — enough to trip Yahoo's/Twelve Data's per-IP rate limit,
// which left prices blank ("—") on reopen. The manager instead:
//   • ref-counts subscribed symbols across all hooks,
//   • coalesces the initial fetches into ONE batched /api/quote for the union,
//   • keeps a single WS subscription per symbol and one quote listener,
// so reopen makes one reliable batched request instead of a burst.
import { useEffect, useReducer } from 'react';
import { getQuotes } from '../api/client.js';
import marketSocket from '../api/socket.js';

class QuotesManager {
  constructor() {
    this.quotes = {}; // symbol -> quote
    this.refCounts = new Map(); // symbol -> number of mounted hooks wanting it
    this.listeners = new Set(); // React re-render callbacks
    this.pending = new Set(); // symbols awaiting the next coalesced fetch
    this.timer = null;
    this.wsHooked = false;
  }

  _hookWs() {
    if (this.wsHooked) return;
    this.wsHooked = true;
    marketSocket.onQuote((q) => {
      if (!q || !q.symbol) return;
      const existing = this.quotes[q.symbol];
      // Merge so partial ticks don't wipe fields.
      this.quotes = { ...this.quotes, [q.symbol]: existing ? { ...existing, ...q } : q };
      this._emit();
    });
  }

  subscribe(symbols) {
    this._hookWs();
    marketSocket.ensureConnected();
    const fresh = [];
    for (const s of symbols) {
      const prev = this.refCounts.get(s) || 0;
      this.refCounts.set(s, prev + 1);
      if (prev === 0) fresh.push(s);
    }
    if (fresh.length) {
      marketSocket.subscribe(fresh);
      for (const s of fresh) this.pending.add(s);
      this._scheduleFetch();
    }
  }

  unsubscribe(symbols) {
    const gone = [];
    for (const s of symbols) {
      const prev = this.refCounts.get(s) || 0;
      if (prev <= 1) {
        this.refCounts.delete(s);
        gone.push(s);
      } else {
        this.refCounts.set(s, prev - 1);
      }
    }
    if (gone.length) marketSocket.unsubscribe(gone);
  }

  /** Coalesce all subscribes within ~60ms into one batched REST request. */
  _scheduleFetch() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const syms = Array.from(this.pending);
      this.pending.clear();
      if (!syms.length) return;
      getQuotes(syms)
        .then((arr) => {
          if (!Array.isArray(arr) || arr.length === 0) return;
          const next = { ...this.quotes };
          for (const q of arr) if (q && q.symbol) next[q.symbol] = q;
          this.quotes = next;
          this._emit();
        })
        .catch(() => {
          /* ignore — live WS updates may still arrive */
        });
    }, 60);
  }

  _emit() {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        /* a listener error must not break the others */
      }
    }
  }

  addListener(l) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

const manager = new QuotesManager();

/**
 * @param {string[]} symbols
 * @returns {{ quotes: Record<string, object>, loading: boolean }}
 */
export function useQuotes(symbols) {
  const list = Array.isArray(symbols) ? symbols.filter(Boolean) : [];
  const key = list.slice().sort().join(',');
  const [, bump] = useReducer((c) => c + 1, 0);

  // Re-render this hook whenever the shared quote map changes.
  useEffect(() => manager.addListener(bump), []);

  // Ref-counted subscribe/unsubscribe for this hook's symbols.
  useEffect(() => {
    const syms = key ? key.split(',') : [];
    if (syms.length === 0) return undefined;
    manager.subscribe(syms);
    return () => manager.unsubscribe(syms);
  }, [key]);

  const syms = key ? key.split(',') : [];
  const quotes = {};
  for (const s of syms) if (manager.quotes[s]) quotes[s] = manager.quotes[s];
  const loading = syms.length > 0 && syms.some((s) => !manager.quotes[s]);
  return { quotes, loading };
}

export default useQuotes;
