import express from 'express';
import { wrap } from '../cache.js';
import { getFx } from '../providers/fx.js';

const router = express.Router();

const FX_TTL_MS = 30 * 1000; // 30 seconds

// GET /api/fx?base=USD&quote=THB  -> Fx
router.get('/', async (req, res) => {
  const base = typeof req.query.base === 'string' && req.query.base.trim()
    ? req.query.base.trim().toUpperCase()
    : 'USD';
  const quote = typeof req.query.quote === 'string' && req.query.quote.trim()
    ? req.query.quote.trim().toUpperCase()
    : 'THB';
  try {
    const key = `fx:${base}:${quote}`;
    const fx = await wrap(key, FX_TTL_MS, () => getFx(base, quote));
    return res.json(fx);
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'FX fetch failed' });
  }
});

export default router;
