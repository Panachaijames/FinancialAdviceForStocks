import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, LineStyle } from 'lightweight-charts';
import { theme } from '../lib/theme.js';
import useCandles from '../hooks/useCandles.js';
import useQuotes from '../hooks/useQuotes.js';

/**
 * Minimal area sparkline for an asset, colored by overall up/down.
 * Props: { symbol, range='5d', live=true, height=64 }
 */
export default function MiniChart({ symbol, range = '5d', live = true, height = 64 }) {
  const { candles, loading } = useCandles(symbol, range, 'auto');
  const liveSymbols = live ? [symbol] : [];
  const { quotes } = useQuotes(liveSymbols);

  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const roRef = useRef(null);
  const lastTimeRef = useRef(null);

  // Determine up/down for coloring.
  const first = candles && candles.length ? candles[0].close : null;
  const last = candles && candles.length ? candles[candles.length - 1].close : null;
  const isUp = first != null && last != null ? last >= first : true;
  const lineColor = isUp ? theme.colors.up : theme.colors.down;

  // Create chart once.
  useEffect(() => {
    if (!containerRef.current) return undefined;

    const el = containerRef.current;
    const chart = createChart(el, {
      width: el.clientWidth || 200,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: theme.colors.textFaint,
        fontFamily: theme.font,
      },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false, borderVisible: false },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      crosshair: {
        mode: 0,
        vertLine: { visible: false, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      handleScroll: false,
      handleScale: false,
      localization: { priceFormatter: (p) => String(p) },
    });

    const series = chart.addAreaSeries({
      lineColor,
      topColor: lineColor + '55',
      bottomColor: lineColor + '00',
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // ResizeObserver to keep width in sync.
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 0 && chartRef.current) {
          chartRef.current.applyOptions({ width: w, height });
        }
      }
    });
    ro.observe(el);
    roRef.current = ro;

    return () => {
      if (roRef.current) {
        roRef.current.disconnect();
        roRef.current = null;
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      seriesRef.current = null;
      lastTimeRef.current = null;
    };
    // height is stable per-instance; recreate only on unmount/mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  // Update color when up/down flips.
  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.applyOptions({
      lineColor,
      topColor: lineColor + '55',
      bottomColor: lineColor + '00',
    });
  }, [lineColor]);

  // Push candle data.
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    if (!candles || candles.length === 0) return;

    // Deduplicate / ensure ascending integer time, drop invalid closes.
    const seen = new Set();
    const data = [];
    for (const c of candles) {
      if (c == null) continue;
      const t = Math.floor(Number(c.time));
      const v = Number(c.close);
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
      if (seen.has(t)) {
        // overwrite previous with same time
        data[data.length - 1] = { time: t, value: v };
        continue;
      }
      seen.add(t);
      data.push({ time: t, value: v });
    }
    data.sort((a, b) => a.time - b.time);
    if (data.length === 0) return;

    seriesRef.current.setData(data);
    lastTimeRef.current = data[data.length - 1].time;
    chartRef.current.timeScale().fitContent();
  }, [candles]);

  // Live update of last point from quote.
  useEffect(() => {
    if (!live) return;
    if (!seriesRef.current || lastTimeRef.current == null) return;
    const q = quotes[symbol];
    if (!q || !Number.isFinite(Number(q.price))) return;
    seriesRef.current.update({ time: lastTimeRef.current, value: Number(q.price) });
  }, [quotes, symbol, live]);

  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      {loading && (!candles || candles.length === 0) && (
        <div
          className="skeleton"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: theme.radius.sm,
          }}
        />
      )}
      {!loading && (!candles || candles.length === 0) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            color: theme.colors.textFaint,
          }}
        >
          No chart data
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height }} />
    </div>
  );
}
