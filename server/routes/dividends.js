import express from 'express';
import { wrap } from '../cache.js';
import { getDividend } from '../providers/yahoo.js';

const router = express.Router();

const DIVIDENDS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// GET /api/dividends?symbol=X  -> Dividend
router.get('/', async (req, res) => {
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : '';
  if (!symbol) {
    return res.status(400).json({ error: 'Missing required query param "symbol"' });
  }
  try {
    const key = `dividends:${symbol}`;
    const dividend = await wrap(key, DIVIDENDS_TTL_MS, () => getDividend(symbol));
    return res.json(dividend);
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Dividend fetch failed' });
  }
});

export default router;
