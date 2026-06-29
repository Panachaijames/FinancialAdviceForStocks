import express from 'express';
import { wrap } from '../cache.js';
import * as sec from '../providers/sec.js';

const router = express.Router();

const SEARCH_TTL_MS = 10 * 60 * 1000;
const NAV_TTL_MS = 30 * 1000; // route-level dedup; provider caches ~1h

// GET /api/funds/search?q=...  -> Thai mutual funds (RMF/LTF/SSF/...)
router.get('/search', async (req, res) => {
  if (!sec.hasKey()) return res.status(503).json({ error: 'Thai fund data unavailable — set SEC_FUND_DAILY_KEY + SEC_FACTSHEET_KEY' });
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) return res.json([]);
  try {
    const out = await wrap(`fundsearch:${q.toLowerCase()}`, SEARCH_TTL_MS, () => sec.searchFunds(q));
    return res.json(Array.isArray(out) ? out : []);
  } catch (err) {
    return res.status(502).json({ error: err?.message || 'Fund search failed' });
  }
});

// GET /api/funds/nav?id=PROJ_ID  -> latest NAV + day change
router.get('/nav', async (req, res) => {
  if (!sec.hasKey()) return res.status(503).json({ error: 'Thai fund data unavailable' });
  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!id) return res.status(400).json({ error: 'Missing required query param "id"' });
  try {
    const nav = await wrap(`fundnav:${id}`, NAV_TTL_MS, () => sec.getFundNav(id));
    if (!nav) return res.status(404).json({ error: 'No NAV found' });
    return res.json(nav);
  } catch (err) {
    return res.status(502).json({ error: err?.message || 'Fund NAV failed' });
  }
});

export default router;
