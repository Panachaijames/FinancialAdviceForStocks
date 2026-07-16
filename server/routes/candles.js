import express from 'express';
import { wrap } from '../cache.js';
import { getCandles } from '../providers/yahoo.js';
import { getCryptoCandles } from '../providers/coingecko.js';
import * as twelvedata from '../providers/twelvedata.js';
import { isCrypto } from '../util/assetType.js';

const router = express.Router();

const CANDLES_TTL_MS = 60 * 1000; // 60 seconds

const VALID_RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', 'max']);
// Whitelist intervals — an invalid value was forwarded verbatim to Yahoo, which
// guarantees an uncached upstream miss (and a bad cache key) on every hit.
const VALID_INTERVALS = new Set(['auto', '1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo', '3mo']);

// GET /api/candles?symbol=X&range=R&interval=I  -> Candle[]
router.get('/', async (req, res) => {
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : '';
  if (!symbol) {
    return res.status(400).json({ error: 'Missing required query param "symbol"' });
  }

  let range = typeof req.query.range === 'string' ? req.query.range.trim() : '1mo';
  if (!VALID_RANGES.has(range)) {
    range = '1mo';
  }

  let interval =
    typeof req.query.interval === 'string' && req.query.interval.trim()
      ? req.query.interval.trim()
      : 'auto';
  if (!VALID_INTERVALS.has(interval)) {
    interval = 'auto';
  }

  try {
    const key = `candles:${symbol}:${range}:${interval}`;
    const candles = await wrap(key, CANDLES_TTL_MS, async () => {
      // Crypto: prefer CoinGecko, fall back to Yahoo if it returns nothing.
      if (isCrypto(symbol)) {
        const cg = await getCryptoCandles(symbol, range);
        if (cg && cg.length) return cg;
        return getCandles(symbol, range, interval);
      }
      // Stocks/gold: Yahoo primary, Twelve Data fallback (e.g. on Yahoo throttle).
      const y = await getCandles(symbol, range, interval);
      if (y && y.length) return y;
      if (twelvedata.hasKey()) {
        const td = await twelvedata.getCandles(symbol, range);
        if (td && td.length) return td;
      }
      return [];
    }, { emptyTtlMs: 45 * 1000 });
    return res.json(Array.isArray(candles) ? candles : []);
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Candles fetch failed' });
  }
});

export default router;
