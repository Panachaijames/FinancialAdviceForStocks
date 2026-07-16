// Stock-split detection helpers (pure). A split is "applied" once a
// side:'split' ledger entry exists for that symbol+date, so the ledger itself
// is the source of truth — no separate applied-flag to keep in sync.

/** Day key (YYYY-MM-DD) used to match a split to its ledger entry. */
export function splitDayKey(dateIso) {
  return String(dateIso || '').slice(0, 10);
}

/** Set of day-keys already recorded as split entries for a symbol. */
export function appliedSplitDays(transactions = [], symbol) {
  const set = new Set();
  for (const t of transactions || []) {
    if (t && t.side === 'split' && t.symbol === symbol && t.at) set.add(splitDayKey(t.at));
  }
  return set;
}

/**
 * Splits that this holding hasn't accounted for yet: a real ratio (≠1), dated
 * AFTER the holding started being tracked (earlier splits are already reflected
 * in the shares the user entered), and not already in the ledger.
 * @param {Array<{date:string, ratio:number, numerator?:number, denominator?:number, text?:string}>} splits
 * @param {Array} transactions   the full ledger (all symbols)
 * @param {{symbol:string, addedAt?:string}} holding
 * @returns {Array} pending splits (same shape as input), oldest first
 */
export function pendingSplits(splits, transactions, holding) {
  if (!holding || !Array.isArray(splits)) return [];
  // Boundary = when this position started. For a ledgered symbol that's the
  // EARLIEST (possibly backdated) buy/sell, not addedAt (always stamped "now"),
  // so a split between a backdated buy and today is still detected.
  let sinceMs = Date.parse(holding.addedAt) || 0;
  for (const tx of transactions || []) {
    if (tx && tx.symbol === holding.symbol && (tx.side === 'buy' || tx.side === 'sell')) {
      const ms = Date.parse(tx.at);
      if (Number.isFinite(ms) && ms < sinceMs) sinceMs = ms;
    }
  }
  const applied = appliedSplitDays(transactions, holding.symbol);
  return splits
    .filter((s) => {
      const ratio = Number(s && s.ratio);
      const ms = Date.parse(s && s.date);
      if (!(ratio > 0) || ratio === 1 || !Number.isFinite(ms)) return false;
      if (ms <= sinceMs) return false; // predates tracking
      if (applied.has(splitDayKey(s.date))) return false;
      return true;
    })
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/** Apply a split ratio to a position: ×ratio shares, ÷ratio average cost. */
export function applySplitToPosition(shares, avgCost, ratio) {
  const r = Number(ratio) > 0 ? Number(ratio) : 1;
  return {
    shares: (Number(shares) || 0) * r,
    avgCost: r > 0 ? (Number(avgCost) || 0) / r : Number(avgCost) || 0,
  };
}

/** Human label like "10-for-1" from a split's numerator/denominator or text. */
export function splitLabel(split) {
  if (!split) return '';
  const n = Number(split.numerator);
  const d = Number(split.denominator);
  if (n > 0 && d > 0) return `${n}-for-${d}`;
  return split.text || '';
}

export default { splitDayKey, appliedSplitDays, pendingSplits, applySplitToPosition, splitLabel };
