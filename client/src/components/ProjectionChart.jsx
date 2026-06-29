import React from 'react';
import { theme } from '../lib/theme.js';

/**
 * Lightweight responsive SVG line/area chart for projection series.
 * Plots each series by index (equal x spacing), auto-scaled to the combined max
 * (baseline 0). No external dependency.
 *
 * Props:
 *   series: [{ values: number[], color: string, area?: boolean, label?: string }]
 *   height: number (px, default 150)
 */
export default function ProjectionChart({ series = [], height = 150 }) {
  const VW = 1000; // viewBox width units
  const VH = 320; // viewBox height units
  const padX = 8;
  const padY = 16;

  const clean = (series || []).filter((s) => Array.isArray(s.values) && s.values.length > 0);
  const maxLen = clean.reduce((m, s) => Math.max(m, s.values.length), 0);
  let maxVal = 0;
  for (const s of clean) for (const v of s.values) if (Number.isFinite(v)) maxVal = Math.max(maxVal, v);
  if (maxVal <= 0) maxVal = 1;

  const x = (i, len) => padX + (len <= 1 ? 0 : (i / (len - 1)) * (VW - padX * 2));
  const y = (v) => VH - padY - (Math.max(0, v) / maxVal) * (VH - padY * 2);

  function pathFor(values) {
    const len = values.length;
    return values
      .map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i, len).toFixed(1)} ${y(v).toFixed(1)}`)
      .join(' ');
  }
  function areaFor(values) {
    const len = values.length;
    const top = pathFor(values);
    return `${top} L ${x(len - 1, len).toFixed(1)} ${(VH - padY).toFixed(1)} L ${x(0, len).toFixed(1)} ${(VH - padY).toFixed(1)} Z`;
  }

  // Horizontal gridlines at 0/50/100%.
  const grid = [0, 0.5, 1].map((f) => VH - padY - f * (VH - padY * 2));

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block' }}
      role="img"
      aria-label="Projection chart"
    >
      {grid.map((gy, i) => (
        <line
          key={i}
          x1={padX}
          x2={VW - padX}
          y1={gy}
          y2={gy}
          stroke={theme.colors.border}
          strokeWidth="1"
          opacity="0.5"
        />
      ))}
      {clean.map((s, i) => (
        <g key={i}>
          {s.area && (
            <path d={areaFor(s.values)} fill={s.color} fillOpacity="0.14" stroke="none" />
          )}
          <path
            d={pathFor(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ))}
    </svg>
  );
}
