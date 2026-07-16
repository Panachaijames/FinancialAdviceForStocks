/**
 * Tiny in-memory TTL cache with concurrent-call de-duplication.
 *
 * - set(key, val, ttlMs): store a value with an expiry.
 * - get(key): return the cached value or undefined if missing/expired.
 * - wrap(key, ttlMs, asyncFn, opts?): return cached value if fresh; otherwise
 *   call asyncFn, cache the resolved value for ttlMs, and de-dupe concurrent
 *   calls so asyncFn only runs once for simultaneous requests with the same key.
 *   Empty/failed results are NOT cached at ttlMs (so they retry) unless
 *   opts.emptyTtlMs is given — a short negative-cache window that stops a
 *   delisted/unknown symbol from hammering the upstream (+ fallback) forever.
 */

/** @type {Map<string, { value:any, expires:number }>} */
const store = new Map();

/** @type {Map<string, Promise<any>>} */
const inflight = new Map();

const now = () => Date.now();

export function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expires <= now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function set(key, value, ttlMs) {
  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 0;
  store.set(key, { value, expires: now() + ttl });
  return value;
}

export function del(key) {
  store.delete(key);
  inflight.delete(key);
}

export function clear() {
  store.clear();
  inflight.clear();
}

/** Current number of cached entries (surfaced in /api/health). */
export function size() {
  return store.size;
}

// The Map only evicts an entry when it's next read, so a warm dyno accumulates
// dead entries forever (every distinct search string is a permanent key). A
// periodic sweep drops expired entries and hard-caps total size.
const MAX_ENTRIES = 1000;

/**
 * Drop expired entries; if still over MAX_ENTRIES, evict oldest-inserted
 * (Map preserves insertion order). Returns how many entries were removed.
 */
export function sweep() {
  const t = now();
  let removed = 0;
  for (const [key, entry] of store) {
    if (entry.expires <= t) {
      store.delete(key);
      removed += 1;
    }
  }
  if (store.size > MAX_ENTRIES) {
    const over = store.size - MAX_ENTRIES;
    let i = 0;
    for (const key of store.keys()) {
      if (i >= over) break;
      store.delete(key);
      i += 1;
      removed += 1;
    }
  }
  return removed;
}

/**
 * Memoize an async function result for ttlMs, de-duplicating concurrent calls.
 * @template T
 * @param {string} key
 * @param {number} ttlMs
 * @param {() => Promise<T>} asyncFn
 * @returns {Promise<T>}
 */
export async function wrap(key, ttlMs, asyncFn, opts) {
  const emptyTtlMs = opts && Number.isFinite(opts.emptyTtlMs) && opts.emptyTtlMs > 0 ? opts.emptyTtlMs : 0;
  const cached = get(key);
  if (cached !== undefined) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const value = await asyncFn();
      // An upstream 429/miss often surfaces as null or []. Don't pin that for
      // the full ttlMs (so the next request retries) — but if the caller opted
      // into a short emptyTtlMs, cache it briefly so one delisted/unknown symbol
      // in a portfolio doesn't hammer the upstream (+ its fallback) every refresh.
      const isEmpty =
        value == null || (Array.isArray(value) && value.length === 0);
      if (!isEmpty) set(key, value, ttlMs);
      else if (emptyTtlMs) set(key, value, emptyTtlMs);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

export default { get, set, del, clear, wrap, size, sweep };
