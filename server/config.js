import dotenv from 'dotenv';

dotenv.config();

const toInt = (val, fallback) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Central server configuration. All values can be overridden via environment
 * variables (loaded from a .env file when present).
 */
export const config = {
  PORT: toInt(process.env.PORT, 8787),
  POLL_MS: toInt(process.env.POLL_MS, 5000),
  FX_POLL_MS: toInt(process.env.FX_POLL_MS, 15000),
  keys: {
    twelveData: process.env.TWELVE_DATA_API_KEY || '',
    finnhub: process.env.FINNHUB_API_KEY || '',
  },
};

export default config;
