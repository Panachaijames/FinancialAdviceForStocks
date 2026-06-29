import express from 'express';
import { wrap } from '../cache.js';
import * as gemini from '../providers/gemini.js';
import { getNews } from '../providers/yahoo.js';

const router = express.Router();

const ANALYSIS_TTL_MS = 2 * 60 * 1000; // 2 minutes — limits Gemini calls on repeat clicks

// POST /api/analysis  { holdings:[{symbol,name,shares,price,changePct,marketValue,plPct}], displayCurrency }
//   -> { text }
router.post('/', async (req, res) => {
  if (!gemini.hasKey()) {
    return res.status(503).json({ error: 'AI insights unavailable — set GEMINI_API_KEY in .env' });
  }
  const body = req.body || {};
  const holdings = Array.isArray(body.holdings) ? body.holdings : [];
  const displayCurrency = typeof body.displayCurrency === 'string' ? body.displayCurrency : 'USD';
  if (holdings.length === 0) {
    return res.status(400).json({ error: 'No holdings to analyze' });
  }
  try {
    const symbols = Array.from(new Set(holdings.map((h) => h && h.symbol).filter(Boolean)));
    // Cache by symbol set so rapid re-clicks don't burn Gemini quota.
    const key = `analysis:${displayCurrency}:${symbols.slice().sort().join(',')}`;
    const text = await wrap(key, ANALYSIS_TTL_MS, async () => {
      let news = [];
      try {
        news = await getNews(symbols);
      } catch {
        news = [];
      }
      return gemini.generateInsights({ holdings, news, displayCurrency });
    });
    return res.json({ text });
  } catch (err) {
    return res.status(502).json({ error: err?.message || 'AI analysis failed' });
  }
});

export default router;
