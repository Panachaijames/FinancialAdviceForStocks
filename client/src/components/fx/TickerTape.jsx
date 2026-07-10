// TickerTape — Wall-Street style marquee of the portfolio's live prices.
// Sits directly under the sticky app header. Pure-CSS marquee (transform only),
// pause on hover, edge fades via mask-image, gated by the app's FX toggle
// through :root[data-motion='reduce'] CSS rules (no JS animation to clean up).
//
// Each item now carries a tiny 1-day intraday sparkline (44x14 static SVG).
// Candles are fetched ONCE PER SYMBOL here in the parent — both marquee halves
// render from the same state map, so the two copies stay pixel-identical and
// the translateX(-50%) loop seam never jumps.
import React, { useEffect, useMemo, useState } from 'react';
import { usePortfolioStore } from '../../store/portfolioStore.js';
import { useSettingsStore } from '../../store/settingsStore.js';
import useQuotes from '../../hooks/useQuotes.js';
import useFx from '../../hooks/useFx.js';
import { getCandles } from '../../api/client.js';
import { fmtMoney, fmtSignedPct } from '../../lib/format.js';
import { theme } from '../../lib/theme.js';

const SPARK_W = 44;
const SPARK_H = 14;
const SPARK_PAD = 1;
const SPARK_MAX_POINTS = 40; // downsample 1d/5m (~78 candles) to keep the DOM light
const SPARK_REFRESH_MS = 5 * 60 * 1000; // refresh intraday closes every 5 minutes

/**
 * Normalize a series of closes into a 44x14 polyline. Returns null when there
 * is not enough data to draw (item then renders exactly as before — no gap in
 * the seam because BOTH halves derive from the same map).
 * @param {number[]} closes
 * @returns {{ points: string, color: string } | null}
 */
function buildSpark(closes) {
  if (!Array.isArray(closes) || closes.length < 2) return null;

  // Downsample evenly so long intraday series stay cheap to render twice.
  let pts = closes;
  if (pts.length > SPARK_MAX_POINTS) {
    const step = (pts.length - 1) / (SPARK_MAX_POINTS - 1);
    const sampled = new Array(SPARK_MAX_POINTS);
    for (let i = 0; i < SPARK_MAX_POINTS; i += 1) {
      sampled[i] = pts[Math.round(i * step)];
    }
    pts = sampled;
  }

  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min;
  const n = pts.length;
  const innerW = SPARK_W - SPARK_PAD * 2;
  const innerH = SPARK_H - SPARK_PAD * 2;

  const coords = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = SPARK_PAD + (i / (n - 1)) * innerW;
    const y = span > 0 ? SPARK_PAD + (1 - (pts[i] - min) / span) * innerH : SPARK_H / 2;
    coords[i] = `${x.toFixed(2)},${y.toFixed(2)}`;
  }

  const first = pts[0];
  const last = pts[n - 1];
  const color =
    span === 0 ? 'var(--text-faint)' : last >= first ? 'var(--up)' : 'var(--down)';

  return { points: coords.join(' '), color };
}

export default function TickerTape() {
  const holdings = usePortfolioStore((s) => s.holdings);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);

  // Unique symbols, preserving holding order (store already merges by symbol,
  // but dedupe defensively so the marquee never repeats an entry).
  const symbols = useMemo(
    () => Array.from(new Set(holdings.map((h) => h.symbol).filter(Boolean))),
    [holdings]
  );

  const { quotes } = useQuotes(symbols);
  const { convert } = useFx();

  // symbol -> number[] of 1-day intraday closes. Fetched once per symbol list
  // in this parent (never inside item renders), refreshed every 5 minutes.
  const [sparkCloses, setSparkCloses] = useState({});

  // Stable key so the effect only re-runs when the symbol SET actually changes.
  const symbolsKey = symbols.join(',');

  useEffect(() => {
    if (!symbolsKey) {
      setSparkCloses({});
      return undefined;
    }
    const syms = symbolsKey.split(',');
    let cancelled = false;

    const load = () => {
      // Per-symbol try/catch: one bad symbol never breaks the tape or the rest.
      Promise.all(
        syms.map(async (sym) => {
          try {
            // Server-validated combo: range '1d' + interval 'auto' resolves to
            // 5m intraday on Yahoo (and 1-day OHLC on CoinGecko for crypto).
            const candles = await getCandles(sym, '1d', 'auto');
            const closes = (Array.isArray(candles) ? candles : [])
              .map((c) => (c == null ? NaN : Number(c.close)))
              .filter((v) => Number.isFinite(v));
            return [sym, closes];
          } catch {
            return [sym, []]; // degrade gracefully: no sparkline for this symbol
          }
        })
      ).then((entries) => {
        if (cancelled) return; // ignore stale responses after unmount/symbol change
        const next = {};
        for (const [sym, closes] of entries) next[sym] = closes;
        setSparkCloses(next);
      });
    };

    load();
    const timer = setInterval(load, SPARK_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [symbolsKey]);

  // Precompute one polyline per symbol so both halves reuse identical geometry.
  const sparks = useMemo(() => {
    const map = {};
    for (const sym of Object.keys(sparkCloses)) {
      const sp = buildSpark(sparkCloses[sym]);
      if (sp) map[sym] = sp;
    }
    return map;
  }, [sparkCloses]);

  if (holdings.length === 0) return null;

  const currencyBySymbol = {};
  for (const h of holdings) {
    if (currencyBySymbol[h.symbol] === undefined) currencyBySymbol[h.symbol] = h.currency;
  }

  const items = symbols.map((sym) => {
    const q = quotes[sym];
    const rawPrice = q ? Number(q.price) : NaN;
    const rawPct = q ? Number(q.changePct) : NaN;
    return {
      symbol: sym,
      price: Number.isFinite(rawPrice)
        ? convert(rawPrice, currencyBySymbol[sym] || 'USD')
        : null,
      changePct: Number.isFinite(rawPct) ? rawPct : null,
      spark: sparks[sym] || null,
    };
  });

  // Longer tapes scroll for longer so perceived speed stays constant.
  const durationSec = Math.max(24, items.length * 6);

  const renderItems = (hidden) =>
    items.map((it) => {
      const pctColor =
        it.changePct === null
          ? 'var(--text-faint)'
          : it.changePct < 0
            ? 'var(--down)'
            : it.changePct > 0
              ? 'var(--up)'
              : 'var(--text-dim)';
      return (
        <span
          key={`${hidden ? 'b' : 'a'}-${it.symbol}`}
          className="ticker-item"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: theme.space(2),
            whiteSpace: 'nowrap',
            fontFamily: theme.mono,
            fontSize: 12,
            lineHeight: 1,
          }}
        >
          <span style={{ fontWeight: 700, color: 'var(--text)', letterSpacing: '0.02em' }}>
            {it.symbol}
          </span>
          {it.spark && (
            <svg
              className="ticker-spark"
              viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
              width={SPARK_W}
              height={SPARK_H}
              aria-hidden="true"
              focusable="false"
              style={{ display: 'block', flex: 'none', pointerEvents: 'none' }}
            >
              <polyline
                points={it.spark.points}
                fill="none"
                stroke={it.spark.color}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
          <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>
            ·
          </span>
          <span style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
            {fmtMoney(it.price, displayCurrency)}
          </span>
          <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>
            ·
          </span>
          <span style={{ color: pctColor, fontVariantNumeric: 'tabular-nums' }}>
            {fmtSignedPct(it.changePct)}
          </span>
        </span>
      );
    });

  return (
    <div className="ticker" role="marquee" aria-label="Live portfolio prices">
      <div className="ticker-track" style={{ '--ticker-dur': `${durationSec}s` }}>
        <div className="ticker-half">{renderItems(false)}</div>
        <div className="ticker-half" aria-hidden="true">
          {renderItems(true)}
        </div>
      </div>
    </div>
  );
}
