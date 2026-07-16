import express from 'express';
import { wrap } from '../cache.js';
import { getSplits } from '../providers/yahoo.js';

const router = express.Router();

const SPLITS_TTL_MS = 6 * 60 * 60 * 1000; // 6h — splits change rarely

// GET /api/splits?symbol=X  -> [{ date, numerator, denominator, ratio, text }]
router.get('/', async (req, res) => {
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : '';
  if (!symbol) {
    return res.status(400).json({ error: 'Missing required query param "symbol"' });
  }
  try {
    // Negative-cache empties briefly so a symbol with no splits doesn't refetch
    // on every card mount.
    const splits = await wrap(`splits:${symbol}`, SPLITS_TTL_MS, () => getSplits(symbol), {
      emptyTtlMs: 60 * 60 * 1000,
    });
    return res.json(Array.isArray(splits) ? splits : []);
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Splits fetch failed' });
  }
});

export default router;
