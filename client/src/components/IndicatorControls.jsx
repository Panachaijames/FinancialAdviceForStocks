import React from 'react';
import theme from '../lib/theme.js';

/**
 * Default indicator configuration. ChartModal owns the actual state; this is
 * exported here only as a convenience reference for consumers that want a
 * sensible starting point. The contract keeps the config flat and explicit so
 * FullChart can read it without guessing.
 */
export const DEFAULT_INDICATOR_CONFIG = {
  // Overlays (drawn on the main price chart)
  sma: { on: false, period: 20 },
  ema: { on: false, period: 50 },
  wma: { on: false, period: 20 },
  bollinger: { on: false, period: 20, mult: 2 },
  vwap: { on: false },
  volume: { on: true },
  // Oscillators (each in its own stacked sub-chart)
  rsi: { on: false, period: 14 },
  macd: { on: false, fast: 12, slow: 26, signal: 9 },
  stochastic: { on: false, kPeriod: 14, dPeriod: 3 },
};

const OVERLAY_COLORS = {
  sma: '#3b82f6',
  ema: '#f59e0b',
  wma: '#a855f7',
  bollinger: '#64748b',
  vwap: '#22d3ee',
};

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: theme.space(4) }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: theme.colors.textFaint,
          marginBottom: theme.space(2),
          paddingBottom: theme.space(1),
          borderBottom: `1px solid ${theme.colors.border}`,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(2) }}>
        {children}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label, color }) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.space(2),
        cursor: 'pointer',
        userSelect: 'none',
        fontSize: 13,
        color: checked ? theme.colors.text : theme.colors.textDim,
        fontWeight: checked ? 600 : 500,
        minWidth: 0,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: color || theme.colors.accent, cursor: 'pointer', width: 14, height: 14 }}
      />
      {color ? (
        <span
          style={{
            width: 10,
            height: 3,
            borderRadius: 2,
            background: color,
            flex: '0 0 auto',
          }}
        />
      ) : null}
      <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
    </label>
  );
}

function PeriodInput({ value, onChange, min = 1, max = 400, title }) {
  return (
    <input
      className="input"
      type="number"
      title={title}
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
      }}
      style={{
        width: 56,
        padding: `${theme.space(1)}px ${theme.space(2)}px`,
        fontSize: 12,
        textAlign: 'center',
      }}
    />
  );
}

/**
 * Row laying out a toggle on the left and any per-indicator parameter inputs on
 * the right. Inputs are dimmed/disabled when the indicator is off.
 */
function Row({ children, params, on }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.space(2),
      }}
    >
      {children}
      {params ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.space(2),
            opacity: on ? 1 : 0.35,
            pointerEvents: on ? 'auto' : 'none',
          }}
        >
          {params}
        </div>
      ) : null}
    </div>
  );
}

/**
 * IndicatorControls — controlled panel.
 * Props:
 *   config   : the full indicator config object (see DEFAULT_INDICATOR_CONFIG)
 *   onChange : (nextConfig) => void
 */
export default function IndicatorControls({ config = DEFAULT_INDICATOR_CONFIG, onChange }) {
  const cfg = config || DEFAULT_INDICATOR_CONFIG;

  // Patch a single indicator key, merging the partial into its sub-object.
  const patch = (key, partial) => {
    const next = {
      ...cfg,
      [key]: { ...(cfg[key] || {}), ...partial },
    };
    if (typeof onChange === 'function') onChange(next);
  };

  const labelStyle = {
    fontSize: 11,
    color: theme.colors.textFaint,
    fontWeight: 600,
  };

  return (
    <div
      className="panel scroll-area"
      style={{
        padding: theme.space(4),
        width: '100%',
        maxWidth: 280,
        minWidth: 220,
        boxSizing: 'border-box',
        overflowY: 'auto',
        alignSelf: 'stretch',
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: theme.colors.text,
          marginBottom: theme.space(3),
        }}
      >
        Indicators
      </div>

      <Section title="Overlays">
        <Row
          on={cfg.sma?.on}
          params={
            <>
              <span style={labelStyle}>n</span>
              <PeriodInput
                title="SMA period"
                value={cfg.sma?.period ?? 20}
                onChange={(n) => patch('sma', { period: n })}
              />
            </>
          }
        >
          <Toggle
            checked={!!cfg.sma?.on}
            color={OVERLAY_COLORS.sma}
            label="SMA"
            onChange={(on) => patch('sma', { on })}
          />
        </Row>

        <Row
          on={cfg.ema?.on}
          params={
            <>
              <span style={labelStyle}>n</span>
              <PeriodInput
                title="EMA period"
                value={cfg.ema?.period ?? 50}
                onChange={(n) => patch('ema', { period: n })}
              />
            </>
          }
        >
          <Toggle
            checked={!!cfg.ema?.on}
            color={OVERLAY_COLORS.ema}
            label="EMA"
            onChange={(on) => patch('ema', { on })}
          />
        </Row>

        <Row
          on={cfg.wma?.on}
          params={
            <>
              <span style={labelStyle}>n</span>
              <PeriodInput
                title="WMA period"
                value={cfg.wma?.period ?? 20}
                onChange={(n) => patch('wma', { period: n })}
              />
            </>
          }
        >
          <Toggle
            checked={!!cfg.wma?.on}
            color={OVERLAY_COLORS.wma}
            label="WMA"
            onChange={(on) => patch('wma', { on })}
          />
        </Row>

        <Row
          on={cfg.bollinger?.on}
          params={
            <>
              <span style={labelStyle}>n</span>
              <PeriodInput
                title="Bollinger period"
                value={cfg.bollinger?.period ?? 20}
                onChange={(n) => patch('bollinger', { period: n })}
              />
              <span style={labelStyle}>σ</span>
              <PeriodInput
                title="Bollinger std-dev multiplier"
                min={1}
                max={5}
                value={cfg.bollinger?.mult ?? 2}
                onChange={(n) => patch('bollinger', { mult: n })}
              />
            </>
          }
        >
          <Toggle
            checked={!!cfg.bollinger?.on}
            color={OVERLAY_COLORS.bollinger}
            label="Bollinger"
            onChange={(on) => patch('bollinger', { on })}
          />
        </Row>

        <Row on={cfg.vwap?.on}>
          <Toggle
            checked={!!cfg.vwap?.on}
            color={OVERLAY_COLORS.vwap}
            label="VWAP"
            onChange={(on) => patch('vwap', { on })}
          />
        </Row>

        <Row on={cfg.volume?.on}>
          <Toggle
            checked={!!cfg.volume?.on}
            color={theme.colors.textDim}
            label="Volume"
            onChange={(on) => patch('volume', { on })}
          />
        </Row>
      </Section>

      <Section title="Oscillators">
        <Row
          on={cfg.rsi?.on}
          params={
            <>
              <span style={labelStyle}>n</span>
              <PeriodInput
                title="RSI period"
                value={cfg.rsi?.period ?? 14}
                onChange={(n) => patch('rsi', { period: n })}
              />
            </>
          }
        >
          <Toggle
            checked={!!cfg.rsi?.on}
            label="RSI"
            onChange={(on) => patch('rsi', { on })}
          />
        </Row>

        <Row
          on={cfg.macd?.on}
          params={
            <>
              <PeriodInput
                title="MACD fast period"
                value={cfg.macd?.fast ?? 12}
                onChange={(n) => patch('macd', { fast: n })}
              />
              <PeriodInput
                title="MACD slow period"
                value={cfg.macd?.slow ?? 26}
                onChange={(n) => patch('macd', { slow: n })}
              />
              <PeriodInput
                title="MACD signal period"
                value={cfg.macd?.signal ?? 9}
                onChange={(n) => patch('macd', { signal: n })}
              />
            </>
          }
        >
          <Toggle
            checked={!!cfg.macd?.on}
            label="MACD"
            onChange={(on) => patch('macd', { on })}
          />
        </Row>

        <Row
          on={cfg.stochastic?.on}
          params={
            <>
              <span style={labelStyle}>%K</span>
              <PeriodInput
                title="Stochastic %K period"
                value={cfg.stochastic?.kPeriod ?? 14}
                onChange={(n) => patch('stochastic', { kPeriod: n })}
              />
              <span style={labelStyle}>%D</span>
              <PeriodInput
                title="Stochastic %D period"
                value={cfg.stochastic?.dPeriod ?? 3}
                onChange={(n) => patch('stochastic', { dPeriod: n })}
              />
            </>
          }
        >
          <Toggle
            checked={!!cfg.stochastic?.on}
            label="Stochastic"
            onChange={(on) => patch('stochastic', { on })}
          />
        </Row>
      </Section>

      <div style={{ marginTop: theme.space(2) }}>
        <button
          className="btn btn-ghost"
          style={{ width: '100%', fontSize: 12 }}
          onClick={() => {
            if (typeof onChange === 'function') {
              // Reset everything off except Volume (matches default).
              onChange(JSON.parse(JSON.stringify(DEFAULT_INDICATOR_CONFIG)));
            }
          }}
        >
          Reset indicators
        </button>
      </div>
    </div>
  );
}
