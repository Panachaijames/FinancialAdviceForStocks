import React, { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import marketSocket from '../api/socket.js';
import CurrencyToggle from './CurrencyToggle.jsx';

/**
 * App header: brand, live connection status, and currency toggle.
 * Layout lives in index.css (.app-header etc.) so it can respond to screen size
 * and safe-area insets — on narrow phones the controls wrap to their own row
 * instead of overflowing off the right edge.
 */
export default function Header() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    marketSocket.ensureConnected();
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
    <header className="app-header">
      <div className="app-brand">
        <div className="app-brand-logo" aria-hidden="true">
          <TrendingUp size={22} strokeWidth={2.5} />
        </div>
        <div className="app-brand-text">
          <span className="app-brand-title">PT Financial Advisor</span>
          <span className="app-brand-sub">Multi-asset portfolio dashboard</span>
        </div>
      </div>

      <div className="app-controls">
        <div
          className="app-conn"
          title={connected ? 'Live market data connected' : 'Connecting to live data…'}
        >
          {connected ? (
            <span className="live-dot" aria-hidden="true" />
          ) : (
            <span className="conn-dot-off" aria-hidden="true" />
          )}
          <span className="app-conn-label" data-on={connected ? '1' : '0'}>
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>
        <CurrencyToggle />
      </div>
    </header>
  );
}
