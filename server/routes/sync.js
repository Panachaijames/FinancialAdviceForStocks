// One-time cross-device data transfer — a private "transfer code" maps to a
// stored blob of the user's holdings/savings/funds. The sender PUTs it; the
// receiver GETs then DELETEs it, so nothing lingers in the cloud. The code is a
// bearer secret (anyone with it can read the blob), so it's random and the
// payload holds no PII, credentials, or money movement — just tracked symbols
// and amounts. Unclaimed transfers auto-expire via a short TTL.
import express from 'express';
import { isConfigured, kvGet, kvSet, kvDel } from '../providers/kv.js';

const router = express.Router();

const CODE_RE = /^[A-Za-z0-9-]{6,40}$/;
const MAX_BYTES = 256 * 1024;
const TTL_SECONDS = 60 * 60 * 24; // 24h — a receive deletes it sooner; this is just the abandon fallback

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

// Delete a transfer blob (the receiver calls this once it has the data).
router.delete('/:code', async (req, res, next) => {
  try {
    if (!guard(req, res)) return;
    await kvDel(`sync:${req.params.code}`);
    return res.json({ ok: true });
  } catch (e) {
    return next(e);
  }
});

export default router;
