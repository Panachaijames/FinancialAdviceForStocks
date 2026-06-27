// useQuotes hook: initial REST snapshot + live WS updates for a set of symbols.
import { useEffect, useRef, useState } from 'react';
import { getQuotes } from '../api/client.js';
import marketSocket from '../api/socket.js';

/**
 * @param {string[]} symbols
 * @returns {{ quotes: Record<string, object>, loading: boolean }}
 */
export function useQuotes(symbols) {
  const list = Array.isArray(symbols) ? symbols.filter(Boolean) : [];
  const key = list.slice().sort().join(',');

  const [quotes, setQuotes] = useState({});
  const [loading, setLoading] = useState(list.length > 0);

  // Keep a ref of the latest quotes so the WS callback can merge without re-subscribing.
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;

  useEffect(() => {
    const symbolList = key ? key.split(',') : [];

    if (symbolList.length === 0) {
      setQuotes({});
      setLoading(false);
      return undefined;
    }

    let active = true;
    setLoading(true);

    getQuotes(symbolList)
      .then((arr) => {
        if (!active) return;
        const map = {};
        for (const q of arr || []) {
          if (q && q.symbol) map[q.symbol] = q;
        }
        setQuotes((prev) => ({ ...prev, ...map }));
      })
      .catch(() => {
        // ignore; live updates may still arrive
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    marketSocket.ensureConnected();
    marketSocket.subscribe(symbolList);

    const wanted = new Set(symbolList);
    const unsub = marketSocket.onQuote((quote) => {
      if (!active || !quote || !quote.symbol) return;
      if (!wanted.has(quote.symbol)) return;
      setQuotes((prev) => {
        const existing = prev[quote.symbol];
        // Merge so partial updates don't wipe fields.
        return {
          ...prev,
          [quote.symbol]: existing ? { ...existing, ...quote } : quote,
        };
      });
    });

    return () => {
      active = false;
      unsub();
      marketSocket.unsubscribe(symbolList);
    };
  }, [key]);

  return { quotes, loading };
}

export default useQuotes;
