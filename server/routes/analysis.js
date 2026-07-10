import express from 'express';
import { createHash } from 'node:crypto';
import { wrap } from '../cache.js';
import * as gemini from '../providers/gemini.js';
import { deepResearch, DEEP_ROUNDS } from '../providers/geminiDeep.js';
import { getNews, getQuotes, getCandles } from '../providers/yahoo.js';
import { technicalSnapshot, describeSnapshot } from '../util/indicators.js';
import {
  RETIREMENT_SYSTEM,
  buildRetirementTask,
  TRADE_SYSTEM,
  buildTradeTask,
} from '../util/deepPrompts.js';

const router = express.Router();

const ANALYSIS_TTL_MS = 2 * 60 * 1000; // 2 minutes — limits Gemini calls on repeat clicks
const RETIREMENT_TTL_MS = 15 * 60 * 1000; // deep research is slow + quota-heavy
const TRADE_TTL_MS = 5 * 60 * 1000; // short-term reads go stale fast

// Indices/FX fetched live so the retirement advisor sees today's tape alongside
// what it finds via search. Best-effort — missing symbols are just omitted.
const MACRO_SYMBOLS = ['^GSPC', '^IXIC', '^SET.BK', 'THB=X', '^TNX', 'GC=F', 'BTC-USD'];

const depthToRounds = (depth) => (depth === 'fast' ? 1 : DEEP_ROUNDS);

// POST /api/analysis  { holdings:[{symbol,name,shares,price,changePct,marketValue,plPct}], displayCurrency }
//   -> { text }
router.post('/', async (req, res) => {
  if (!gemini.hasKey()) {
    return res.status(503).json({ error: 'AI insights unavailable — set GEMINI_API_KEY in .env' });
  }
  const body = req.body || {};
  const holdings = Array.isArray(body.holdings) ? body.holdings : [];
  const displayCurrency = typeof body.displayCurrency === 'string' ? body.displayCurrency : 'USD';
  const goal = typeof body.goal === 'string' ? body.goal.trim().slice(0, 500) : '';
  const ageNum = Number(body.age);
  const age = Number.isFinite(ageNum) && ageNum > 0 && ageNum < 120 ? Math.round(ageNum) : null;
  if (holdings.length === 0) {
    return res.status(400).json({ error: 'No holdings to analyze' });
  }
  try {
    const symbols = Array.from(new Set(holdings.map((h) => h && h.symbol).filter(Boolean)));
    // Cache by symbol set + goal + age so different inputs don't collide, but
    // rapid re-clicks with the same inputs don't burn Gemini quota.
    const goalKey = goal ? createHash('sha1').update(goal).digest('hex').slice(0, 12) : 'none';
    const key = `analysis:${displayCurrency}:${goalKey}:${age || 'noage'}:${symbols.slice().sort().join(',')}`;
    const text = await wrap(key, ANALYSIS_TTL_MS, async () => {
      let news = [];
      try {
        news = await getNews(symbols);
      } catch {
        news = [];
      }
      return gemini.generateInsights({ holdings, news, displayCurrency, goal, age });
    });
    return res.json({ text });
  } catch (err) {
    return res.status(502).json({ error: err?.message || 'AI analysis failed' });
  }
});

// POST /api/analysis/retirement
//   { plan:{currentAge,retireAge,endAge,monthly,expense,pension,preReturn,postReturn,inflation,swr,invTax},
//     projection:{nestEggAtRetirement,realNestEgg,freedomNumber,freedomGap,monthlyExpenseAtRetirement,depletionAge},
//     holdings:[{symbol,name,type,marketValue,plPct}], displayCurrency, depth?:'fast'|'deep' }
//   -> { text, sources:[{title,url}], rounds }
router.post('/retirement', async (req, res) => {
  if (!gemini.hasKey()) {
    return res.status(503).json({ error: 'AI advisor unavailable — set GEMINI_API_KEY in .env' });
  }
  const body = req.body || {};
  const plan = body.plan || {};
  const projection = body.projection || {};
  const holdings = Array.isArray(body.holdings) ? body.holdings : [];
  const displayCurrency = typeof body.displayCurrency === 'string' ? body.displayCurrency : 'THB';
  const rounds = depthToRounds(body.depth);

  try {
    // Cache on the inputs that change the answer (hashed — inputs are long).
    const fingerprint = createHash('sha1')
      .update(JSON.stringify({ plan, projection: projection.freedomNumber, h: holdings.map((h) => h.symbol), displayCurrency, rounds }))
      .digest('hex');
    const key = `analysis:retirement:${fingerprint}`;
    const result = await wrap(key, RETIREMENT_TTL_MS, async () => {
      let macro = [];
      try {
        macro = (await getQuotes(MACRO_SYMBOLS)).filter(Boolean);
      } catch {
        macro = [];
      }
      const task = buildRetirementTask({ plan, projection, holdings, macro, displayCurrency });
      return deepResearch({ system: RETIREMENT_SYSTEM, task, rounds });
    });
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ error: err?.message || 'AI retirement analysis failed' });
  }
});

// POST /api/analysis/trade  { symbol, depth?:'fast'|'deep' }
//   -> { text, sources:[{title,url}], rounds }
router.post('/trade', async (req, res) => {
  if (!gemini.hasKey()) {
    return res.status(503).json({ error: 'AI trade scout unavailable — set GEMINI_API_KEY in .env' });
  }
  const body = req.body || {};
  const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : '';
  if (!symbol) {
    return res.status(400).json({ error: 'Missing "symbol"' });
  }
  const rounds = depthToRounds(body.depth);

  try {
    const key = `analysis:trade:${symbol}:${rounds}`;
    const result = await wrap(key, TRADE_TTL_MS, async () => {
      // Gather app-side context best-effort and in parallel; the dossier still
      // works (search-only) if any of these fail.
      const [quotes, candles, news] = await Promise.all([
        getQuotes([symbol]).catch(() => []),
        getCandles(symbol, '1y', '1d').catch(() => []),
        getNews([symbol]).catch(() => []),
      ]);
      const quote = (quotes || []).find((q) => q && q.symbol === symbol) || (quotes || [])[0] || null;
      const snapshotLines = describeSnapshot(technicalSnapshot(candles));
      const task = buildTradeTask({ symbol, quote, snapshotLines, news });
      return deepResearch({ system: TRADE_SYSTEM, task, rounds });
    });
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ error: err?.message || 'AI trade analysis failed' });
  }
});

export default router;
