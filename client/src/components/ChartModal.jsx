import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import theme from '../lib/theme.js';
import { classify, assetMeta } from '../lib/assetType.js';
import useQuotes from '../hooks/useQuotes.js';
import useFx from '../hooks/useFx.js';
import { useSettingsStore } from '../store/settingsStore.js';
import { fmtMoney, fmtSignedPct, classForChange } from '../lib/format.js';
import FullChart from './FullChart.jsx';
import ChartWipe from './fx/ChartWipe.jsx';
import IndicatorControls, { DEFAULT_INDICATOR_CONFIG } from './IndicatorControls.jsx';
import TradeScout from './TradeScout.jsx';

const RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', 'max'];
const CHART_TYPES = [
  { id: 'candles', label: 'Candles' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
];

/**
 * ChartModal — full-screen modal hosting the rich chart for one symbol.
 * Props:
 *   symbol  : Yahoo symbol (required)
 *   name    : optional display name
 *   type    : optional AssetType (derived from symbol when absent)
 *   onClose : () => void
 */
export default function ChartModal({ symbol, name, type, onClose }) {
  const [range, setRange] = useState('6mo');
  const [chartType, setChartType] = useState('candles');
  const [logScale, setLogScale] = useState(false);
  const [indicators, setIndicators] = useState(() => JSON.parse(JSON.stringify(DEFAULT_INDICATOR_CONFIG)));

  const symbols = useMemo(() => (symbol ? [symbol] : []), [symbol]);
  const { quotes } = useQuotes(symbols);
  const { convert } = useFx();
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);

  const quote = symbol ? quotes[symbol] : null;
  const assetType = type || (symbol ? classify(symbol) : 'other');
  const meta = assetMeta(assetType);
  const nativeCurrency = quote?.currency || (assetType === 'th_stock' ? 'THB' : 'USD');

  // Esc closes the modal
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!symbol) return null;

  const changePct = quote?.changePct;
  const changeCls = classForChange(changePct);
  const changeColor =
    changeCls === 'up' ? theme.colors.up : changeCls === 'down' ? theme.colors.down : theme.colors.textDim;

  const livePrice = quote ? convert(quote.price, nativeCurrency) : null;
  const displayName = name || quote?.name || symbol;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        // Only close when the backdrop itself is the mousedown target.
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className="modal-card"
        style={{
          width: 'min(1200px, 96vw)',
          height: 'min(92vh, 900px)',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.space(3),
            padding: `${theme.space(3)}px ${theme.space(4)}px`,
            borderBottom: `1px solid ${theme.colors.border}`,
            flex: '0 0 auto',
          }}
        >
          <span style={{ fontSize: 22, lineHeight: 1 }}>{meta.emoji}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: theme.space(2), flexWrap: 'wrap' }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: theme.colors.text }}>{symbol}</span>
              <span
                className="badge"
                style={{ background: 'transparent', color: meta.color, border: `1px solid ${meta.color}` }}
              >
                {meta.label}
              </span>
            </div>
            <div
              style={{
                fontSize: 12,
                color: theme.colors.textDim,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 360,
              }}
              title={displayName}
            >
              {displayName}
            </div>
          </div>

          {/* Live price + change */}
          <div style={{ marginLeft: 'auto', textAlign: 'right', display: 'flex', alignItems: 'center', gap: theme.space(2) }}>
            {quote ? (
              <span className="live-dot" title="Live" style={{ background: theme.colors.up }} />
            ) : null}
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: theme.colors.text, fontFamily: theme.mono }}>
                {livePrice != null ? fmtMoney(livePrice, displayCurrency) : '—'}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: changeColor, fontFamily: theme.mono }}>
                {Number.isFinite(changePct) ? fmtSignedPct(changePct) : '—'}
              </div>
            </div>
          </div>

          <button
            className="btn btn-ghost"
            aria-label="Close"
            onClick={() => onClose?.()}
            style={{ flex: '0 0 auto', padding: theme.space(2), marginLeft: theme.space(2) }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Controls bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.space(3),
            padding: `${theme.space(2)}px ${theme.space(4)}px`,
            borderBottom: `1px solid ${theme.colors.border}`,
            flexWrap: 'wrap',
            flex: '0 0 auto',
          }}
        >
          {/* Range selector */}
          <div className="segmented" role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button
                key={r}
                className={`segmented-item${r === range ? ' active' : ''}`}
                aria-pressed={r === range}
                onClick={() => setRange(r)}
                style={r === range ? { color: theme.colors.text } : undefined}
              >
                {r}
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          {/* Chart type selector */}
          <div className="segmented" role="group" aria-label="Chart type">
            {CHART_TYPES.map((t) => (
              <button
                key={t.id}
                className={`segmented-item${t.id === chartType ? ' active' : ''}`}
                aria-pressed={t.id === chartType}
                onClick={() => setChartType(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Log scale toggle */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.space(2),
              fontSize: 12,
              color: logScale ? theme.colors.text : theme.colors.textDim,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={logScale}
              onChange={(e) => setLogScale(e.target.checked)}
              style={{ accentColor: theme.colors.accent, cursor: 'pointer' }}
            />
            Log
          </label>
        </div>

        {/* Body: chart + indicator controls side by side, AI trade scout below */}
        <div
          className="scroll-area"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: theme.space(3),
            padding: theme.space(4),
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
          }}
        >
          <div style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-start', width: '100%' }}>
            {/* position:relative wrapper hosts the draw-on wipe over the chart */}
            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <FullChart
                key={`${symbol}:${range}`}
                symbol={symbol}
                range={range}
                interval="auto"
                chartType={chartType}
                logScale={logScale}
                indicators={indicators}
              />
              <ChartWipe resetKey={`${symbol}:${range}`} />
            </div>
            <IndicatorControls config={indicators} onChange={setIndicators} />
          </div>
          <TradeScout symbol={symbol} />
        </div>
      </div>
    </div>
  );
}
