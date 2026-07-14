/**
 * Tiny in-memory TTL cache with concurrent-call de-duplication.
 *
 * - set(key, val, ttlMs): store a value with an expiry.
 * - get(key): return the cached value or undefined if missing/expired.
 * - wrap(key, ttlMs, asyncFn): return cached value if fresh; otherwise call
 *   asyncFn, cache the resolved value for ttlMs, and de-dupe concurrent calls
 *   so asyncFn only runs once for simultaneous requests with the same key.
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

/**
 * Memoize an async function result for ttlMs, de-duplicating concurrent calls.
 * @template T
 * @param {string} key
 * @param {number} ttlMs
 * @param {() => Promise<T>} asyncFn
 * @returns {Promise<T>}
 */
export async function wrap(key, ttlMs, asyncFn) {
  const cached = get(key);
  if (cached !== undefined) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const value = await asyncFn();
      // Don't cache empty/failed results (e.g. an upstream 429 returning []),
      // so the next request retries instead of being pinned for the whole TTL.
      const isEmpty =
        value == null || (Array.isArray(value) && value.length === 0);
      if (!isEmpty) set(key, value, ttlMs);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

export default { get, set, del, clear, wrap, size };
