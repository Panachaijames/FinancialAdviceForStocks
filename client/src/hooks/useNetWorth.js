// Shared net-worth computation in the active display currency:
// investments (live market value of holdings) + cash/savings.
import { useMemo } from 'react';
import { usePortfolioStore } from '../store/portfolioStore.js';
import { useSavingsStore } from '../store/savingsStore.js';
import useQuotes from './useQuotes.js';
import useFx from './useFx.js';
import useFunds from './useFunds.js';

export function useNetWorth() {
  const holdings = usePortfolioStore((s) => s.holdings);
  const savings = useSavingsStore((s) => s.savings);
  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const { quotes } = useQuotes(symbols);
  const { convert } = useFx();
  const { totalThb: fundsThb } = useFunds();

  // Per-asset-type market values (display currency) so callers can weight by mix
  // (e.g. the retirement tax-drag auto-suggest).
  const byType = {};
  let investments = 0;
  for (const h of holdings) {
    const q = quotes[h.symbol];
    const native = h.currency || (h.type === 'th_stock' ? 'THB' : 'USD');
    const price = q && Number(q.price) > 0 ? Number(q.price) : Number(h.avgCost) || 0;
    const mv = convert((Number(h.shares) || 0) * price, native);
    investments += mv;
    byType[h.type] = (byType[h.type] || 0) + mv;
  }
  const cash = savings.reduce((sum, s) => sum + convert(Number(s.amount) || 0, s.currency), 0);
  const funds = convert(fundsThb || 0, 'THB'); // Thai fund NAVs are in THB
  if (funds > 0) byType.thai_fund = (byType.thai_fund || 0) + funds;
  if (cash > 0) byType.cash = (byType.cash || 0) + cash;

  return { investments, cash, funds, net: investments + cash + funds, byType };
}

export default useNetWorth;
