import React, { useEffect, useMemo, useState } from 'react';
import { PieChart } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { fmtMoney } from '../lib/format.js';
import { assetMeta } from '../lib/assetType.js';
import { useSettingsStore } from '../store/settingsStore.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import useQuotes from '../hooks/useQuotes.js';
import useFx from '../hooks/useFx.js';
import useFunds from '../hooks/useFunds.js';
import { motionEnabled } from '../lib/motion.js';

/**
 * AllocationDonut — the portfolio's asset-type mix as an animated SVG donut.
 *
 * Values: per-holding market value from live quotes (avgCost fallback while a
 * quote loads), converted to the display currency, bucketed by holding.type —
 * PLUS tracked Thai funds (valueThb, costThb fallback) as type 'thai_fund',
 * mirroring the useNetWorth byType pattern.
 *
 * Sweep-in: each slice is a stroked <circle> whose stroke-dasharray transitions
 * from "0 C" to its arc length; per-slice transition-delay/duration are derived
 * from the slice's cumulative start/size, so the ring paints clockwise segment
 * by segment over ~900ms. After the initial sweep, live value changes re-slice
 * with a short un-staggered tween instead.
 *
 * Reduced motion (both gates):
 *   JS — `drawn`/`swept` initialize to true when motionEnabled() is false, so
 *   slices mount fully painted (no sweep, no from-state flash).
 *   CSS — :root[data-motion='reduce'] .alloc-donut-seg { transition: none !important }
 *   kills the dash/stroke-width/opacity tweens if FX is toggled off after
 *   mount (highlights then snap instantly).
 */

const SIZE = 190; // svg box
const STROKE = 26; // resting ring thickness
const STROKE_HOVER = 32; // highlighted ring thickness
const R = SIZE / 2 - STROKE_HOVER / 2; // radius leaves room for the hover growth
const CIRC = 2 * Math.PI * R;
const GAP_DEG = 2; // dark gap between slices
const SWEEP_MS = 900; // total clockwise paint time

// assetMeta has no 'thai_fund' entry (it would fall back to "Other"), so the
// donut supplies its own meta for that bucket. Pink is unused by other types.
function metaFor(type) {
  if (type === 'thai_fund') return { label: 'Thai Fund', color: '#ec4899' };
  const m = assetMeta(type);
  return { label: m.label, color: m.color || theme.colors.accent };
}

export default function AllocationDonut() {
  const holdings = usePortfolioStore((s) => s.holdings);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const { quotes } = useQuotes(symbols);
  const { convert } = useFx();
  const { funds } = useFunds();

  const [hovered, setHovered] = useState(null); // asset type or null
  // Sweep state. When motion is off, both start true => slices render complete
  // on the very first paint (no 0-length from-state, no flash).
  const [drawn, setDrawn] = useState(() => !motionEnabled());
  const [swept, setSwept] = useState(() => !motionEnabled());

  // Kick the sweep one frame after mount so the browser commits the
  // zero-length dash state first and the transition actually runs.
  useEffect(() => {
    if (drawn) return undefined;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setDrawn(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [drawn]);

  // Once the sweep finishes, drop the stagger so live quote updates re-slice
  // with a quick uniform tween instead of a delayed one.
  useEffect(() => {
    if (!drawn || swept) return undefined;
    const t = setTimeout(() => setSwept(true), SWEEP_MS + 150);
    return () => clearTimeout(t);
  }, [drawn, swept]);

  const { segments, total } = useMemo(() => {
    const byType = {};
    for (const h of holdings) {
      const q = quotes[h.symbol];
      const native = h.currency || (h.type === 'th_stock' ? 'THB' : 'USD');
      const price =
        q && Number(q.price) > 0 ? Number(q.price) : Number(h.avgCost) || 0;
      const mv = convert((Number(h.shares) || 0) * price, native);
      if (Number.isFinite(mv) && mv > 0) byType[h.type] = (byType[h.type] || 0) + mv;
    }
    // Thai funds (NAV in THB; cost basis while a NAV is still loading).
    for (const f of funds) {
      const thb = f.valueThb != null ? f.valueThb : f.costThb;
      const v = convert(thb, 'THB');
      if (Number.isFinite(v) && v > 0) byType.thai_fund = (byType.thai_fund || 0) + v;
    }

    const entries = Object.entries(byType).sort((a, b) => b[1] - a[1]);
    const sum = entries.reduce((acc, [, v]) => acc + v, 0);
    if (sum <= 0) return { segments: [], total: 0 };

    // A 2deg dark gap between slices (none when a single slice fills the ring).
    const gapFrac = entries.length > 1 ? GAP_DEG / 360 : 0;
    let cursor = 0; // cumulative fraction, gap included
    const segs = entries.map(([type, value]) => {
      const frac = value / sum;
      const arcFrac = Math.max(frac - gapFrac, 0.002);
      const meta = metaFor(type);
      const seg = {
        type,
        value,
        pct: frac * 100,
        label: meta.label,
        color: meta.color,
        len: arcFrac * CIRC,
        // Center the gap between neighbouring slices.
        offset: -(cursor + gapFrac / 2) * CIRC,
        delay: cursor * SWEEP_MS,
        dur: Math.max(frac * SWEEP_MS, 80),
      };
      cursor += frac;
      return seg;
    });
    return { segments: segs, total: sum };
  }, [holdings, quotes, funds, convert]);

  if (segments.length === 0 || total <= 0) return null;

  const totalStr = fmtMoney(total, displayCurrency);
  const totalFontSize = totalStr.length > 12 ? 13 : totalStr.length > 9 ? 15 : 17;
  const donutLabel = `Portfolio allocation: ${segments
    .map((s) => `${s.label} ${s.pct.toFixed(1)}%`)
    .join(', ')}`;

  return (
    <div
      className="panel"
      style={{
        padding: theme.space(3),
        display: 'flex',
        flexDirection: 'column',
        gap: theme.space(2),
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.space(1),
          fontWeight: 700,
          fontSize: 13,
          color: theme.colors.text,
        }}
      >
        <PieChart size={15} style={{ color: theme.colors.accent }} />
        Allocation
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: theme.space(4),
        }}
      >
        {/* Donut */}
        <div style={{ position: 'relative', width: SIZE, height: SIZE, flex: '0 0 auto' }}>
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            role="img"
            aria-label={donutLabel}
            style={{ display: 'block' }}
          >
            {/* Faint track behind the slices */}
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={theme.colors.border}
              strokeWidth={STROKE}
              opacity={0.35}
            />
            {/* Slices start at 12 o'clock and paint clockwise */}
            <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
              {segments.map((s) => {
                const isHover = hovered === s.type;
                const dimmed = hovered != null && !isHover;
                return (
                  <circle
                    key={s.type}
                    className="alloc-donut-seg"
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={R}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={isHover ? STROKE_HOVER : STROKE}
                    strokeLinecap="butt"
                    strokeDasharray={drawn ? `${s.len} ${CIRC - s.len}` : `0 ${CIRC}`}
                    strokeDashoffset={s.offset}
                    opacity={dimmed ? 0.45 : 1}
                    style={{
                      transition: swept
                        ? 'stroke-dasharray 300ms ease, stroke-width 180ms ease, opacity 180ms ease'
                        : `stroke-dasharray ${s.dur}ms linear ${s.delay}ms, stroke-width 180ms ease, opacity 180ms ease`,
                      pointerEvents: 'stroke',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={() => setHovered(s.type)}
                    onMouseLeave={() => setHovered(null)}
                  />
                );
              })}
            </g>
          </svg>
          {/* Center total (decorative overlay; value repeated in the legend) */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              pointerEvents: 'none',
              textAlign: 'center',
            }}
          >
            <div style={{ maxWidth: SIZE - STROKE_HOVER * 2 - 16 }}>
              <div
                style={{
                  fontFamily: theme.mono,
                  fontWeight: 800,
                  fontSize: totalFontSize,
                  color: theme.colors.text,
                  lineHeight: 1.15,
                  overflowWrap: 'anywhere',
                }}
              >
                {totalStr}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: theme.colors.textDim,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                  marginTop: 2,
                }}
              >
                total
              </div>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div
          style={{
            flex: '1 1 220px',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {segments.map((s) => {
            const isHover = hovered === s.type;
            return (
              <button
                key={s.type}
                type="button"
                className="alloc-legend-row"
                aria-label={`${s.label}: ${s.pct.toFixed(1)} percent of portfolio, ${fmtMoney(
                  s.value,
                  displayCurrency
                )}`}
                onMouseEnter={() => setHovered(s.type)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(s.type)}
                onBlur={() => setHovered(null)}
                style={{
                  gap: theme.space(2),
                  padding: `${theme.space(1)}px ${theme.space(2)}px`,
                  background: isHover ? theme.colors.panelElev : 'transparent',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: s.color,
                    flex: '0 0 auto',
                  }}
                />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: theme.colors.text,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.label}
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 12,
                    color: theme.colors.textDim,
                    fontFamily: theme.mono,
                    flex: '0 0 auto',
                  }}
                >
                  {s.pct.toFixed(1)}%
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: theme.colors.text,
                    fontFamily: theme.mono,
                    flex: '0 0 auto',
                  }}
                >
                  {fmtMoney(s.value, displayCurrency)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
