// useCandles hook: fetch OHLCV candles for a symbol/range/interval with reload support.
import { useEffect, useState, useCallback, useRef } from 'react';
import { getCandles } from '../api/client.js';

/**
 * @param {string} symbol
 * @param {string} range
 * @param {string} interval
 * @returns {{ candles: Array, loading: boolean, error: string|null, reload: ()=>void }}
 */
export function useCandles(symbol, range = '6mo', interval = 'auto') {
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const reqIdRef = useRef(0);

  const reload = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!symbol) {
      setCandles([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    let active = true;
    const reqId = reqIdRef.current + 1;
    reqIdRef.current = reqId;

    setLoading(true);
    setError(null);

    getCandles(symbol, range, interval)
      .then((arr) => {
        if (!active || reqId !== reqIdRef.current) return;
        setCandles(Array.isArray(arr) ? arr : []);
      })
      .catch((err) => {
        if (!active || reqId !== reqIdRef.current) return;
        setError(err && err.message ? err.message : 'Failed to load candles');
        setCandles([]);
      })
      .finally(() => {
        if (active && reqId === reqIdRef.current) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [symbol, range, interval, nonce]);

  return { candles, loading, error, reload };
}

export default useCandles;
