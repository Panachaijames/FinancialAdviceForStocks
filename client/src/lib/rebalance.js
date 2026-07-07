// Target-allocation / rebalance math — pure functions.
// Compares the live per-asset-type mix against user-set target weights and
// computes the buy/sell amount per type that would restore the targets.

/**
 * @param {Record<string, number>} valuesByType — current market value per type (display currency)
 * @param {Record<string, number>} targets — target percent per type (should sum to ~100)
 * @returns {{
 *   rows: {type:string, value:number, currentPct:number, targetPct:number, driftPct:number, amount:number}[],
 *   total:number, targetSum:number, maxDrift:number
 * }}
 *   amount > 0 = buy that much of the type; amount < 0 = sell. Rows are sorted
 *   by |drift| descending so the most off-target class is first.
 */
export function computeRebalance(valuesByType = {}, targets = {}) {
  const types = Array.from(
    new Set([
      ...Object.keys(valuesByType).filter((t) => Number(valuesByType[t]) > 0),
      ...Object.keys(targets).filter((t) => Number(targets[t]) > 0),
    ])
  );
  const total = types.reduce((s, t) => s + (Number(valuesByType[t]) || 0), 0);
  const targetSum = types.reduce((s, t) => s + (Number(targets[t]) || 0), 0);

  const rows = types.map((type) => {
    const value = Number(valuesByType[type]) || 0;
    const currentPct = total > 0 ? (value / total) * 100 : 0;
    const targetPct = Number(targets[type]) || 0;
    const driftPct = currentPct - targetPct;
    const amount = total > 0 ? (targetPct / 100) * total - value : 0;
    return { type, value, currentPct, targetPct, driftPct, amount };
  });
  rows.sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct));
  const maxDrift = rows.reduce((m, r) => Math.max(m, Math.abs(r.driftPct)), 0);
  return { rows, total, targetSum, maxDrift };
}

export default { computeRebalance };
