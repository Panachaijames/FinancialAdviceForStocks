import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType, CrosshairMode, LineStyle } from 'lightweight-charts';
import theme from '../lib/theme.js';
import useCandles from '../hooks/useCandles.js';
import {
  sma,
  ema,
  wma,
  bollingerBands,
  vwap,
  rsi,
  macd,
  stochastic,
  toLineData,
} from '../lib/indicators.js';
import { fmtNumber } from '../lib/format.js';

const OVERLAY_COLORS = {
  sma: '#3b82f6',
  ema: '#f59e0b',
  wma: '#a855f7',
  bbUpper: '#64748b',
  bbMiddle: '#94a3b8',
  bbLower: '#64748b',
  vwap: '#22d3ee',
};

const MAIN_HEIGHT = 360;
const SUB_HEIGHT = 130;

/** Shared base chart options derived from the theme. */
function baseChartOptions(width, height) {
  return {
    width,
    height,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: theme.colors.textDim,
      fontSize: 11,
      fontFamily: theme.font,
    },
    grid: {
      vertLines: { color: theme.colors.border },
      horzLines: { color: theme.colors.border },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: theme.colors.textFaint, width: 1, style: LineStyle.Dashed, labelBackgroundColor: theme.colors.panelElev },
      horzLine: { color: theme.colors.textFaint, width: 1, style: LineStyle.Dashed, labelBackgroundColor: theme.colors.panelElev },
    },
    rightPriceScale: {
      borderColor: theme.colors.border,
      scaleMargins: { top: 0.1, bottom: 0.1 },
    },
    timeScale: {
      borderColor: theme.colors.border,
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: true,
    handleScale: true,
  };
}

/** Compute volume histogram data colored by candle direction. */
function volumeData(candles) {
  return candles
    .filter((c) => c && Number.isFinite(c.volume))
    .map((c) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)',
    }));
}

/**
 * FullChart
 * Props:
 *   symbol, range, interval, chartType ('candles'|'line'|'area'), logScale (bool),
 *   indicators (config object from IndicatorControls), name (optional display name)
 */
export default function FullChart({
  symbol,
  range = '6mo',
  interval = 'auto',
  chartType = 'candles',
  logScale = false,
  indicators,
}) {
  const { candles, loading, error, reload } = useCandles(symbol, range, interval);

  // DOM container refs
  const mainRef = useRef(null);
  const rsiRef = useRef(null);
  const macdRef = useRef(null);
  const stochRef = useRef(null);

  // Chart + series instances kept across renders
  const charts = useRef({ main: null, rsi: null, macd: null, stoch: null });
  const mainSeries = useRef(null); // price series (candles/line/area)
  const volumeSeries = useRef(null);
  const overlaySeries = useRef({}); // keyed by overlay id -> ISeriesApi
  const subSeries = useRef({}); // sub-chart series by id
  const roList = useRef([]); // ResizeObservers to disconnect
  const syncing = useRef(false); // guard against feedback loops

  const [legend, setLegend] = useState(null);

  const cfg = indicators || {};

  // Which oscillator sub-charts are visible — drives the layout (re-create on change).
  const showRsi = !!cfg.rsi?.on;
  const showMacd = !!cfg.macd?.on;
  const showStoch = !!cfg.stochastic?.on;

  // Closing prices for indicator math
  const closes = useMemo(() => candles.map((c) => c.close), [candles]);
  const highs = useMemo(() => candles.map((c) => c.high), [candles]);
  const lows = useMemo(() => candles.map((c) => c.low), [candles]);
  const volumes = useMemo(() => candles.map((c) => c.volume), [candles]);

  // -------------------------------------------------------------------------
  // Create / destroy the chart instances. Recreate whenever the set of visible
  // sub-charts or chartType changes (those alter the structure). Data updates
  // are handled in a separate effect via setData.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mainRef.current) return undefined;

    const mainEl = mainRef.current;
    const main = createChart(mainEl, baseChartOptions(mainEl.clientWidth || 600, MAIN_HEIGHT));
    charts.current.main = main;

    // Price series by chart type
    if (chartType === 'line') {
      mainSeries.current = main.addLineSeries({
        color: theme.colors.accent,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
    } else if (chartType === 'area') {
      mainSeries.current = main.addAreaSeries({
        lineColor: theme.colors.accent,
        topColor: 'rgba(59,130,246,0.35)',
        bottomColor: 'rgba(59,130,246,0.02)',
        lineWidth: 2,
        priceLineVisible: false,
      });
    } else {
      mainSeries.current = main.addCandlestickSeries({
        upColor: theme.colors.up,
        downColor: theme.colors.down,
        borderUpColor: theme.colors.up,
        borderDownColor: theme.colors.down,
        wickUpColor: theme.colors.up,
        wickDownColor: theme.colors.down,
      });
    }

    // Volume on its own overlaid scale pinned to the bottom
    volumeSeries.current = main.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    main.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    // Overlay line series (created up-front; data set/cleared in the data effect)
    overlaySeries.current = {};
    const mkLine = (id, color, opts = {}) => {
      overlaySeries.current[id] = main.addLineSeries({
        color,
        lineWidth: 1.5,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        ...opts,
      });
    };
    mkLine('sma', OVERLAY_COLORS.sma);
    mkLine('ema', OVERLAY_COLORS.ema);
    mkLine('wma', OVERLAY_COLORS.wma);
    mkLine('bbUpper', OVERLAY_COLORS.bbUpper, { lineStyle: LineStyle.Dotted });
    mkLine('bbMiddle', OVERLAY_COLORS.bbMiddle, { lineStyle: LineStyle.Dashed });
    mkLine('bbLower', OVERLAY_COLORS.bbLower, { lineStyle: LineStyle.Dotted });
    mkLine('vwap', OVERLAY_COLORS.vwap);

    // ----- Oscillator sub-charts -----
    const subCharts = [];
    subSeries.current = {};

    if (showRsi && rsiRef.current) {
      const el = rsiRef.current;
      const c = createChart(el, baseChartOptions(el.clientWidth || 600, SUB_HEIGHT));
      c.priceScale('right').applyOptions({ scaleMargins: { top: 0.15, bottom: 0.15 } });
      charts.current.rsi = c;
      subSeries.current.rsi = c.addLineSeries({
        color: '#e879f9',
        lineWidth: 1.5,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      // 70 / 30 reference bands via price lines
      subSeries.current.rsi.createPriceLine({
        price: 70,
        color: theme.colors.down,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '70',
      });
      subSeries.current.rsi.createPriceLine({
        price: 30,
        color: theme.colors.up,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '30',
      });
      subCharts.push(c);
    }

    if (showMacd && macdRef.current) {
      const el = macdRef.current;
      const c = createChart(el, baseChartOptions(el.clientWidth || 600, SUB_HEIGHT));
      charts.current.macd = c;
      subSeries.current.macdHist = c.addHistogramSeries({
        priceLineVisible: false,
        lastValueVisible: false,
      });
      subSeries.current.macdLine = c.addLineSeries({
        color: theme.colors.accent,
        lineWidth: 1.5,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      subSeries.current.macdSignal = c.addLineSeries({
        color: theme.colors.gold,
        lineWidth: 1.5,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      subCharts.push(c);
    }

    if (showStoch && stochRef.current) {
      const el = stochRef.current;
      const c = createChart(el, baseChartOptions(el.clientWidth || 600, SUB_HEIGHT));
      c.priceScale('right').applyOptions({ scaleMargins: { top: 0.15, bottom: 0.15 } });
      charts.current.stoch = c;
      subSeries.current.stochK = c.addLineSeries({
        color: theme.colors.accent,
        lineWidth: 1.5,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      subSeries.current.stochD = c.addLineSeries({
        color: theme.colors.gold,
        lineWidth: 1.5,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      subSeries.current.stochK.createPriceLine({
        price: 80,
        color: theme.colors.down,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '80',
      });
      subSeries.current.stochK.createPriceLine({
        price: 20,
        color: theme.colors.up,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '20',
      });
      subCharts.push(c);
    }

    // ----- Synchronize time scales (main <-> each sub) -----
    const allCharts = [main, ...subCharts];
    const applyRangeToOthers = (sourceChart, range2) => {
      if (syncing.current || !range2) return;
      syncing.current = true;
      try {
        for (const c of allCharts) {
          if (c !== sourceChart) {
            c.timeScale().setVisibleLogicalRange(range2);
          }
        }
      } catch (e) {
        // ignore transient errors while charts settle
      } finally {
        syncing.current = false;
      }
    };

    const unsubs = [];
    for (const c of allCharts) {
      const handler = (range2) => applyRangeToOthers(c, range2);
      c.timeScale().subscribeVisibleLogicalRangeChange(handler);
      unsubs.push(() => {
        try {
          c.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
        } catch (e) {
          /* noop */
        }
      });
    }

    // ----- Crosshair legend on the main chart -----
    const crosshairHandler = (param) => {
      if (!param || !param.time || !param.point) {
        setLegend(null);
        return;
      }
      const priceData = mainSeries.current ? param.seriesData.get(mainSeries.current) : null;
      const overlays = {};
      for (const [id, s] of Object.entries(overlaySeries.current)) {
        const d = param.seriesData.get(s);
        if (d && typeof d.value === 'number') overlays[id] = d.value;
      }
      setLegend({ time: param.time, price: priceData, overlays });
    };
    main.subscribeCrosshairMove(crosshairHandler);

    // ----- ResizeObservers -----
    roList.current = [];
    const observe = (el, chart) => {
      if (!el || !chart) return;
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = Math.floor(entry.contentRect.width);
          if (w > 0) chart.applyOptions({ width: w });
        }
      });
      ro.observe(el);
      roList.current.push(ro);
    };
    observe(mainEl, main);
    if (charts.current.rsi) observe(rsiRef.current, charts.current.rsi);
    if (charts.current.macd) observe(macdRef.current, charts.current.macd);
    if (charts.current.stoch) observe(stochRef.current, charts.current.stoch);

    main.timeScale().fitContent();

    return () => {
      for (const u of unsubs) u();
      try {
        main.unsubscribeCrosshairMove(crosshairHandler);
      } catch (e) {
        /* noop */
      }
      for (const ro of roList.current) ro.disconnect();
      roList.current = [];
      for (const key of Object.keys(charts.current)) {
        const c = charts.current[key];
        if (c) {
          try {
            c.remove();
          } catch (e) {
            /* noop */
          }
          charts.current[key] = null;
        }
      }
      mainSeries.current = null;
      volumeSeries.current = null;
      overlaySeries.current = {};
      subSeries.current = {};
      setLegend(null);
    };
    // Recreate when the structural inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, range, interval, chartType, showRsi, showMacd, showStoch]);

  // -------------------------------------------------------------------------
  // Apply log scale toggle without recreating the chart.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const main = charts.current.main;
    if (!main) return;
    main.priceScale('right').applyOptions({ mode: logScale ? 2 : 0 }); // 2 = Logarithmic, 0 = Normal
  }, [logScale]);

  // -------------------------------------------------------------------------
  // Push data into the price + volume series whenever candles change.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const main = charts.current.main;
    const series = mainSeries.current;
    if (!main || !series || !candles.length) {
      if (series) series.setData([]);
      if (volumeSeries.current) volumeSeries.current.setData([]);
      return;
    }

    if (chartType === 'candles') {
      series.setData(
        candles.map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      );
    } else {
      series.setData(candles.map((c) => ({ time: c.time, value: c.close })));
    }

    if (volumeSeries.current) {
      volumeSeries.current.setData(volumeData(candles));
    }

    main.timeScale().fitContent();
    // showRsi/showMacd/showStoch are deps because the construction effect
    // recreates the main + volume series when an oscillator is toggled. Without
    // them, this effect wouldn't re-run after that rebuild and the freshly
    // created (empty) main series would leave the price chart blank — the exact
    // "toggle RSI/MACD/Stoch → whole graph goes blank" bug. (chartType is here
    // for the same reason.)
  }, [candles, chartType, showRsi, showMacd, showStoch]);

  // -------------------------------------------------------------------------
  // Overlays: compute and set data (or clear) per config.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const setOverlay = (id, arr) => {
      const s = overlaySeries.current[id];
      if (!s) return;
      s.setData(arr ? toLineData(candles, arr) : []);
    };

    if (!candles.length) {
      ['sma', 'ema', 'wma', 'bbUpper', 'bbMiddle', 'bbLower', 'vwap'].forEach((id) => setOverlay(id, null));
      return;
    }

    setOverlay('sma', cfg.sma?.on ? sma(closes, cfg.sma.period || 20) : null);
    setOverlay('ema', cfg.ema?.on ? ema(closes, cfg.ema.period || 50) : null);
    setOverlay('wma', cfg.wma?.on ? wma(closes, cfg.wma.period || 20) : null);

    if (cfg.bollinger?.on) {
      const bb = bollingerBands(closes, cfg.bollinger.period || 20, cfg.bollinger.mult || 2);
      setOverlay('bbUpper', bb.upper);
      setOverlay('bbMiddle', bb.middle);
      setOverlay('bbLower', bb.lower);
    } else {
      setOverlay('bbUpper', null);
      setOverlay('bbMiddle', null);
      setOverlay('bbLower', null);
    }

    setOverlay('vwap', cfg.vwap?.on ? vwap(candles) : null);
    // chartType + showRsi/showMacd/showStoch: the construction effect recreates
    // the overlay series on any of these, so this effect must re-run to refill
    // them (otherwise overlays blank out on an oscillator or chart-type toggle).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, closes, chartType, showRsi, showMacd, showStoch, cfg.sma?.on, cfg.sma?.period, cfg.ema?.on, cfg.ema?.period, cfg.wma?.on, cfg.wma?.period, cfg.bollinger?.on, cfg.bollinger?.period, cfg.bollinger?.mult, cfg.vwap?.on]);

  // -------------------------------------------------------------------------
  // Volume visibility toggle (series exists; just clear/restore).
  // -------------------------------------------------------------------------
  useEffect(() => {
    const s = volumeSeries.current;
    if (!s) return;
    s.applyOptions({ visible: cfg.volume?.on !== false });
  }, [cfg.volume?.on]);

  // -------------------------------------------------------------------------
  // Oscillator sub-chart data (RSI, MACD, Stochastic).
  //
  // Each effect below depends on chartType + ALL of showRsi/showMacd/showStoch,
  // not just its own toggle. The construction effect recreates EVERY sub-series
  // whenever any of those change, so each data effect must re-run to refill its
  // freshly-created (empty) series. Without the sibling deps, turning on a
  // second oscillator would blank the first (its series got recreated but its
  // data effect didn't re-run). Same reasoning as the main-price/overlay effects.
  // -------------------------------------------------------------------------
  // RSI
  useEffect(() => {
    if (!showRsi || !subSeries.current.rsi) return;
    if (!candles.length) {
      subSeries.current.rsi.setData([]);
      return;
    }
    const r = rsi(closes, cfg.rsi?.period || 14);
    subSeries.current.rsi.setData(toLineData(candles, r));
  }, [candles, closes, chartType, showRsi, showMacd, showStoch, cfg.rsi?.period]);

  // -------------------------------------------------------------------------
  // MACD sub-chart data
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!showMacd || !subSeries.current.macdLine) return;
    if (!candles.length) {
      subSeries.current.macdLine.setData([]);
      subSeries.current.macdSignal.setData([]);
      subSeries.current.macdHist.setData([]);
      return;
    }
    const m = macd(closes, cfg.macd?.fast || 12, cfg.macd?.slow || 26, cfg.macd?.signal || 9);
    subSeries.current.macdLine.setData(toLineData(candles, m.macd));
    subSeries.current.macdSignal.setData(toLineData(candles, m.signal));
    const hist = toLineData(candles, m.hist).map((p) => ({
      time: p.time,
      value: p.value,
      color: p.value >= 0 ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)',
    }));
    subSeries.current.macdHist.setData(hist);
  }, [candles, closes, chartType, showRsi, showMacd, showStoch, cfg.macd?.fast, cfg.macd?.slow, cfg.macd?.signal]);

  // -------------------------------------------------------------------------
  // Stochastic sub-chart data
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!showStoch || !subSeries.current.stochK) return;
    if (!candles.length) {
      subSeries.current.stochK.setData([]);
      subSeries.current.stochD.setData([]);
      return;
    }
    const st = stochastic(highs, lows, closes, cfg.stochastic?.kPeriod || 14, cfg.stochastic?.dPeriod || 3);
    subSeries.current.stochK.setData(toLineData(candles, st.k));
    subSeries.current.stochD.setData(toLineData(candles, st.d));
  }, [candles, highs, lows, closes, chartType, showRsi, showMacd, showStoch, cfg.stochastic?.kPeriod, cfg.stochastic?.dPeriod]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const subLabelStyle = {
    position: 'absolute',
    top: 6,
    left: 10,
    fontSize: 11,
    fontWeight: 700,
    color: theme.colors.textFaint,
    letterSpacing: 0.5,
    zIndex: 3,
    pointerEvents: 'none',
  };

  return (
    <div style={{ position: 'relative', width: '100%', flex: 1, minWidth: 0 }}>
      {/* Crosshair legend overlay */}
      <ChartLegend legend={legend} cfg={cfg} chartType={chartType} />

      {/* Main price chart */}
      <div style={{ position: 'relative', width: '100%' }}>
        <div ref={mainRef} style={{ width: '100%', height: MAIN_HEIGHT }} />

        {/* Loading / error / empty overlays */}
        {loading ? (
          <div style={overlayStyle}>
            <div className="skeleton" style={{ width: '90%', height: MAIN_HEIGHT - 40, borderRadius: theme.radius.md }} />
          </div>
        ) : null}
        {!loading && error ? (
          <div style={overlayStyle}>
            <div style={{ textAlign: 'center', color: theme.colors.down }}>
              <div style={{ marginBottom: theme.space(2), fontSize: 13 }}>Failed to load chart data</div>
              <button className="btn btn-ghost" onClick={reload}>
                Retry
              </button>
            </div>
          </div>
        ) : null}
        {!loading && !error && candles.length === 0 ? (
          <div style={overlayStyle}>
            <div style={{ color: theme.colors.textFaint, fontSize: 13 }}>No price data available</div>
          </div>
        ) : null}
      </div>

      {/* RSI sub-chart */}
      {showRsi ? (
        <div style={{ position: 'relative', width: '100%', borderTop: `1px solid ${theme.colors.border}`, marginTop: theme.space(1) }}>
          <span style={subLabelStyle}>RSI {cfg.rsi?.period || 14}</span>
          <div ref={rsiRef} style={{ width: '100%', height: SUB_HEIGHT }} />
        </div>
      ) : null}

      {/* MACD sub-chart */}
      {showMacd ? (
        <div style={{ position: 'relative', width: '100%', borderTop: `1px solid ${theme.colors.border}`, marginTop: theme.space(1) }}>
          <span style={subLabelStyle}>
            MACD {cfg.macd?.fast || 12},{cfg.macd?.slow || 26},{cfg.macd?.signal || 9}
          </span>
          <div ref={macdRef} style={{ width: '100%', height: SUB_HEIGHT }} />
        </div>
      ) : null}

      {/* Stochastic sub-chart */}
      {showStoch ? (
        <div style={{ position: 'relative', width: '100%', borderTop: `1px solid ${theme.colors.border}`, marginTop: theme.space(1) }}>
          <span style={subLabelStyle}>
            Stoch {cfg.stochastic?.kPeriod || 14},{cfg.stochastic?.dPeriod || 3}
          </span>
          <div ref={stochRef} style={{ width: '100%', height: SUB_HEIGHT }} />
        </div>
      ) : null}
    </div>
  );
}

const overlayStyle = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(11,14,20,0.35)',
  zIndex: 4,
};

/** Crosshair legend overlay shown at the top-left of the main chart. */
function ChartLegend({ legend, cfg, chartType }) {
  if (!legend) return null;

  const dateLabel = formatTime(legend.time);
  const p = legend.price;

  const item = (label, value, color) => (
    <span key={label} style={{ color: color || theme.colors.textDim, marginRight: theme.space(3), whiteSpace: 'nowrap' }}>
      <span style={{ color: theme.colors.textFaint }}>{label} </span>
      <span style={{ fontWeight: 600 }}>{Number.isFinite(value) ? fmtNumber(value, 2) : '—'}</span>
    </span>
  );

  const overlayItems = [];
  const ov = legend.overlays || {};
  if (cfg.sma?.on && Number.isFinite(ov.sma)) overlayItems.push(item(`SMA${cfg.sma.period || 20}`, ov.sma, OVERLAY_COLORS.sma));
  if (cfg.ema?.on && Number.isFinite(ov.ema)) overlayItems.push(item(`EMA${cfg.ema.period || 50}`, ov.ema, OVERLAY_COLORS.ema));
  if (cfg.wma?.on && Number.isFinite(ov.wma)) overlayItems.push(item(`WMA${cfg.wma.period || 20}`, ov.wma, OVERLAY_COLORS.wma));
  if (cfg.bollinger?.on) {
    if (Number.isFinite(ov.bbUpper)) overlayItems.push(item('BB↑', ov.bbUpper, OVERLAY_COLORS.bbUpper));
    if (Number.isFinite(ov.bbMiddle)) overlayItems.push(item('BB·', ov.bbMiddle, OVERLAY_COLORS.bbMiddle));
    if (Number.isFinite(ov.bbLower)) overlayItems.push(item('BB↓', ov.bbLower, OVERLAY_COLORS.bbLower));
  }
  if (cfg.vwap?.on && Number.isFinite(ov.vwap)) overlayItems.push(item('VWAP', ov.vwap, OVERLAY_COLORS.vwap));

  return (
    <div
      style={{
        position: 'absolute',
        top: theme.space(2),
        left: theme.space(2),
        zIndex: 5,
        background: 'rgba(20,25,37,0.85)',
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radius.sm,
        padding: `${theme.space(1)}px ${theme.space(2)}px`,
        fontSize: 11,
        fontFamily: theme.mono,
        pointerEvents: 'none',
        maxWidth: 'calc(100% - 16px)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: `2px 0`,
      }}
    >
      <span style={{ color: theme.colors.text, marginRight: theme.space(3), fontWeight: 700 }}>{dateLabel}</span>
      {chartType === 'candles' && p && typeof p.open === 'number' ? (
        <>
          {item('O', p.open)}
          {item('H', p.high)}
          {item('L', p.low)}
          {item('C', p.close, p.close >= p.open ? theme.colors.up : theme.colors.down)}
        </>
      ) : p && typeof p.value === 'number' ? (
        item('Price', p.value, theme.colors.text)
      ) : null}
      {overlayItems}
    </div>
  );
}

/** Format a lightweight-charts time value (UNIX seconds or {year,month,day}). */
function formatTime(time) {
  let d;
  if (typeof time === 'number') {
    d = new Date(time * 1000);
  } else if (time && typeof time === 'object' && 'year' in time) {
    d = new Date(time.year, (time.month || 1) - 1, time.day || 1);
  } else {
    return String(time);
  }
  if (Number.isNaN(d.getTime())) return String(time);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
