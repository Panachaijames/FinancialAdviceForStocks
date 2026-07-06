// Cross-device portfolio sync — a private "sync code" maps to a stored blob of
// the user's holdings/savings/funds. The code is a bearer secret (anyone with
// it can read/write that blob), so it's long + random and the payload holds no
// PII, credentials, or money movement — just tracked symbols and amounts.
import express from 'express';
import { isConfigured, kvGet, kvSet } from '../providers/kv.js';

const router = express.Router();

const CODE_RE = /^[A-Za-z0-9-]{6,40}$/;
const MAX_BYTES = 256 * 1024;
const TTL_SECONDS = 60 * 60 * 24 * 400; // ~400 days, refreshed on every write

const guard = (req, res) => {
  if (!isConfigured()) {
    res.status(503).json({ error: 'sync_not_configured' });
    return false;
  }
  if (!CODE_RE.test(req.params.code || '')) {
    res.status(400).json({ error: 'bad_code' });
    return false;
  }
  return true;
};

// Read a synced blob by code. 404 if none stored yet.
router.get('/:code', async (req, res, next) => {
  try {
    if (!guard(req, res)) return;
    const raw = await kvGet(`sync:${req.params.code}`);
    if (raw == null) return res.status(404).json({ error: 'not_found' });
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (!parsed) return res.status(404).json({ error: 'not_found' });
    return res.json(parsed);
  } catch (e) {
    return next(e);
  }
});

// Write a synced blob by code (last write wins).
router.put('/:code', async (req, res, next) => {
  try {
    if (!guard(req, res)) return;
    const body = req.body || {};
    const payload = {
      data: body.data ?? null,
      updatedAt: Number(body.updatedAt) || Date.now(),
      v: 1,
    };
    const raw = JSON.stringify(payload);
    if (raw.length > MAX_BYTES) return res.status(413).json({ error: 'too_large' });
    await kvSet(`sync:${req.params.code}`, raw, TTL_SECONDS);
    return res.json({ ok: true, updatedAt: payload.updatedAt });
  } catch (e) {
    return next(e);
  }
});

export default router;
