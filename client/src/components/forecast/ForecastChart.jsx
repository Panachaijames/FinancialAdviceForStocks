import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { theme } from '../../lib/theme.js';
import { fmtMoney } from '../../lib/format.js';
import { useT } from '../../lib/i18n.js';

// Series palette — validated (dataviz six checks, dark surface): fixed slot
// order; green/red are NOT used for series (reserved app-wide for up/down).
export const SERIES_COLORS = {
  history: '#9aa4b8', // neutral context line (not a categorical slot)
  arima: '#3987e5',
  gbdt: '#c98500',
  lstm: '#9085e9',
  ensemble: '#d55181',
};

const PAD = { top: 10, right: 86, bottom: 22, left: 56 };

function fmtDate(sec) {
  const d = new Date(sec * 1000);
  return `${d.getUTCDate()} ${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}`;
}

/**
 * Price-forecast chart: historical closes (solid neutral) + one dashed line
 * per model + a translucent uncertainty band per model, on ONE shared y axis.
 * Hover shows a crosshair + tooltip with every series' value at that date.
 *
 * Props:
 *   historyDates / historyCloses — tail of actual daily closes
 *   forecasts — [{ key, label, color, dates[], closes[], band?: {lower[], upper[]}, dash?, opacity? }]
 *   events — [{ date (unix sec), score (-1..1), title }] news flags on the timeline
 *   currency, height
 */
export default function ForecastChart({ historyDates = [], historyCloses = [], forecasts = [], events = [], currency = 'USD', height = 300 }) {
  const t = useT();
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState(null); // global index

  useLayoutEffect(() => {
    if (!wrapRef.current) return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w && Math.abs(w - width) > 2) setWidth(w);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  });

  const layout = useMemo(() => {
    const horizon = forecasts.reduce((m, f) => Math.max(m, f.closes.length), 0);
    const nHist = historyCloses.length;
    const total = nHist + horizon;
    if (total < 2) return null;

    const allDates = [...historyDates];
    const fDates = forecasts.find((f) => f.dates && f.dates.length === horizon)?.dates || [];
    for (let i = 0; i < horizon; i += 1) allDates.push(fDates[i] ?? (allDates[allDates.length - 1] || 0) + 86400);

    let lo = Infinity;
    let hi = -Infinity;
    const eat = (v) => {
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    };
    historyCloses.forEach(eat);
    for (const f of forecasts) {
      f.closes.forEach(eat);
      if (f.band) {
        f.band.lower.forEach(eat);
        f.band.upper.forEach(eat);
      }
    }
    if (!(hi > lo)) return null;
    const padY = (hi - lo) * 0.05;
    lo -= padY;
    hi += padY;

    const iw = width - PAD.left - PAD.right;
    const ih = height - PAD.top - PAD.bottom;
    const x = (i) => PAD.left + (i / (total - 1)) * iw;
    const y = (v) => PAD.top + (1 - (v - lo) / (hi - lo)) * ih;
    return { total, nHist, horizon, allDates, lo, hi, x, y, iw, ih };
  }, [historyDates, historyCloses, forecasts, width, height]);

  if (!layout) return null;
  const { total, nHist, allDates, lo, hi, x, y } = layout;

  const linePath = (startIdx, values) =>
    values
      .map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(startIdx + i).toFixed(1)} ${y(v).toFixed(1)}`)
      .join(' ');

  const bandPath = (startIdx, lower, upper) => {
    const up = upper.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(startIdx + i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    const down = lower
      .slice()
      .reverse()
      .map((v, i) => `L ${x(startIdx + lower.length - 1 - i).toFixed(1)} ${y(v).toFixed(1)}`)
      .join(' ');
    return `${up} ${down} Z`;
  };

  // Recessive grid: 4 lines + y tick labels.
  const ticks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * (i + 0.5)) / 4);
  const xTickIdx = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (total - 1)));

  function onMove(e) {
    const rect = wrapRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - PAD.left) / (width - PAD.left - PAD.right)) * (total - 1));
    setHover(Math.max(0, Math.min(total - 1, i)));
  }

  // Tooltip rows for the hovered index.
  const tipRows = [];
  if (hover != null) {
    if (hover < nHist) {
      tipRows.push({ label: t('fchart.actual'), color: SERIES_COLORS.history, value: historyCloses[hover] });
    } else {
      const fi = hover - nHist;
      for (const f of forecasts) {
        // Illustrative scenario branches aren't model predictions — keep them
        // out of the value tooltip (they're summarised in the News panel).
        if (f.kind === 'scenario') continue;
        if (fi < f.closes.length && Number.isFinite(f.closes[fi])) tipRows.push({ label: f.label, color: f.color, value: f.closes[fi] });
      }
    }
  }
  const tipLeft = hover != null ? Math.min(x(hover) + 12, width - 190) : 0;

  // News flags: snap each event to the nearest plotted history date. Colored by
  // headline tone (green up / red down / faint neutral), drawn near the top with
  // a faint stem to the price line; hover shows the headline via native <title>.
  // Events that snap to the SAME index (distinct calendar days often collapse
  // near "today") are merged into one flag so none hides another's tooltip.
  const evColor = (s) => (s > 0.05 ? theme.colors.up : s < -0.05 ? theme.colors.down : theme.colors.textFaint);
  const byIdx = new Map();
  for (const ev of events || []) {
    if (!Number.isFinite(ev.date) || nHist === 0) continue;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < nHist; i += 1) {
      const d = Math.abs((allDates[i] || 0) - ev.date);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const g = byIdx.get(best) || { idx: best, scoreSum: 0, n: 0, titles: [] };
    g.scoreSum += Number.isFinite(ev.score) ? ev.score : 0;
    g.n += 1;
    if (ev.title) g.titles.push(ev.title);
    byIdx.set(best, g);
  }
  const eventMarkers = [...byIdx.values()].map((g) => ({
    idx: g.idx,
    score: g.n ? g.scoreSum / g.n : 0,
    title: g.titles.slice(0, 6).join('\n') + (g.titles.length > 6 ? `\n(+${g.titles.length - 6} more)` : ''),
  }));

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <svg width={width} height={height} role="img" aria-label={t('fchart.aria_label')} style={{ display: 'block' }} onMouseLeave={() => setHover(null)}>
        {/* grid */}
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke={theme.colors.border} strokeWidth="1" opacity="0.5" />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize="10" fill={theme.colors.textFaint} fontFamily={theme.mono}>
              {fmtMoney(v, currency).replace(/\.\d+$/, '')}
            </text>
          </g>
        ))}
        {/* x ticks */}
        {xTickIdx.map((i) => (
          <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="10" fill={theme.colors.textFaint}>
            {fmtDate(allDates[i])}
          </text>
        ))}

        {/* uncertainty bands (behind lines) */}
        {forecasts.map(
          (f) =>
            f.band && (
              <path key={`b-${f.key}`} d={bandPath(nHist, f.band.lower, f.band.upper)} fill={f.color} fillOpacity="0.10" stroke="none" />
            )
        )}

        {/* "today" divider */}
        <line x1={x(nHist - 1)} x2={x(nHist - 1)} y1={PAD.top} y2={height - PAD.bottom} stroke={theme.colors.textFaint} strokeWidth="1" strokeDasharray="2,4" />
        <text x={x(nHist - 1)} y={PAD.top + 2} textAnchor="middle" fontSize="9" fill={theme.colors.textFaint}>
          {t('fchart.today')}
        </text>

        {/* history line (solid, neutral context) */}
        <path d={linePath(0, historyCloses)} fill="none" stroke={SERIES_COLORS.history} strokeWidth="2" strokeLinejoin="round" />

        {/* forecast lines (dashed = predicted) — connect from last actual close */}
        {forecasts.map((f) => (
          <path
            key={f.key}
            d={linePath(nHist - 1, [historyCloses[nHist - 1], ...f.closes])}
            fill="none"
            stroke={f.color}
            strokeWidth={f.width || 2}
            strokeDasharray={f.dash || '5,4'}
            strokeLinejoin="round"
            opacity={f.opacity ?? 1}
          />
        ))}

        {/* direct labels at line ends: colored chip + text-token label */}
        {forecasts.map((f, i) => {
          const last = f.closes[f.closes.length - 1];
          if (!Number.isFinite(last)) return null;
          const yy = y(last);
          return (
            <g key={`l-${f.key}`}>
              <circle cx={width - PAD.right + 8} cy={yy} r="3" fill={f.color} />
              <text x={width - PAD.right + 14} y={yy + 3.5} fontSize="10" fill={theme.colors.textDim}>
                {f.label}
              </text>
            </g>
          );
        })}

        {/* crosshair */}
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={height - PAD.bottom} stroke={theme.colors.textDim} strokeWidth="1" opacity="0.6" />
        )}

        {/* hover capture */}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={width - PAD.left - PAD.right}
          height={height - PAD.top - PAD.bottom}
          fill="transparent"
          onMouseMove={onMove}
        />

        {/* news flags (on top of the capture rect so each stays hoverable) */}
        {eventMarkers.map((ev, i) => {
          const cx = x(ev.idx);
          const col = evColor(ev.score);
          return (
            <g key={`ev-${i}`} style={{ cursor: 'help' }}>
              <title>{ev.title}</title>
              <line x1={cx} x2={cx} y1={PAD.top + 10} y2={y(historyCloses[ev.idx])} stroke={col} strokeWidth="1" opacity="0.25" style={{ pointerEvents: 'none' }} />
              <circle cx={cx} cy={PAD.top + 7} r="3.5" fill={col} stroke={theme.colors.panelElev} strokeWidth="1" />
            </g>
          );
        })}
      </svg>

      {/* tooltip */}
      {hover != null && tipRows.length > 0 && (
        <div
          style={{
            position: 'absolute',
            left: tipLeft,
            top: 8,
            background: theme.colors.panelElev,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radius.sm,
            padding: '6px 10px',
            pointerEvents: 'none',
            boxShadow: theme.shadow,
            zIndex: 5,
          }}
        >
          <div style={{ fontSize: 10, color: theme.colors.textFaint, marginBottom: 2 }}>{fmtDate(allDates[hover])}</div>
          {tipRows.map((r) => (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: r.color, display: 'inline-block' }} />
              <span style={{ color: theme.colors.textDim }}>{r.label}</span>
              <span style={{ marginLeft: 'auto', fontFamily: theme.mono, color: theme.colors.text, paddingLeft: 8 }}>
                {fmtMoney(r.value, currency)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* legend (always present: >= 2 series) */}
      <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', marginTop: theme.space(1), fontSize: 11.5 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: theme.colors.textDim }}>
          <span style={{ width: 14, height: 2, background: SERIES_COLORS.history, display: 'inline-block' }} /> {t('fchart.actual_price')}
        </span>
        {forecasts.filter((f) => f.kind !== 'scenario').map((f) => {
          const last = f.closes[f.closes.length - 1];
          const first = historyCloses[historyCloses.length - 1];
          const pct = first > 0 && Number.isFinite(last) ? ((last / first - 1) * 100).toFixed(1) : null;
          return (
            <span key={f.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: theme.colors.textDim }}>
              <span style={{ width: 14, height: 2, background: f.color, display: 'inline-block', backgroundImage: `linear-gradient(90deg, ${f.color} 60%, transparent 40%)`, backgroundSize: '7px 2px' }} />
              {f.label}
              <b style={{ fontFamily: theme.mono, color: theme.colors.text }}>{pct == null ? '—' : `${pct > 0 ? '+' : ''}${pct}%`}</b>
            </span>
          );
        })}
      </div>
    </div>
  );
}
