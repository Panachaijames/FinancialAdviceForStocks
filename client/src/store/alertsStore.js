// Zustand store for price alerts, persisted to localStorage (pt-alerts).
// Alerts fire once (triggeredAt is set) and can be re-armed or deleted.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

function makeId() {
  return `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useAlertsStore = create(
  persist(
    (set) => ({
      alerts: [], // [{ id, symbol, kind:'above'|'below'|'move', value, enabled, createdAt, triggeredAt?, triggeredPrice? }]

      addAlert({ symbol, kind, value } = {}) {
        const sym = (symbol || '').trim().toUpperCase();
        const v = Number(value);
        if (!sym || !['above', 'below', 'move'].includes(kind) || !Number.isFinite(v) || v <= 0) return null;
        const alert = {
          id: makeId(),
          symbol: sym,
          kind,
          value: v,
          enabled: true,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({ alerts: [...state.alerts, alert] }));
        return alert;
      },

      removeAlert(id) {
        set((state) => ({ alerts: state.alerts.filter((a) => a.id !== id) }));
      },

      /** Mark an alert as fired (it will not fire again until re-armed). */
      markTriggered(id, price) {
        set((state) => ({
          alerts: state.alerts.map((a) =>
            a.id === id
              ? { ...a, triggeredAt: new Date().toISOString(), triggeredPrice: Number(price) ?? null }
              : a
          ),
        }));
      },

      /** Re-arm a fired alert so it can trigger again. */
      rearmAlert(id) {
        set((state) => ({
          alerts: state.alerts.map((a) =>
            a.id === id ? { ...a, triggeredAt: undefined, triggeredPrice: undefined, enabled: true } : a
          ),
        }));
      },
    }),
    { name: 'pt-alerts', version: 1 }
  )
);

export default useAlertsStore;
