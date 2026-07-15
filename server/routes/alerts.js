// Alert-sync endpoint. The client is the source of truth for alert definitions
// and mirrors them here (keyed by a stable per-device id) so the server-side
// watcher can fire them while the app is closed.
import express from 'express';
import * as store from '../alerts/store.js';

const router = express.Router();
const KINDS = new Set(['above', 'below', 'move']);

function sanitize(alerts) {
  return (Array.isArray(alerts) ? alerts : [])
    .slice(0, 100)
    .map((a) => ({
      id: String(a?.id || '').slice(0, 64),
      symbol: String(a?.symbol || '').trim().toUpperCase().slice(0, 24),
      kind: a?.kind,
      value: Number(a?.value),
      enabled: a?.enabled !== false,
      triggeredAt: a?.triggeredAt ? String(a.triggeredAt).slice(0, 32) : null,
      armedAt: Number.isFinite(Number(a?.armedAt)) ? Number(a.armedAt) : null,
    }))
    .filter((a) => a.id && a.symbol && KINDS.has(a.kind) && Number.isFinite(a.value));
}

// PUT /api/alerts  { deviceId, topic?, alerts:[...] }  -> mirror this device's alerts
router.put('/', async (req, res) => {
  const { deviceId, topic, alerts } = req.body || {};
  if (!deviceId || typeof deviceId !== 'string') {
    return res.status(400).json({ error: 'deviceId required' });
  }
  if (!Array.isArray(alerts)) {
    return res.status(400).json({ error: 'alerts array required' });
  }
  // ntfy topics: keep to a safe, url-friendly slug.
  const safeTopic = typeof topic === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(topic) ? topic : null;
  try {
    const rec = await store.putDevice(String(deviceId).slice(0, 64), {
      topic: safeTopic,
      alerts: sanitize(alerts),
    });
    return res.json({ ok: true, count: rec.alerts.length, persisted: store.persisted() });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to store alerts' });
  }
});

export default router;
