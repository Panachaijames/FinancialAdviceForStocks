// useFx hook: provides the live USD->THB rate and a convert() to the display currency.
import { useEffect, useState, useCallback, useRef } from 'react';
import { getFx } from '../api/client.js';
import marketSocket from '../api/socket.js';
import { useSettingsStore } from '../store/settingsStore.js';
import { convert as pureConvert } from '../lib/format.js';

const DEFAULT_RATE = 36;

export function useFx() {
  const [fx, setFx] = useState(null);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const fxRef = useRef(null);

  useEffect(() => {
    let active = true;

    getFx('USD', 'THB')
      .then((data) => {
        if (active && data && Number.isFinite(Number(data.rate))) {
          fxRef.current = data;
          setFx(data);
        }
      })
      .catch(() => {
        // keep null; fall back to default rate below
      });

    marketSocket.ensureConnected();
    const unsub = marketSocket.onFx((data) => {
      if (data && Number.isFinite(Number(data.rate))) {
        fxRef.current = data;
        setFx(data);
      }
    });

    return () => {
      active = false;
      unsub();
    };
  }, []);

  const rate =
    fx && Number.isFinite(Number(fx.rate)) ? Number(fx.rate) : DEFAULT_RATE;

  /**
   * Convert a value from its native currency into the active display currency.
   * @param {number} value
   * @param {string} fromCurrency
   */
  const convert = useCallback(
    (value, fromCurrency) =>
      pureConvert(value, fromCurrency || 'USD', displayCurrency, rate),
    [displayCurrency, rate]
  );

  return { fx, rate, convert };
}

export default useFx;
