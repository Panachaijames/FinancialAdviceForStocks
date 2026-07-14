// Corruption-safe localStorage adapter for zustand persist.
//
// localStorage IS the database here. If a write is truncated or the blob is
// otherwise corrupted, zustand persist rehydrates to defaults AND then, on the
// next state change, overwrites the still-recoverable blob — a silent total
// data loss. This adapter defends both directions:
//   • getItem: if the stored JSON won't parse, move it aside to `<key>.corrupt`
//     (so it can be recovered by hand) and return null, instead of feeding
//     garbage to persist.
//   • setItem: before overwriting, copy the previous value to `<key>.bak` — a
//     one-deep rolling backup, so the last-known-good state survives one bad
//     write.
//
// Returns a StateStorage (string in/out) to wrap in createJSONStorage.

/**
 * @param {Storage} [backend] defaults to window.localStorage
 * @returns {{ getItem:(name:string)=>string|null, setItem:(name:string,value:string)=>void, removeItem:(name:string)=>void }}
 */
export function createSafeStorage(backend) {
  const store =
    backend || (typeof window !== 'undefined' ? window.localStorage : null);

  return {
    getItem(name) {
      if (!store) return null;
      const raw = store.getItem(name);
      if (raw == null) return null;
      try {
        JSON.parse(raw);
        return raw;
      } catch {
        // Quarantine, don't discard: keep the corrupt bytes for recovery and
        // let persist fall back to defaults (rather than crash or reset silently).
        try {
          store.setItem(`${name}.corrupt`, raw);
        } catch {
          /* storage full/blocked — nothing more we can do */
        }
        try {
          store.removeItem(name);
        } catch {
          /* ignore */
        }
        return null;
      }
    },

    setItem(name, value) {
      if (!store) return;
      try {
        const prev = store.getItem(name);
        if (prev != null && prev !== value) store.setItem(`${name}.bak`, prev);
      } catch {
        /* backup is best-effort; never block the real write */
      }
      store.setItem(name, value);
    },

    removeItem(name) {
      if (!store) return;
      store.removeItem(name);
    },
  };
}

export default createSafeStorage;
