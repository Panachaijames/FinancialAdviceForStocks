import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import express from 'express';
import cors from 'cors';
import yahooFinance from 'yahoo-finance2';

import { config } from './config.js';
import { attach } from './realtime/hub.js';

import searchRouter from './routes/search.js';
import quoteRouter from './routes/quote.js';
import candlesRouter from './routes/candles.js';
import dividendsRouter from './routes/dividends.js';
import newsRouter from './routes/news.js';
import fxRouter from './routes/fx.js';
import analysisRouter from './routes/analysis.js';
import fundsRouter from './routes/funds.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Suppress noisy yahoo-finance2 notices (no-op if the provider already did it).
try {
  yahooFinance.suppressNotices(['yahooSurvey', 'ripHistorical']);
} catch {
  // ignore — older/newer versions may differ
}

const app = express();

app.use(cors());
app.use(express.json());

// Health check. `providers` reports which keyed fallbacks loaded — handy for
// verifying the packaged desktop app actually picked up its bundled .env.
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    providers: {
      yahoo: true,
      twelveData: !!config.keys.twelveData,
      finnhub: !!config.keys.finnhub,
      gemini: !!config.keys.gemini,
      secFunds: !!(config.keys.secFundDaily && config.keys.secFactsheet),
    },
  });
});

// API routers.
app.use('/api/search', searchRouter);
app.use('/api/quote', quoteRouter);
app.use('/api/candles', candlesRouter);
app.use('/api/dividends', dividendsRouter);
app.use('/api/news', newsRouter);
app.use('/api/fx', fxRouter);
app.use('/api/analysis', analysisRouter);
app.use('/api/funds', fundsRouter);

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
