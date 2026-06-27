import express from 'express';
import { wrap } from '../cache.js';
import { searchSymbols } from '../providers/yahoo.js';
import * as twelvedata from '../providers/twelvedata.js';

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
    const results = await wrap(key, SEARCH_TTL_MS, async () => {
      // Yahoo primary; Twelve Data fallback (Yahoo blocks cloud/datacenter IPs,
      // so on hosts like Render the TD symbol_search keeps search working).
      const y = await searchSymbols(q);
      if (y && y.length) return y;
      if (twelvedata.hasKey()) {
        const td = await twelvedata.searchSymbols(q);
        if (td && td.length) return td;
      }
      return [];
    });
    return res.json(Array.isArray(results) ? results : []);
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Search failed' });
  }
});

export default router;
