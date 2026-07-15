// Trade-ledger math — pure functions, average-cost basis.
//
// The app records what the user DID at their broker (it never places orders).
// Buys blend into the position's average cost (fees increase the cost basis);
// sells realize P/L against the current average cost (fees reduce proceeds)
// and leave the average unchanged — the average-cost method Thai brokers use
// on statements. All amounts are in the holding's native currency.

const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};

/**
 * Apply a BUY to a position.
 * New average = (old shares × old avg + qty × price + fee) / (old + qty).
 * @param {{shares?:number, avgCost?:number}} pos
 * @param {{qty:number, price:number, fee?:number}} t
 * @returns {{shares:number, avgCost:number}}
 */
export function applyBuy(pos = {}, t = {}) {
  const shares = num(pos.shares);
  const avgCost = num(pos.avgCost);
  const qty = num(t.qty);
  const price = num(t.price);
  const fee = num(t.fee);
  if (qty <= 0) return { shares, avgCost };
  const newShares = shares + qty;
  const newAvg = (shares * avgCost + qty * price + fee) / newShares;
  return { shares: newShares, avgCost: newAvg };
}

/**
 * Apply a SELL to a position. Quantity is clamped to what is held.
 * Realized P/L = (price − avg cost) × qty − fee. Average cost is unchanged.
 * @param {{shares?:number, avgCost?:number}} pos
 * @param {{qty:number, price:number, fee?:number}} t
 * @returns {{shares:number, avgCost:number, soldQty:number, realized:number, costBasis:number}}
 */
export function applySell(pos = {}, t = {}) {
  const shares = num(pos.shares);
  const avgCost = num(pos.avgCost);
  const price = num(t.price);
  const fee = num(t.fee);
  const soldQty = Math.min(num(t.qty), shares);
  if (soldQty <= 0) {
    return { shares, avgCost, soldQty: 0, realized: 0, costBasis: avgCost };
  }
  const realized = (price - avgCost) * soldQty - fee;
  return {
    shares: shares - soldQty,
    avgCost, // average-cost method: selling does not change the average
    soldQty,
    realized,
    costBasis: avgCost,
  };
}

/**
 * Sum realized P/L from a transaction list, grouped by currency (sells only —
 * each sell stores its `realized` in the holding's native currency).
 * @param {Array<{side:string, realized?:number, currency?:string}>} transactions
 * @returns {Record<string, number>} e.g. { USD: 1234.5, THB: -800 }
 */
export function realizedByCurrency(transactions = []) {
  const out = {};
  for (const t of transactions || []) {
    if (!t || t.side !== 'sell') continue;
    const r = Number(t.realized);
    if (!Number.isFinite(r)) continue;
    const cur = t.currency || 'USD';
    out[cur] = (out[cur] || 0) + r;
  }
  return out;
}

/**
 * Realized P/L per symbol (native currency), for per-holding display.
 * @param {Array} transactions
 * @returns {Record<string, {realized:number, currency:string}>}
 */
export function realizedBySymbol(transactions = []) {
  const out = {};
  for (const t of transactions || []) {
    if (!t || t.side !== 'sell' || !t.symbol) continue;
    const r = Number(t.realized);
    if (!Number.isFinite(r)) continue;
    if (!out[t.symbol]) out[t.symbol] = { realized: 0, currency: t.currency || 'USD' };
    out[t.symbol].realized += r;
  }
  return out;
}

// ── dividends ────────────────────────────────────────────────────────────────
// Dividend ledger entries ({ side:'dividend', amount, wht, currency, at }) record
// income actually RECEIVED (as opposed to the projected income DividendPanel
// estimates). They never move the position. These are kept separate from the
// realized*-P/L helpers above — those mean capital gains from sells, which have a
// different Thai tax treatment. Total realized return = realized sells + dividends.

/**
 * Net cash from one dividend ledger entry: gross amount minus withholding tax.
 * @param {{side?:string, amount?:number, wht?:number}} t
 * @returns {number|null} net (amount − wht), or null if not a valid dividend entry
 */
export function dividendNet(t) {
  if (!t || t.side !== 'dividend') return null;
  const amount = Number(t.amount);
  if (!Number.isFinite(amount)) return null;
  const whtRaw = Number(t.wht);
  const wht = Number.isFinite(whtRaw) && whtRaw > 0 ? whtRaw : 0;
  return amount - Math.min(wht, amount);
}

/**
 * Net dividend income grouped by currency (received, after withholding).
 * @param {Array} transactions
 * @returns {Record<string, number>} e.g. { USD: 42.5, THB: 900 }
 */
export function dividendsByCurrency(transactions = []) {
  const out = {};
  for (const t of transactions || []) {
    const net = dividendNet(t);
    if (net === null) continue;
    const cur = t.currency || 'USD';
    out[cur] = (out[cur] || 0) + net;
  }
  return out;
}

/**
 * Net dividend income per symbol (native currency), for per-holding display.
 * @param {Array} transactions
 * @returns {Record<string, {net:number, currency:string}>}
 */
export function dividendsBySymbol(transactions = []) {
  const out = {};
  for (const t of transactions || []) {
    const net = dividendNet(t);
    if (net === null || !t.symbol) continue;
    if (!out[t.symbol]) out[t.symbol] = { net: 0, currency: t.currency || 'USD' };
    out[t.symbol].net += net;
  }
  return out;
}

/**
 * Replay ONE symbol's ledger in chronological order into its final position,
 * recomputing each buy/sell's snapshot + each sell's realized P/L and cost basis
 * against the shares actually held AT THAT TIME. This is what makes backdating,
 * editing, and deleting a past trade correct: order is derived from `at`, not
 * from when the row was entered. Dividends pass through untouched (they don't
 * move the position). Chronological order is by `at` (stable for ties).
 * @param {Array} txs all ledger entries for a single symbol
 * @returns {{ shares:number, avgCost:number, transactions:Array }} corrected entries (chronological)
 */
export function replayPosition(txs = []) {
  const sorted = [...(txs || [])]
    .filter(Boolean)
    .sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  let shares = 0;
  let avgCost = 0;
  const out = [];
  for (const t of sorted) {
    if (t.side === 'buy') {
      const prevShares = shares;
      const prevAvgCost = avgCost;
      const r = applyBuy({ shares, avgCost }, t);
      shares = r.shares;
      avgCost = r.avgCost;
      out.push({ ...t, prevShares, prevAvgCost });
    } else if (t.side === 'sell') {
      const prevShares = shares;
      const prevAvgCost = avgCost;
      const sale = applySell({ shares, avgCost }, t);
      shares = sale.shares;
      avgCost = sale.avgCost;
      out.push({
        ...t,
        qty: sale.soldQty, // clamped to what was held at that point in time
        realized: sale.realized,
        costBasis: sale.costBasis,
        prevShares,
        prevAvgCost,
      });
    } else {
      out.push({ ...t }); // dividend — position unchanged
    }
  }
  return { shares, avgCost, transactions: out };
}

export default {
  applyBuy,
  applySell,
  realizedByCurrency,
  realizedBySymbol,
  dividendNet,
  dividendsByCurrency,
  dividendsBySymbol,
  replayPosition,
};
