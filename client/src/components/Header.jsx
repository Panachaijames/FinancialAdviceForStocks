import React, { useEffect, useState } from 'react';
import { TrendingUp, Sparkles, Layers } from 'lucide-react';
import marketSocket from '../api/socket.js';
import { useSettingsStore } from '../store/settingsStore.js';
import CurrencyToggle from './CurrencyToggle.jsx';
import GradientText from './fx/GradientText.jsx';

const FX_LABEL = { auto: 'Auto', on: 'On', off: 'Off' };
const FX_TITLE = {
  auto: 'Effects: Auto — follows your system\'s "reduce motion" setting (Windows: Settings → Accessibility → Visual effects → Animation effects). Click to force ON.',
  on: 'Effects: On — animations always play, even if the OS asks for reduced motion. Click to turn OFF.',
  off: 'Effects: Off — all animations disabled. Click for Auto.',
};

/**
 * App header: brand, live connection status, FX toggle, and currency toggle.
 * Layout lives in index.css (.app-header etc.) so it can respond to screen size
 * and safe-area insets — on narrow phones the controls wrap to their own row
 * instead of overflowing off the right edge.
 */
export default function Header() {
  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const fxMode = useSettingsStore((s) => s.fxMode);
  const setFxMode = useSettingsStore((s) => s.setFxMode);
  const glassMode = useSettingsStore((s) => s.glassMode);
  const toggleGlassMode = useSettingsStore((s) => s.toggleGlassMode);

  useEffect(() => {
    marketSocket.ensureConnected();
    // Seed from the socket's real current state (it may already be open).
    setConnected(marketSocket.connected);
    if (marketSocket.connected) setEverConnected(true);
    const off = marketSocket.onStatus((on) => {
      setConnected(on);
      if (on) setEverConnected(true);
    });
    return off;
  }, []);

  const cycleFx = () =>
    setFxMode(fxMode === 'auto' ? 'on' : fxMode === 'on' ? 'off' : 'auto');

  return (
    <header className="app-header">
      <div className="app-brand">
        <div className="app-brand-logo" aria-hidden="true">
          <TrendingUp size={22} strokeWidth={2.5} />
        </div>
        <div className="app-brand-text">
          <GradientText className="app-brand-title">PT Financial Advisor</GradientText>
          <span className="app-brand-sub">Multi-asset portfolio dashboard</span>
        </div>
      </div>

      <div className="app-controls">
        <button
          type="button"
          className="chip"
          onClick={cycleFx}
          title={FX_TITLE[fxMode] || FX_TITLE.auto}
          aria-label={`Animation effects: ${FX_LABEL[fxMode] || 'Auto'}. Click to change.`}
          style={{ opacity: fxMode === 'off' ? 0.55 : 1 }}
        >
          <Sparkles size={13} aria-hidden="true" />
          FX {FX_LABEL[fxMode] || 'Auto'}
        </button>
        <button
          type="button"
          className="chip"
          onClick={toggleGlassMode}
          aria-pressed={glassMode}
          title={
            glassMode
              ? 'Glass mode: On — frosted translucent panels over the aurora. Click to turn off.'
              : 'Glass mode: Off — solid panels. Click for frosted-glass panels over the aurora.'
          }
          style={{
            color: glassMode ? '#fff' : undefined,
            background: glassMode ? 'var(--accent)' : undefined,
            borderColor: glassMode ? 'var(--accent)' : undefined,
          }}
        >
          <Layers size={13} aria-hidden="true" />
          Glass
        </button>
        <div
          className="app-conn"
          title={
            connected
              ? 'Live market data connected'
              : everConnected
                ? 'Connection lost — reconnecting to live data…'
                : 'Connecting to live data…'
          }
        >
          {connected ? (
            <span className="live-dot" aria-hidden="true" />
          ) : (
            <span className="conn-dot-off" aria-hidden="true" />
          )}
          <span className="app-conn-label" data-on={connected ? '1' : '0'} aria-live="polite">
            {connected ? 'Live' : everConnected ? 'Reconnecting…' : 'Offline'}
          </span>
        </div>
        <CurrencyToggle />
      </div>
    </header>
  );
}
