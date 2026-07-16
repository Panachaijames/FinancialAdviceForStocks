// Historical portfolio performance by replaying the trade ledger against daily
// prices. Pure functions. For each day on a common axis it computes:
//   - marketValue: shares held that day × that day's close (carry-forward), summed
//   - invested:    net cash deployed = Σ buy(qty·price+fee) − Σ sell(qty·price−fee)
//   - realized:    cumulative realized P/L from sells + net dividends received
//
// Currency: native amounts are converted with a SINGLE fx rate per currency
// (today's — the app has no historical FX), the same honest approximation
// benchmark.js makes. Days before a symbol's first candle carry a null price and
// simply don't contribute to that day's market value.

const DAY = 86400; // seconds

const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Net cash of a single dividend entry (gross − withholding, clamped). */
function dividendNet(t) {
  const amount = num(t.amount);
  const wht = Math.min(Math.max(0, num(t.wht)), amount);
  return amount - wht;
}

/**
 * @param {object} args
 * @param {Array} args.transactions ledger entries (buy/sell/dividend)
 * @param {Record<string,{time:number,close:number}[]>} args.closesBySymbol daily candles (native ccy); time in SECONDS
 * @param {Record<string,string>} args.currencyBySymbol symbol -> native currency (for market-value conversion)
 * @param {(amount:number, fromCurrency:string)=>number} [args.convert] native -> display currency (default identity)
 * @returns {{ times:number[], marketValue:number[], invested:number[], realized:number[] }}
 *   times are epoch SECONDS (UTC day starts); all arrays share that length.
 */
export function buildPerformanceSeries({
  transactions = [],
  closesBySymbol = {},
  currencyBySymbol = {},
  convert = (v) => v,
} = {}) {
  // 1) Daily axis = union of every symbol's candle days (sorted ascending).
  const daySet = new Set();
  for (const s of Object.keys(closesBySymbol)) {
    for (const c of closesBySymbol[s] || []) {
      if (c && Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0) {
        daySet.add(Math.floor(c.time / DAY));
      }
    }
  }
  const days = Array.from(daySet).sort((a, b) => a - b);
  if (days.length === 0) return { times: [], marketValue: [], invested: [], realized: [] };
  const dayIndex = new Map(days.map((d, i) => [d, i]));

  // 2) Forward-filled close for each symbol across the axis (null before its first bar).
  const filled = {};
  for (const s of Object.keys(closesBySymbol)) {
    const m = new Map();
    for (const c of closesBySymbol[s] || []) {
      if (c && Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0) {
        m.set(Math.floor(c.time / DAY), c.close); // last bar of the day wins
      }
    }
    const arr = new Array(days.length).fill(null);
    let last = null;
    for (let i = 0; i < days.length; i += 1) {
      if (m.has(days[i])) last = m.get(days[i]);
      arr[i] = last;
    }
    filled[s] = arr;
  }

  // 3) Replay transactions in chronological order, advancing a pointer per day.
  const txs = transactions
    .filter((t) => t && t.symbol)
    .map((t) => ({ t, ms: Date.parse(t.at) || 0 }))
    .sort((a, b) => a.ms - b.ms);

  const marketValue = [];
  const invested = [];
  const realized = [];
  const shares = {};
  // Yahoo candles are back-adjusted for splits, so the share count multiplied
  // against them must be in split-adjusted units EVERY day. Track, per symbol,
  // the product of splits not yet reached; days before a split scale up by it so
  // market value stays continuous across the split instead of jumping ~ratio×.
  const futureSplit = {};
  for (const { t } of txs) {
    if (t.side === 'split') {
      const r = Number(t.ratio) > 0 ? Number(t.ratio) : 1;
      futureSplit[t.symbol] = (futureSplit[t.symbol] || 1) * r;
    }
  }
  let investedCum = 0;
  let realizedCum = 0;
  let p = 0;

  for (let i = 0; i < days.length; i += 1) {
    const dayEndMs = (days[i] + 1) * DAY * 1000; // exclusive end of this UTC day
    while (p < txs.length && txs[p].ms < dayEndMs) {
      const t = txs[p].t;
      const sym = t.symbol;
      const cur = t.currency || currencyBySymbol[sym] || 'USD';
      if (t.side === 'buy') {
        shares[sym] = (shares[sym] || 0) + num(t.qty);
        investedCum += convert(num(t.qty) * num(t.price) + num(t.fee), cur);
      } else if (t.side === 'sell') {
        shares[sym] = (shares[sym] || 0) - num(t.qty);
        investedCum -= convert(num(t.qty) * num(t.price) - num(t.fee), cur);
        realizedCum += convert(num(t.realized), cur);
      } else if (t.side === 'dividend') {
        realizedCum += convert(dividendNet(t), cur);
      } else if (t.side === 'split') {
        // A split rescales the share count; invested capital is unchanged. It's
        // now applied, so drop it from the future-adjustment factor.
        const ratio = Number(t.ratio) > 0 ? Number(t.ratio) : 1;
        shares[sym] = (shares[sym] || 0) * ratio;
        futureSplit[sym] = (futureSplit[sym] || 1) / ratio;
      }
      p += 1;
    }

    let mv = 0;
    for (const sym of Object.keys(shares)) {
      const sh = (shares[sym] || 0) * (futureSplit[sym] || 1); // adjusted to match back-adjusted prices
      if (sh <= 0) continue;
      const idx = dayIndex.get(days[i]);
      const px = filled[sym] ? filled[sym][idx] : null;
      if (px != null) mv += convert(sh * px, currencyBySymbol[sym] || 'USD');
    }
    marketValue.push(mv);
    invested.push(investedCum);
    realized.push(realizedCum);
  }

  return { times: days.map((d) => d * DAY), marketValue, invested, realized };
}

/**
 * Headline figures from a performance series. Total P/L = current market value −
 * net invested capital, which correctly credits cash already pulled out via
 * sells (so it doesn't look like a loss just because you sold): held value +
 * cash returned − cash in = marketValue − (buys − sells). The % is that P/L over
 * net invested (labelled as such in the UI, not a time-weighted return).
 * @param {{marketValue:number[], invested:number[], realized:number[]}} series
 */
export function summarize(series = {}) {
  const mv = series.marketValue || [];
  const inv = series.invested || [];
  const rz = series.realized || [];
  const currentValue = mv.length ? mv[mv.length - 1] : 0;
  const netInvested = inv.length ? inv[inv.length - 1] : 0;
  const realized = rz.length ? rz[rz.length - 1] : 0;
  const totalPL = currentValue - netInvested;
  const plPct = netInvested > 0 ? (totalPL / netInvested) * 100 : null;
  return { currentValue, netInvested, realized, totalPL, plPct };
}

export default { buildPerformanceSeries, summarize };
