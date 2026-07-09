# PT Financial Advisor

A full-stack, multi-asset portfolio dashboard. Track **Thai stocks (SET)**, **US stocks & ETFs**, **crypto**, and **gold** in one portfolio with live prices, per-card real-time mini charts, a full TradingView-style chart with technical indicators, a dividend income calculator, live USD &harr; THB currency switching, and a portfolio news feed.

## What It Does

- **One unified portfolio** across SET stocks, US equities/ETFs, crypto, and gold.
- **Live prices** — crypto streams in real time from Binance; everything else is polled from Yahoo Finance and pushed over WebSocket.
- **Per-card mini charts** plus a full interactive chart with indicators (SMA, EMA, WMA, Bollinger Bands, RSI, MACD, Stochastic, ATR, VWAP, OBV).
- **Dividend income calculator** that aggregates expected annual / quarterly / monthly / weekly income across dividend-paying holdings.
- **Live currency switching** — flip the whole dashboard between USD and THB using a live USD/THB rate; each asset keeps its native currency and is converted on display.
- **Portfolio news feed** scoped to the symbols you hold.

## Architecture

```
PTFinancialAdvisorApp/
├── client/   React 18 + Vite SPA (zustand state, lightweight-charts)
└── server/   Node 20 / Express REST API + ws WebSocket realtime hub
```

- **Client** (`client/`): React + Vite single-page app. State via [zustand](https://github.com/pmndrs/zustand) with `localStorage` persistence; charts via [lightweight-charts](https://github.com/tradingview/lightweight-charts) v4. In dev, Vite proxies `/api` and `/ws` to the server.
- **Server** (`server/`): Express serves the JSON REST API under `/api`, and a WebSocket hub at `/ws` ref-counts subscribed symbols, streams crypto from Binance, polls Yahoo for everything else, and broadcasts the USD/THB FX rate to all clients.

## Data Sources (Free, No API Key Required)

The app works out of the box with **no API keys**. Each asset class is routed to the most reliable free source, with fallbacks:

| Data | Primary | Fallback |
| ---- | ------- | -------- |
| Crypto quotes & candles | **[CoinGecko](https://www.coingecko.com/en/api)** (no key) | yahoo-finance2 |
| Crypto realtime ticks | **Binance WebSocket** (`wss://stream.binance.com:9443`) | — |
| US stocks/ETFs & gold — quotes & candles | **[yahoo-finance2](https://www.npmjs.com/package/yahoo-finance2)** | **[Twelve Data](https://twelvedata.com)** (key) |
| Thai (SET) stocks — quotes & candles | **yahoo-finance2** | — (Twelve Data SET is a paid plan) |
| Dividends | **yahoo-finance2** | — |
| Portfolio news | **[Finnhub](https://finnhub.io)** (key) | yahoo-finance2 |
| USD/THB FX rate | **yahoo-finance2** (`USDTHB=X`) | **[open.er-api.com](https://open.er-api.com)** |

### Optional keys (recommended — already configured here)

The app runs with **zero keys**, but two free keys make it far more resilient and are wired up when present. Put them in **`.env.local`** at the repo root (already gitignored):

```ini
TWELVEDATA_KEY=your_twelvedata_key
FINNHUB_KEY=your_finnhub_key
```

- **Twelve Data** (`TWELVEDATA_KEY`) — fallback for US stock & gold **quotes and candles** when Yahoo throttles. Free plan is 8 req/min · 800/day, so it's used as a *fallback* (not the 5-second realtime poll) to stay within quota. SET (Thai) symbols need a paid plan, so Thai stays on Yahoo. Used by `server/providers/twelvedata.js`.
- **Finnhub** (`FINNHUB_KEY`) — *primary* news source: per-symbol company news for equities/ETFs, plus general market news to fill crypto/gold-only portfolios. Falls back to Yahoo news if unavailable. Used by `server/providers/finnhub.js`.
- **Google Gemini** (`GEMINI_API_KEY`) — powers the three AI panels (analysis only, never a price source): the portfolio **AI Insights** summary, the **AI Path Advisor** on the Plan tab (multi-round retirement research), and the per-symbol **AI Trade Scout** in the chart modal (short-term dossier). The last two run an iterative research loop (`server/providers/geminiDeep.js`) with **Google Search grounding**, so the model reads current news/macro and returns clickable sources. Rounds per analysis: `GEMINI_DEEP_ROUNDS` (default 3, clamped 1–10). Free key from [Google AI Studio](https://aistudio.google.com/apikey); grounded requests have their own free monthly allowance on the Gemini 3 tier.

Keys are loaded by `server/config.js` from `.env.local` → `.env` (repo root), accepting either `TWELVEDATA_KEY`/`FINNHUB_KEY` or the longer `*_API_KEY` names. FX intentionally does **not** use Twelve Data (the free open.er-api.com fallback is unlimited; TD quota is reserved for stock/gold data).

> **Note on `yahoo-finance2`:** this project pins **`2.13.4`**. The `2.14.x`/`3.x` releases changed the package export shape and slimmed the bundled modules, so `search`/`chart`/`quoteSummary` are not available from the default import there — don't bump it without adjusting `server/providers/yahoo.js`.
>
> **Yahoo rate-limiting:** Yahoo Finance is an unofficial, free endpoint that throttles bursty traffic per-IP (HTTP 429 "Too Many Requests"). The server already caches aggressively and retries 429s with backoff (`server/providers/yahoo.js`), so normal usage is fine. If you hammer it (e.g. rapid manual testing), stock/dividend/news data can come back empty for a few minutes until the throttle clears — crypto and FX are unaffected because they use other sources. To eliminate Yahoo dependence entirely you can wire an optional keyed provider (see below).

## Getting Started

Requirements: **Node.js 20+** (Node 18+ supported) and npm.

```bash
# from the repository root
npm install        # installs root + client + server workspaces
npm run dev        # starts the server and client together
```

Then open:

- **Client (UI):** http://localhost:5173
- **Server (API/WS):** http://localhost:8787

The dev script runs both workspaces concurrently (`concurrently`), with the Vite dev server proxying API and WebSocket traffic to the Node server.

### Production build

```bash
npm run build      # builds the client into client/dist
npm start          # runs the server (serves client/dist if present)
```

## Deployment

> **Why a plain Vercel/Netlify static deploy shows "Search unavailable":** this is a **full-stack** app. The React client calls a Node backend (`/api/*`) and a WebSocket (`/ws`). A static-only host serves the frontend but has **no backend**, so every data call fails and FX falls back to a placeholder rate. The realtime hub + Binance stream also need a **long-running process**, which serverless platforms (Vercel/Netlify functions) can't keep alive. So the backend must run on a host that allows persistent Node processes (Render, Railway, Fly.io, a VPS, …).

### Option A — one service on Render (recommended, simplest)

The Node server already serves the built client **and** the API **and** the WebSocket on one origin, so you deploy a single service:

1. Push this repo to GitHub.
2. [Render](https://render.com) → **New → Blueprint** → pick the repo (it reads [`render.yaml`](render.yaml)). Or **New → Web Service** with: Build `npm install --include=dev && npm run build`, Start `npm start`.
3. In the service's **Environment** tab, set `TWELVEDATA_KEY` and `FINNHUB_KEY` (your `.env.local` is gitignored and **not** deployed).
4. Open the Render URL — everything (search, quotes, charts, news, realtime) works on that one URL.

`PORT` is provided by Render automatically; `server/config.js` reads it. Note: Render's free tier sleeps after ~15 min idle (first request then takes ~30s to wake).

### Option B — keep the frontend on Vercel, backend on Render

If you want to keep your Vercel frontend:

1. Deploy the **backend** on Render (Option A steps 1–3; it'll still serve its own copy of the client, that's fine).
2. In your **Vercel** project → Settings → Environment Variables, add `VITE_API_BASE = https://YOUR-APP.onrender.com` (optionally `VITE_WS_URL = wss://YOUR-APP.onrender.com/ws`), then **redeploy**.
3. The client now calls the Render backend for REST + WebSocket. CORS is already enabled server-side.

> Set Vercel's **Root Directory** to `client` (Build `npm run build`, Output `dist`) so it builds only the frontend.

These envs default to empty → relative URLs, which is exactly what Option A and local dev (Vite proxy) need, so nothing else changes.

## Desktop App (Windows) — full features, no API keys

Yahoo Finance works on home/residential networks (it only blocks cloud datacenter IPs), so running the app **locally** gives every user the *complete* feature set — **Thai SET stocks, dividends, real-time, and news** — with **no API keys at all**. The project packages into a standalone Windows desktop app (Electron bundles its own Node runtime + browser, so users install nothing).

### Build the app

```bash
npm install
npm run pack:win
```

Output: `release/pt-financial-advisor-win32-x64/` containing **`PT Financial Advisor.exe`**. Double-click it — it starts the bundled server on a free local port and opens the dashboard in a desktop window. (How it works: [`electron/main.cjs`](electron/main.cjs) launches [`server/index.js`](server/index.js) in-process and points a window at it.)

### Share it with other people

Send them the zip produced alongside the build, `release/PT-Financial-Advisor-Windows-x64.zip` (or zip the `pt-financial-advisor-win32-x64` folder yourself). They **extract it and run `PT Financial Advisor.exe`** — no Node, no install, no keys, full features on their own network.

> **SmartScreen warning:** the build is unsigned, so Windows may show *"Windows protected your PC."* Click **More info → Run anyway**. To remove it permanently, sign the app with a code-signing certificate.

### Optional: single-file installer / portable `.exe`

For a one-file NSIS installer or portable exe, use electron-builder. It downloads a signing toolkit whose archive contains symlinks, so on Windows you must first enable **Developer Mode** (Settings → Privacy & security → For developers) **or** run the terminal **as Administrator**, then:

```bash
npm run dist
```

Artifacts land in `release/` (installer + portable `.exe`).

### Automated releases (GitHub Actions)

[`.github/workflows/release-windows.yml`](.github/workflows/release-windows.yml) builds the Windows app on GitHub's runners (which are elevated, so electron-builder's signing toolkit extracts cleanly — no Developer Mode needed) and attaches the installer + portable `.exe` to a GitHub Release on every version tag:

```bash
# bump "version" in package.json to match, then:
git tag v1.0.0
git push origin v1.0.0
```

The workflow then builds and publishes a Release `v1.0.0` with the `.exe` files attached — no secrets to configure (it uses the built-in `GITHUB_TOKEN`). You can also trigger it manually from the **Actions** tab (manual runs upload the `.exe` as a downloadable artifact instead of creating a Release).

## Configuration

All settings are optional and read from `.env.local` (preferred, gitignored) or `.env` at the repo root:

```ini
PORT=8787          # HTTP/WS server port
POLL_MS=5000       # realtime quote poll interval (non-crypto)
FX_POLL_MS=15000   # USD/THB FX poll interval
TWELVEDATA_KEY=    # optional — see "Optional keys" above
FINNHUB_KEY=       # optional — see "Optional keys" above
```

See [**Optional keys**](#optional-keys--recommended--already-configured-here) above for what the two keys enable.

## Symbol Conventions

The Yahoo Finance symbol is the canonical id stored in your portfolio:

| Asset        | Format        | Examples                       |
| ------------ | ------------- | ------------------------------ |
| US stock/ETF | plain ticker  | `AAPL`, `VOO`, `SCHD`          |
| Thai (SET)   | `TICKER.BK`   | `PTT.BK`, `CPALL.BK`, `KBANK.BK` |
| Crypto       | `COIN-USD`    | `BTC-USD`, `ETH-USD`, `SOL-USD` |
| Gold         | `GC=F`        | `GC=F` (or `XAUUSD=X`)         |
| Index        | `^SYMBOL`     | `^GSPC`                        |

## Troubleshooting

- **Port already in use** — change `PORT` in `.env` (server) and/or the `server.port` in `client/vite.config.js`. The Vite proxy targets must match the server `PORT`.
- **Prices not updating** — confirm the server is running on `8787` and the browser console shows a WebSocket connection to `/ws`. The socket auto-reconnects with backoff.
- **Rate limits / empty data** — Yahoo Finance is a free, unofficial source and may occasionally rate-limit or omit fields. The server caches responses (quotes ~4s, candles ~60s, dividends ~6h, news ~5min, FX ~30s) and falls back gracefully; retry after a moment.
- **`npm install` issues** — ensure you run it at the **repository root** so the `client` and `server` workspaces are installed together.

## Features

- Multi-asset portfolio with per-holding P/L (market value, cost basis, gain/loss %).
- Real-time quotes over WebSocket (crypto via Binance, others via Yahoo polling).
- Mini real-time chart on every asset card; full chart modal with technical indicators.
- Dividend income calculator aggregated across holdings.
- One-click USD &harr; THB display currency switching with a live rate.
- Symbol search and smart input normalization (e.g. `bitcoin` &rarr; `BTC-USD`, `gold` &rarr; `GC=F`).
- Portfolio-scoped news feed.
- **Plan tab** — savings/net-worth tracker; retirement & financial-freedom simulator with an **AI Path Advisor** (deep research on current Thai + US markets and macro → target allocation, glide path, RMF/Thai ESG wrapper order, scenarios, action checklist); dividend projection; DCA backtest; Thai personal income tax estimator (ปีภาษี 2568).
- **Thai tax estimator with legal references** — every bracket/deduction is mapped to its statutory basis (Revenue Code sections, royal decrees, ministerial regulations — verified against rd.go.th sources) in [`client/src/lib/thaiTaxLaw.js`](client/src/lib/thaiTaxLaw.js), viewable in-app via “ดูข้อกฎหมายอ้างอิง”.
- **AI Trade Scout** — per-symbol short-term (days-to-weeks) dossier in the chart modal: live-web-researched catalysts with sources, a technical read from server-computed indicators (SMA/RSI/MACD/volume), a hypothetical entry/stop/target scenario, the bear case, and what to watch next. Educational scenarios, not financial advice.
- **Trade ledger** — Buy/Sell buttons record what you did at your broker (no real orders): average-cost math, realized P/L per sale, history with LIFO undo, and **broker CSV import** (flexible column matching, preview before apply).
- **Investment tax report** — yearly realized P/L per asset class from the ledger with each class's Thai tax treatment (SET exempt, US remittance rule, crypto 2568–2572 exemption, …) linked to the legal sources.
- **Benchmark comparison** — your current mix indexed against the S&P 500 and SET Index over 3mo–2y.
- **Target allocation & rebalance** — set target weights per asset class; see live drift and the exact buy/sell amounts to restore them.
- **Price alerts** — above/below/day-move alerts per symbol, watched against live quotes; fire once with in-app banner + browser notification, re-armable.
- **Forecast lab** (Forecast tab) — client-side price prediction with three model families trained **in your browser** (nothing leaves your machine): an **LSTM** neural network (TensorFlow.js, lazy-loaded chunk; MAE loss, dropout + L2, dense head, early stopping), **ARIMA(p,1,q)** with optional **auto-ARIMA** order selection (AIC grid search), and **XGBoost-style gradient boosting** (pure JS). Features: 13 technical indicators + 9 macro-economic series (S&P 500, VIX, US 10Y, dollar index, gold, oil, USD/THB, SET, BTC) + optional **news-sentiment** (daily Finnhub headline tone, US stocks/ETFs, ~1y — decays to neutral in the forecast) + calendar. Each model is scored on a 60-day holdout (RMSE/MAE/direction vs a naive baseline), forecasts roll forward recursively with √t uncertainty bands, the boosting model reports feature importances, and a live training log + persisted run history record what was trained. Educational — daily returns are mostly noise, and the page says so.

## Tests

```bash
npm test           # node --test — Thai tax calculator + planning/retirement math
```

The tax tests assert hand-computed statutory values (e.g. ฿800,000 salary → ฿48,500 tax) for every bracket boundary, each deduction cap, the retirement-group 500,000 combined cap, the annuity 300,000 edge case, the Easy E-Receipt 30k/50k split, and the donation double/10%-cap interaction.
