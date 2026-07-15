// Zustand store for price alerts, persisted to localStorage (pt-alerts).
// Alerts fire once (triggeredAt is set) and can be re-armed or deleted.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

function makeId() {
  return `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Stable per-device id + a url-safe ntfy topic, generated once and persisted.
// The deviceId keys this device's alerts server-side; the topic is where the
// server publishes closed-app notifications (the user subscribes to it in ntfy).
function makeDeviceId() {
  try {
    if (globalThis.crypto && globalThis.crypto.randomUUID) return `dev-${globalThis.crypto.randomUUID()}`;
  } catch {
    /* fall through */
  }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function makeTopic() {
  let r = '';
  try {
    const b = new Uint8Array(6);
    globalThis.crypto.getRandomValues(b);
    r = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  } catch {
    r = Math.random().toString(36).slice(2, 10);
  }
  return `ptfin-${r}`;
}

export const useAlertsStore = create(
  persist(
    (set) => ({
      alerts: [], // [{ id, symbol, kind:'above'|'below'|'move', value, enabled, createdAt, triggeredAt?, triggeredPrice? }]
      deviceId: makeDeviceId(), // stable id keying this device's alerts on the server
      pushTopic: makeTopic(), // ntfy.sh topic for closed-app delivery
      pushEnabled: false, // opt-in: mirror alerts to the server watcher

      setPushEnabled(v) {
        set({ pushEnabled: !!v });
      },

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
