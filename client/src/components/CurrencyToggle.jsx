import React from 'react';
import { theme } from '../lib/theme.js';
import { fmtNumber } from '../lib/format.js';
import { useSettingsStore } from '../store/settingsStore.js';
import useFx from '../hooks/useFx.js';

/**
 * Segmented USD|THB control wired to the settings store.
 * Shows the live "1 USD = xx.x THB" rate from useFx.
 */
export default function CurrencyToggle() {
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const setDisplayCurrency = useSettingsStore((s) => s.setDisplayCurrency);
  const { rate } = useFx();

  const options = ['USD', 'THB'];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(2) }}>
      <span
        style={{
          fontSize: 12,
          color: theme.colors.textDim,
          fontFamily: theme.mono,
          whiteSpace: 'nowrap',
        }}
        title="Live USD to THB exchange rate"
      >
        1 USD = {rate ? fmtNumber(rate, 2) : '--'} THB
      </span>
      <div className="segmented" role="group" aria-label="Display currency">
        {options.map((cur) => {
          const active = displayCurrency === cur;
          return (
            <button
              key={cur}
              type="button"
              className="segmented-item"
              onClick={() => setDisplayCurrency(cur)}
              aria-pressed={active}
              style={{
                background: active ? theme.colors.accent : 'transparent',
                color: active ? '#ffffff' : theme.colors.textDim,
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                border: 'none',
                transition: 'background 0.15s ease, color 0.15s ease',
              }}
            >
              {cur}
            </button>
          );
        })}
      </div>
    </div>
  );
}
