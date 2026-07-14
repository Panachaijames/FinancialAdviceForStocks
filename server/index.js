import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import yahooFinance from 'yahoo-finance2';

import { config } from './config.js';
import { attach, hubStats } from './realtime/hub.js';
import { getStats as tdStats } from './providers/twelvedata.js';
import { size as cacheSize } from './cache.js';

import searchRouter from './routes/search.js';
import quoteRouter from './routes/quote.js';
import candlesRouter from './routes/candles.js';
import dividendsRouter from './routes/dividends.js';
import newsRouter from './routes/news.js';
import fxRouter from './routes/fx.js';
import analysisRouter from './routes/analysis.js';
import fundsRouter from './routes/funds.js';
import syncRouter from './routes/sync.js';
import forecastRouter from './routes/forecast.js';
import { isConfigured as syncConfigured } from './providers/kv.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Suppress noisy yahoo-finance2 notices (no-op if the provider already did it).
try {
  yahooFinance.suppressNotices(['yahooSurvey', 'ripHistorical']);
} catch {
  // ignore — older/newer versions may differ
}

const app = express();

// Render (and most PaaS) sit behind a proxy that sets X-Forwarded-For. Trust
// one hop so express-rate-limit keys off the real client IP rather than lumping
// every client under the proxy's address (which would throttle everyone as one).
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

// ── Rate limiting (0.2) ──────────────────────────────────────────────────────
// The Render URL is public with wide-open CORS. Without limits a stranger can
// loop random symbols through the web-grounded Gemini analysis (3 calls each),
// drain the Twelve Data quota, or hammer the anonymous sync KV store. The
// global limiter is applied below, AFTER the health route, so the keep-alive
// pings never trip it.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300, // ~300 requests / 15 min / IP across the whole API
  standardHeaders: true,
  legacyHeaders: false,
});
const analysisLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10, // web-grounded Gemini calls are expensive — 10 / hour / IP
  standardHeaders: true,
  legacyHeaders: false,
});
const syncLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30, // anonymous KV writes — 30 / hour / IP
  standardHeaders: true,
  legacyHeaders: false,
});

// Health check. `providers` reports which keyed fallbacks loaded — handy for
// verifying the packaged desktop app actually picked up its bundled .env.
app.get('/api/health', (req, res) => {
  const td = tdStats();
  res.json({
    ok: true,
    ts: Date.now(),
    providers: {
      yahoo: true,
      twelveData: !!config.keys.twelveData,
      finnhub: !!config.keys.finnhub,
      gemini: !!config.keys.gemini,
      secFunds: !!config.keys.secApi,
      sync: syncConfigured(),
    },
    // Live operational counters (5.2) — a 429 storm or quota burn is now visible
    // in Render logs AND here, instead of being silently swallowed.
    stats: {
      wsClients: hubStats.clients,
      wsSymbols: hubStats.symbols,
      twelveDataCallsToday: td.callsToday,
      twelveDataCooling: td.cooling,
      cacheEntries: cacheSize(),
    },
  });
});

// Global per-IP limiter for everything under /api (health is above, unthrottled).
app.use('/api', apiLimiter);

// API routers.
app.use('/api/search', searchRouter);
app.use('/api/quote', quoteRouter);
app.use('/api/candles', candlesRouter);
app.use('/api/dividends', dividendsRouter);
app.use('/api/news', newsRouter);
app.use('/api/fx', fxRouter);
app.use('/api/analysis', analysisLimiter, analysisRouter);
app.use('/api/funds', fundsRouter);
app.use('/api/sync', syncLimiter, syncRouter);
app.use('/api/forecast', forecastRouter);

// Optionally serve the built client if it exists. CLIENT_DIST lets the packaged
// desktop (Electron) app point at the bundled client build wherever it lands.
const clientDist = process.env.CLIENT_DIST
  ? path.resolve(process.env.CLIENT_DIST)
  : path.resolve(__dirname, '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback for non-API GET routes.
  app.get(/^(?!\/api\/|\/ws).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    const indexHtml = path.join(clientDist, 'index.html');
    if (fs.existsSync(indexHtml)) {
      return res.sendFile(indexHtml);
    }
    return next();
  });
}

// JSON 404 for unmatched API routes.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Centralized error handler -> always JSON.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  res.status(err?.status || 500).json({ error: err?.message || 'Internal server error' });
});

const server = http.createServer(app);

// Attach the realtime WebSocket hub (path '/ws').
attach(server);

server.listen(config.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`PT Financial Advisor server listening on http://localhost:${config.PORT}`);
  // eslint-disable-next-line no-console
  console.log(`  REST:  http://localhost:${config.PORT}/api`);
  // eslint-disable-next-line no-console
  console.log(`  WS:    ws://localhost:${config.PORT}/ws`);
});

export default app;
