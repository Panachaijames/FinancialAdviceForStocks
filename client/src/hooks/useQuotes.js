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
//
// Performance (4.1 / 4.2): listeners are registered WITH the symbol set their
// hook cares about, so a tick for one symbol only re-renders hooks that hold it
// (not every useQuotes on the page). WS ticks are coalesced into a single ~50ms
// flush so a 5s poll burst of N quotes causes one notification round, not N. And
// each hook returns a STABLE quotes object reference — rebuilt only when one of
// its symbols' quote identities actually changed — so consumers' memos/effects
// (MiniChart, sort memos, donut segments) don't bust every render.
import { useEffect, useReducer, useRef } from 'react';
import { getQuotes } from '../api/client.js';
import marketSocket from '../api/socket.js';

const FLUSH_MS = 50; // coalesce a burst of ticks into one re-render round

class QuotesManager {
  constructor() {
    this.quotes = {}; // symbol -> quote
    this.refCounts = new Map(); // symbol -> number of mounted hooks wanting it
    this.listeners = new Map(); // re-render callback -> Set<symbol> the hook cares about
    this.pending = new Set(); // symbols awaiting the next coalesced fetch
    this.settled = new Set(); // symbols whose batch completed (even with no quote back)
    this.fetchTimer = null;
    this.wsHooked = false;
    this.retryCount = 0; // consecutive failed batch fetches
    this.loadError = false; // true after a failed batch until a success
    // Coalesced, symbol-targeted re-render notification.
    this._changed = new Set(); // symbols whose quote changed since the last flush
    this._emitAll = false; // force-notify every listener (global state changed)
    this._flushTimer = null;
  }

  _hookWs() {
    if (this.wsHooked) return;
    this.wsHooked = true;
    marketSocket.onQuote((q) => {
      if (!q || !q.symbol) return;
      const existing = this.quotes[q.symbol];
      // Merge so partial ticks don't wipe fields. New object for the changed
      // symbol; every other symbol keeps its identity (stable refs downstream).
      this.quotes = { ...this.quotes, [q.symbol]: existing ? { ...existing, ...q } : q };
      this.settled.add(q.symbol); // a live tick settles the symbol too
      this._markChanged(q.symbol);
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
    if (this.fetchTimer) return;
    this.fetchTimer = setTimeout(() => {
      this.fetchTimer = null;
      const syms = Array.from(this.pending);
      this.pending.clear();
      if (!syms.length) return;
      const hadError = this.loadError;
      getQuotes(syms)
        .then((arr) => {
          this.retryCount = 0;
          this.loadError = false;
          // The batch COMPLETED: every requested symbol is settled, even ones
          // the server had no quote for (delisted/bad symbol). Without this,
          // `loading` would stay true forever and the UI would shimmer
          // indefinitely instead of falling back honestly to cost basis.
          for (const s of syms) this.settled.add(s);
          if (Array.isArray(arr) && arr.length > 0) {
            const next = { ...this.quotes };
            for (const q of arr) if (q && q.symbol) next[q.symbol] = q;
            this.quotes = next;
          }
          for (const s of syms) this._changed.add(s);
          if (hadError) this._emitAll = true; // error cleared — refresh everyone
          this._scheduleFlush(); // settled/error state changed even if no data arrived
        })
        .catch(() => {
          // Retry with backoff: 2s, 8s, 30s, then give up until a new subscribe.
          this.loadError = true;
          const delays = [2000, 8000, 30000];
          const delay = delays[this.retryCount];
          if (delay != null) {
            this.retryCount += 1;
            // Re-queue only symbols something still wants.
            for (const s of syms) if (this.refCounts.has(s)) this.pending.add(s);
            setTimeout(() => this._scheduleFetch(), delay);
          }
          if (!hadError) this._emitAll = true; // entering error state — refresh everyone
          this._scheduleFlush();
        });
    }, 60);
  }

  _markChanged(symbol) {
    if (symbol) this._changed.add(symbol);
    this._scheduleFlush();
  }

  /** Flush pending notifications once per FLUSH_MS, to only the affected hooks. */
  _scheduleFlush() {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      const changed = this._changed;
      this._changed = new Set();
      const all = this._emitAll;
      this._emitAll = false;
      for (const [cb, syms] of this.listeners) {
        if (all) {
          this._safe(cb);
          continue;
        }
        let hit = false;
        for (const s of syms) {
          if (changed.has(s)) {
            hit = true;
            break;
          }
        }
        if (hit) this._safe(cb);
      }
    }, FLUSH_MS);
  }

  _safe(cb) {
    try {
      cb();
    } catch {
      /* a listener error must not break the others */
    }
  }

  addListener(cb) {
    if (!this.listeners.has(cb)) this.listeners.set(cb, new Set());
    return () => this.listeners.delete(cb);
  }

  /** Update which symbols a listener cares about (called when the hook's set changes). */
  setListenerSymbols(cb, symbols) {
    if (this.listeners.has(cb)) this.listeners.set(cb, new Set(symbols));
  }
}

const manager = new QuotesManager();

/**
 * @param {string[]} symbols
 * @returns {{ quotes: Record<string, object>, loading: boolean, error: boolean }}
 *   loading — some requested symbol has neither a quote nor a completed fetch
 *   error   — the last batch fetch failed (cleared by the next success)
 */
export function useQuotes(symbols) {
  const list = Array.isArray(symbols) ? symbols.filter(Boolean) : [];
  const key = list.slice().sort().join(',');
  const [, bump] = useReducer((c) => c + 1, 0);

  // Register this hook's re-render callback once. `bump` (useReducer dispatch)
  // has a stable identity, so it doubles as the listener key.
  useEffect(() => manager.addListener(bump), []);

  // Ref-counted subscribe/unsubscribe + keep the manager's per-listener symbol
  // set in sync, so ticks only re-render hooks that hold the changed symbol.
  useEffect(() => {
    const syms = key ? key.split(',') : [];
    manager.setListenerSymbols(bump, syms);
    if (syms.length === 0) return undefined;
    manager.subscribe(syms);
    return () => manager.unsubscribe(syms);
  }, [key]);

  const syms = key ? key.split(',') : [];

  // Stable quotes object: reuse the previous reference unless the symbol set (key)
  // changed or one of this hook's per-symbol quote objects changed identity.
  const prev = useRef({ key: null, obj: {} });
  let changed = key !== prev.current.key;
  if (!changed) {
    for (const s of syms) {
      if (prev.current.obj[s] !== manager.quotes[s]) {
        changed = true;
        break;
      }
    }
  }
  let quotes = prev.current.obj;
  if (changed) {
    const next = {};
    for (const s of syms) if (manager.quotes[s]) next[s] = manager.quotes[s];
    quotes = next;
    prev.current = { key, obj: next };
  }

  const loading =
    syms.length > 0 && syms.some((s) => !manager.quotes[s] && !manager.settled.has(s));
  const error = manager.loadError;
  return { quotes, loading, error };
}

export default useQuotes;
