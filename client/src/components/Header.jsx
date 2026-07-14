import React, { useEffect, useState } from 'react';
import { TrendingUp, Sparkles, Layers } from 'lucide-react';
import marketSocket from '../api/socket.js';
import { getHealth } from '../api/client.js';
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
  const [waking, setWaking] = useState(false);
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
      if (on) {
        setEverConnected(true);
        setWaking(false); // live data arrived — dismiss the waking notice
      }
    });

    // Cold-start detection: on the free dyno the server may be asleep, so the WS
    // won't connect and getHealth() is slow (~30s). If neither has come back
    // within 3s, tell the user it's waking up instead of the alarming "Offline".
    let done = false;
    getHealth()
      .then(() => {
        done = true;
        setWaking(false); // server responded — it's awake
      })
      .catch(() => {
        /* still unreachable; the WS-connect handler clears waking when it lands */
      });
    const t = setTimeout(() => {
      if (!done && !marketSocket.connected) setWaking(true);
    }, 3000);

    return () => {
      clearTimeout(t);
      off();
    };
  }, []);

  const cycleFx = () =>
    setFxMode(fxMode === 'auto' ? 'on' : fxMode === 'on' ? 'off' : 'auto');

  return (
    <>
      {waking && !connected ? (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '6px 14px',
            fontSize: 12.5,
            fontWeight: 600,
            textAlign: 'center',
            color: 'var(--text)',
            background: 'rgba(59, 130, 246, 0.12)',
            borderBottom: '1px solid var(--accent)',
          }}
        >
          <span className="conn-dot-off" aria-hidden="true" />
          Free server is waking up — live data in ~30s…
        </div>
      ) : null}
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
    </>
  );
}
