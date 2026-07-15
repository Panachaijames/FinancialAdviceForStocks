// Transient snackbar (toast) queue — post-action feedback like "Added AAPL — View"
// or "Recorded buy 10 AAPL". Generalizes the old UndoRemoveBar into a store any
// component can fire into. Not persisted (purely ephemeral UI state).
import { create } from 'zustand';

let seq = 0;

export const useSnackbarStore = create((set) => ({
  snacks: [], // [{ id, message, actionLabel?, onAction?, tone, duration }]

  /**
   * Show a snackbar. Pass a stable `id` to REPLACE an existing one (and reset its
   * timer) — e.g. the single-level "Removed X — Undo". `duration` 0 = persist
   * until dismissed. Returns the snack id.
   * @param {{ id?:string, message:string, actionLabel?:string, onAction?:Function, tone?:'default'|'success'|'error', duration?:number }} snack
   */
  push(snack = {}) {
    const id = snack.id || `snk-${(seq += 1)}`;
    const entry = {
      id,
      message: snack.message || '',
      actionLabel: snack.actionLabel || null,
      onAction: typeof snack.onAction === 'function' ? snack.onAction : null,
      tone: snack.tone || 'default',
      duration: Number.isFinite(snack.duration) ? snack.duration : 6000,
    };
    set((s) => ({ snacks: [...s.snacks.filter((x) => x.id !== id), entry] }));
    return id;
  },

  dismiss(id) {
    set((s) => ({ snacks: s.snacks.filter((x) => x.id !== id) }));
  },

  clear() {
    set({ snacks: [] });
  },
}));

/** Fire a snackbar from anywhere (event handlers, non-component code). */
export const snackbar = {
  push: (snack) => useSnackbarStore.getState().push(snack),
  dismiss: (id) => useSnackbarStore.getState().dismiss(id),
};

export default useSnackbarStore;
