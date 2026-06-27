import express from 'express';
import { wrap } from '../cache.js';
import { getNews } from '../providers/yahoo.js';

const router = express.Router();

const NEWS_TTL_MS = 5 * 60 * 1000; // 5 minutes

function parseSymbols(raw) {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// GET /api/news?symbols=A,B  -> NewsItem[]
router.get('/', async (req, res) => {
  const symbols = parseSymbols(req.query.symbols);
  try {
    const uniqueSorted = Array.from(new Set(symbols)).sort();
    const key = `news:${uniqueSorted.join(',')}`;
    const news = await wrap(key, NEWS_TTL_MS, () => getNews(uniqueSorted));
    return res.json(Array.isArray(news) ? news : []);
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'News fetch failed' });
  }
});

export default router;
