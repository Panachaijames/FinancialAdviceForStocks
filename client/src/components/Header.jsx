import React, { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { theme } from '../lib/theme.js';
import marketSocket from '../api/socket.js';
import CurrencyToggle from './CurrencyToggle.jsx';

/**
 * App header: brand, live connection status dot, and currency toggle.
 */
export default function Header() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    marketSocket.ensureConnected();
    // A quote or fx tick proves the socket is alive.
    const offQuote = marketSocket.onQuote(() => setConnected(true));
    const offFx = marketSocket.onFx(() => setConnected(true));

    // Optimistically mark connected shortly after mount; live ticks confirm it.
    const t = setTimeout(() => setConnected(true), 1200);

    return () => {
      clearTimeout(t);
      offQuote && offQuote();
      offFx && offFx();
    };
  }, []);

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.space(3),
        padding: `${theme.space(3)}px ${theme.space(4)}px`,
        background: theme.colors.panel,
        borderBottom: `1px solid ${theme.colors.border}`,
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(2) }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 38,
            height: 38,
            borderRadius: theme.radius.md,
            background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.up})`,
            color: '#ffffff',
            boxShadow: theme.shadow,
            flexShrink: 0,
          }}
        >
          <TrendingUp size={22} strokeWidth={2.5} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
          <span
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: theme.colors.text,
              letterSpacing: 0.2,
            }}
          >
            PT Financial Advisor
          </span>
          <span style={{ fontSize: 11, color: theme.colors.textFaint, fontWeight: 500 }}>
            Multi-asset portfolio dashboard
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(3) }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: theme.space(1) }}
          title={connected ? 'Live market data connected' : 'Connecting to live data...'}
        >
          {connected ? (
            <span className="live-dot" aria-hidden="true" />
          ) : (
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: theme.colors.textFaint,
                display: 'inline-block',
              }}
            />
          )}
          <span
            style={{
              fontSize: 11,
              color: connected ? theme.colors.up : theme.colors.textFaint,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>
        <CurrencyToggle />
      </div>
    </header>
  );
}
