import express from 'express';
import { wrap } from '../cache.js';
import * as newsHistory from '../providers/newsHistory.js';

const router = express.Router();

const SENTIMENT_TTL_MS = 6 * 60 * 60 * 1000; // 6h — historical news barely changes

// GET /api/forecast/news-sentiment?symbol=AAPL&days=365
//   -> { symbol, supported, daily:[{date,score,count}], articles, coverageDays }
router.get('/news-sentiment', async (req, res) => {
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : '';
  if (!symbol) return res.status(400).json({ error: 'Missing "symbol"' });
  const days = Math.min(370, Math.max(30, parseInt(req.query.days, 10) || 365));
  if (!newsHistory.hasKey()) {
    // No key -> gracefully report "unsupported" so the UI just skips the feature.
    return res.json({ symbol: symbol.toUpperCase(), supported: false, daily: [], articles: 0, coverageDays: 0 });
  }
  try {
    const key = `news-sentiment:${symbol.toUpperCase()}:${days}`;
    const data = await wrap(key, SENTIMENT_TTL_MS, () => newsHistory.getNewsSentiment(symbol, days));
    return res.json(data);
  } catch (err) {
    return res.status(502).json({ error: err?.message || 'News sentiment failed' });
  }
});

export default router;
