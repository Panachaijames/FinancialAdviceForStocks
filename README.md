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
| US/Thai stocks, ETFs, gold — quotes & candles | **[yahoo-finance2](https://www.npmjs.com/package/yahoo-finance2)** | — |
| Dividends & portfolio news | **yahoo-finance2** | — |
| USD/THB FX rate | **yahoo-finance2** (`USDTHB=X`) | **[open.er-api.com](https://open.er-api.com)** |

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

## Optional API Keys

None are required. If you want to wire up alternative providers later, copy `.env.example` to `.env` in the project root (or `server/`) and set:

```ini
PORT=8787
POLL_MS=5000
FX_POLL_MS=15000
# TWELVEDATA_KEY=
# FINNHUB_KEY=
```

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
