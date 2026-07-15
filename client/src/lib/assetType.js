// Asset classification + symbol conventions now come from the `shared` workspace
// (shared/assetType.js) — the single source of truth shared with the server, so
// the two can never drift again (that drift caused the "dot" -> bogus DOT stock,
// toBinanceSymbol('AAPL') -> 'aaplusdt', and HKD/SGD misclassification bugs).
// Only assetMeta below is client-only (UI display metadata).
export * from 'shared/assetType.js';

const META = {
  us_stock: { label: 'US Stock', color: '#3b82f6', emoji: '🇺🇸' },
  th_stock: { label: 'Thai Stock', color: '#22c55e', emoji: '🇹🇭' },
  crypto: { label: 'Crypto', color: '#a78bfa', emoji: '🪙' },
  gold: { label: 'Gold', color: '#f59e0b', emoji: '🥇' },
  etf: { label: 'ETF', color: '#06b6d4', emoji: '📊' },
  index: { label: 'Index', color: '#64748b', emoji: '📈' },
  other: { label: 'Other', color: '#94a3b8', emoji: '💠' },
};

/**
 * Display metadata (label / color / emoji) for an asset type. UI-only.
 */
export function assetMeta(type) {
  return META[type] || META.other;
}
