// Server-side alert storage. Alerts are mirrored here from each device so the
// watcher can evaluate them while the app is closed. Persisted to Upstash (one
// JSON blob under a single key — the user base is small/personal) when
// configured; otherwise an in-memory Map that lives as long as the process.
//
// Shape: { [deviceId]: { topic:string|null, alerts:Alert[], fired:{[alertId]:ms}, updatedAt:ms } }
// `fired` dedups repeated ntfy sends for a still-met alert (and survives restarts
// via Upstash). An incoming alert that is active (no triggeredAt) clears its
// fired flag, so re-arming from the client lets the watcher fire it again.
import { isConfigured, kvGet, kvSet } from '../providers/kv.js';
import { log } from '../util/log.js';

const KEY = 'ptfin:alerts';
let mem = {};

export function persisted() {
  return isConfigured();
}

/** Load the full device→record map (from Upstash, or the in-memory fallback). */
export async function loadAll() {
  if (!isConfigured()) return mem;
  try {
    const raw = await kvGet(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    log.warn('alerts: kv load failed, using memory', e?.message);
    return mem;
  }
}

/** Persist the full map (mirrors to memory too, so a later kv failure still reads). */
export async function saveAll(all) {
  mem = all;
  if (!isConfigured()) return;
  try {
    await kvSet(KEY, JSON.stringify(all));
  } catch (e) {
    log.warn('alerts: kv save failed', e?.message);
  }
}

/**
 * Reconcile the `fired` dedup map against an incoming alert list (PURE). Keeps a
 * fired flag ONLY for alerts the client considers already triggered; active
 * alerts get a clean slate so re-arming from the client lets the watcher fire
 * them again. Exported for testing without touching the KV backend.
 * @param {Record<string,number>} prevFired
 * @param {Array} alerts
 * @param {number} [now] epoch ms fallback when triggeredAt is unparseable
 */
export function reconcileFired(prevFired = {}, alerts = [], now = Date.now()) {
  const fired = {};
  for (const a of alerts) {
    if (!a || !a.id) continue;
    const prev = prevFired[a.id];
    if (a.triggeredAt) {
      // Client already fired it in-app — keep it marked so the server never re-fires.
      fired[a.id] = prev != null ? prev : Number(a.armedAt) || Date.parse(a.triggeredAt) || now;
    } else if (prev != null && (a.armedAt == null || prev >= Number(a.armedAt))) {
      // Active, but the watcher already fired it for THIS arm version — don't
      // re-fire on a plain app reopen. A genuine re-arm bumps armedAt above
      // `prev`, so the flag drops and the alert becomes watchable again.
      fired[a.id] = prev;
    }
    // else: fresh or re-armed -> no fired flag -> the watcher may fire it.
  }
  return fired;
}

/**
 * Replace a device's alerts (client is the source of truth). Preserves the
 * `fired` flag only for alerts the client considers already triggered; active
 * alerts get a clean slate so re-armed ones can fire again.
 */
export async function putDevice(deviceId, { topic = null, alerts = [] } = {}) {
  const all = await loadAll();
  const prev = all[deviceId] || {};
  const fired = reconcileFired(prev.fired || {}, alerts);
  all[deviceId] = { topic, alerts, fired, updatedAt: Date.now() };
  await saveAll(all);
  return all[deviceId];
}

export default { persisted, loadAll, saveAll, putDevice, reconcileFired };
