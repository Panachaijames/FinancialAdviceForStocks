import express from 'express';
import { wrap } from '../cache.js';
import { searchSymbols } from '../providers/yahoo.js';

const router = express.Router();

const SEARCH_TTL_MS = 5 * 60 * 1000; // 5 minutes

// GET /api/search?q=...  -> SearchResult[]
router.get('/', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) {
    return res.status(400).json({ error: 'Missing required query param "q"' });
  }
  try {
    const key = `search:${q.toLowerCase()}`;
    const results = await wrap(key, SEARCH_TTL_MS, () => searchSymbols(q));
    return res.json(Array.isArray(results) ? results : []);
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Search failed' });
  }
});

export default router;
