// Shared net-worth computation in the active display currency:
// investments (live market value of holdings) + cash/savings.
import { useMemo } from 'react';
import { usePortfolioStore } from '../store/portfolioStore.js';
import { useSavingsStore } from '../store/savingsStore.js';
import useQuotes from './useQuotes.js';
import useFx from './useFx.js';

export function useNetWorth() {
  const holdings = usePortfolioStore((s) => s.holdings);
  const savings = useSavingsStore((s) => s.savings);
  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const { quotes } = useQuotes(symbols);
  const { convert } = useFx();

  const investments = holdings.reduce((sum, h) => {
    const q = quotes[h.symbol];
    const native = h.currency || (h.type === 'th_stock' ? 'THB' : 'USD');
    const price = q && Number.isFinite(Number(q.price)) ? Number(q.price) : Number(h.avgCost) || 0;
    return sum + convert((Number(h.shares) || 0) * price, native);
  }, 0);
  const cash = savings.reduce((sum, s) => sum + convert(Number(s.amount) || 0, s.currency), 0);

  return { investments, cash, net: investments + cash };
}

export default useNetWorth;
