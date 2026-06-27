import express from 'express';
import { wrap } from '../cache.js';
import { getQuotes } from '../providers/yahoo.js';
import { getCryptoQuotes } from '../providers/coingecko.js';
import * as twelvedata from '../providers/twelvedata.js';
import { isCrypto } from '../util/assetType.js';

const router = express.Router();

const QUOTE_TTL_MS = 4 * 1000; // 4 seconds

function parseSymbols(raw) {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// GET /api/quote?symbols=A,B,C  -> Quote[]
router.get('/', async (req, res) => {
  const symbols = parseSymbols(req.query.symbols);
  if (symbols.length === 0) {
    return res.status(400).json({ error: 'Missing required query param "symbols"' });
  }
  try {
    // Stable cache key irrespective of order/dupes.
    const uniqueSorted = Array.from(new Set(symbols)).sort();
    const key = `quote:${uniqueSorted.join(',')}`;
    const quotes = await wrap(key, QUOTE_TTL_MS, async () => {
      const crypto = uniqueSorted.filter(isCrypto);
      const rest = uniqueSorted.filter((s) => !isCrypto(s));
      const [cryptoQuotes, restQuotes] = await Promise.all([
        crypto.length ? getCryptoQuotes(crypto) : Promise.resolve([]),
        rest.length ? getQuotes(rest) : Promise.resolve([]),
      ]);
      // Fall back to Yahoo for any crypto symbol CoinGecko couldn't resolve.
      const have = new Set(cryptoQuotes.map((q) => q.symbol));
      const missingCrypto = crypto.filter((s) => !have.has(s));
      const cryptoFallback = missingCrypto.length ? await getQuotes(missingCrypto) : [];

      // Fall back to Twelve Data for any stock/gold symbol Yahoo couldn't return
      // (e.g. Yahoo rate-limiting). Thai SET isn't on the TD free plan and will
      // simply come back empty there.
      const haveRest = new Set(restQuotes.map((q) => q.symbol));
      const missingRest = rest.filter((s) => !haveRest.has(s));
      const restFallback =
        missingRest.length && twelvedata.hasKey() ? await twelvedata.getQuotes(missingRest) : [];

      return [...cryptoQuotes, ...cryptoFallback, ...restQuotes, ...restFallback];
    });
    return res.json(Array.isArray(quotes) ? quotes : []);
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Quote fetch failed' });
  }
});

export default router;
