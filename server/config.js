import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Load env from the project root regardless of the process cwd (the server may
// be launched from the repo root or from the server/ workspace dir).
// Precedence: .env.local (highest) > .env > process cwd default. dotenv does not
// override already-set vars, so load the highest-priority file first.
const serverDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(serverDir, '..');
dotenv.config({ path: resolve(root, '.env.local') });
dotenv.config({ path: resolve(root, '.env') });
dotenv.config();

const toInt = (val, fallback) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const firstNonEmpty = (...vals) => {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
};

/**
 * Central server configuration. All values can be overridden via environment
 * variables (loaded from .env.local / .env at the repo root when present).
 */
export const config = {
  PORT: toInt(process.env.PORT, 8787),
  POLL_MS: toInt(process.env.POLL_MS, 15000),
  FX_POLL_MS: toInt(process.env.FX_POLL_MS, 15000),
  keys: {
    // Accept both the documented names (TWELVEDATA_KEY / FINNHUB_KEY) and the
    // longer *_API_KEY variants for convenience.
    twelveData: firstNonEmpty(process.env.TWELVEDATA_KEY, process.env.TWELVE_DATA_API_KEY),
    finnhub: firstNonEmpty(process.env.FINNHUB_KEY, process.env.FINNHUB_API_KEY),
    // Google Gemini — powers the optional AI Insights panel (analysis only, no
    // market data). Accepts GEMINI_API_KEY or GOOGLE_API_KEY.
    gemini: firstNonEmpty(process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY),
    // Thai SEC OpenAPI (read-only fund NAV data) — powers Thai mutual-fund
    // (RMF/LTF/SSF) tracking. Two free subscription keys.
    secFundDaily: firstNonEmpty(process.env.SEC_FUND_DAILY_KEY),
    secFactsheet: firstNonEmpty(process.env.SEC_FACTSHEET_KEY),
    // Upstash Redis (REST) — persistent store for cross-device portfolio sync.
    upstashUrl: firstNonEmpty(process.env.UPSTASH_REDIS_REST_URL),
    upstashToken: firstNonEmpty(process.env.UPSTASH_REDIS_REST_TOKEN),
  },
  // Gemini model id (override with GEMINI_MODEL). Flash = fast + free-tier friendly.
  geminiModel: firstNonEmpty(process.env.GEMINI_MODEL) || 'gemini-3.5-flash',
};

export default config;
