import React from 'react';
import { theme } from '../../lib/theme.js';
import { SERIES_COLORS } from './ForecastChart.jsx';

/** Tiny SVG loss-curve sparkline (min/max normalized). (Extracted from ForecastView.) */
export default function LossSparkline({ loss, valLoss }) {
  const W = 360;
  const H = 80;
  const all = [...loss, ...valLoss.filter((v) => v != null)];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const path = (arr) =>
    arr
      .map((v, i) => (v == null ? null : `${i === 0 || arr[i - 1] == null ? 'M' : 'L'} ${(i / (arr.length - 1)) * (W - 4) + 2} ${H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8)}`))
      .filter(Boolean)
      .join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 80, display: 'block' }} role="img" aria-label="LSTM loss curve">
      <path d={path(loss)} fill="none" stroke={SERIES_COLORS.lstm} strokeWidth="2" />
      {valLoss.some((v) => v != null) && <path d={path(valLoss)} fill="none" stroke={theme.colors.textDim} strokeWidth="1.5" strokeDasharray="4,3" />}
    </svg>
  );
}
