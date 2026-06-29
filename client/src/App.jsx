import React, { useState, useEffect, useCallback } from 'react';
import { theme } from './lib/theme.js';
import { assetMeta } from './lib/assetType.js';
import { usePortfolioStore } from './store/portfolioStore.js';
import marketSocket from './api/socket.js';

import Header from './components/Header.jsx';
import AddAssetBar from './components/AddAssetBar.jsx';
import PortfolioSummary from './components/PortfolioSummary.jsx';
import AssetCard from './components/AssetCard.jsx';
import DividendPanel from './components/DividendPanel.jsx';
import NewsPanel from './components/NewsPanel.jsx';
import ChartModal from './components/ChartModal.jsx';
import InsightsPanel from './components/InsightsPanel.jsx';
import PlanView from './components/plan/PlanView.jsx';

const QUICK_ADD = [
  { symbol: 'AAPL', name: 'Apple Inc.', type: 'us_stock', currency: 'USD', exchange: 'NASDAQ' },
  { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', type: 'etf', currency: 'USD', exchange: 'NYSEARCA' },
  { symbol: 'BTC-USD', name: 'Bitcoin USD', type: 'crypto', currency: 'USD', exchange: 'CCC' },
  { symbol: 'ETH-USD', name: 'Ethereum USD', type: 'crypto', currency: 'USD', exchange: 'CCC' },
  { symbol: 'GC=F', name: 'Gold Futures', type: 'gold', currency: 'USD', exchange: 'COMEX' },
  { symbol: 'PTT.BK', name: 'PTT PCL', type: 'th_stock', currency: 'THB', exchange: 'SET' },
  { symbol: 'CPALL.BK', name: 'CP All PCL', type: 'th_stock', currency: 'THB', exchange: 'SET' },
  { symbol: 'SCHD', name: 'Schwab US Dividend Equity ETF', type: 'etf', currency: 'USD', exchange: 'NYSEARCA' },
];

export default function App() {
  const holdings = usePortfolioStore((s) => s.holdings);
  const addHolding = usePortfolioStore((s) => s.addHolding);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState('portfolio'); // 'portfolio' | 'plan'

  // Open the live socket as soon as the app mounts.
  useEffect(() => {
    marketSocket.ensureConnected();
  }, []);

  const openChart = useCallback((symbol) => setSelected(symbol), []);
  const closeChart = useCallback(() => setSelected(null), []);

  const sectionGap = { display: 'flex', flexDirection: 'column', gap: theme.space(5) };

  return (
    <div className="app-root">
      <Header />

      <div className="app-container">
        {/* View switch */}
        <div className="segmented view-tabs" role="tablist" aria-label="View">
          {[
            ['portfolio', 'Portfolio'],
            ['plan', 'Plan'],
          ].map(([key, label]) => {
            const active = view === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                className="segmented-item"
                onClick={() => setView(key)}
                style={{
                  background: active ? theme.colors.accent : 'transparent',
                  color: active ? '#fff' : theme.colors.textDim,
                  fontWeight: active ? 700 : 600,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {view === 'plan' ? (
          <PlanView />
        ) : (
          <>
            <AddAssetBar />

            {holdings.length === 0 ? (
              <EmptyState onQuickAdd={(sr) => addHolding(sr, { shares: 0, avgCost: 0 })} />
            ) : (
              <div style={sectionGap}>
                <PortfolioSummary />

                <InsightsPanel />

                <div className="cards-grid">
                  {holdings.map((h) => (
                    <AssetCard key={h.id} holding={h} onOpen={() => openChart(h.symbol)} />
                  ))}
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr)',
                    gap: theme.space(5),
                  }}
                >
                  <DividendPanel />
                  <NewsPanel />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {selected ? <ChartModal symbol={selected} onClose={closeChart} /> : null}
    </div>
  );
}

function EmptyState({ onQuickAdd }) {
  const wrap = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: theme.space(4),
    padding: `${theme.space(14)}px ${theme.space(4)}px`,
  };
  const titleStyle = {
    fontSize: 26,
    fontWeight: 800,
    color: theme.colors.text,
    letterSpacing: '-0.01em',
  };
  const subStyle = {
    color: theme.colors.textDim,
    maxWidth: 520,
    fontSize: 15,
    lineHeight: 1.6,
  };
  const chipsWrap = {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: theme.space(2),
    marginTop: theme.space(2),
    maxWidth: 720,
  };

  return (
    <div className="panel" style={{ padding: 0, background: theme.colors.panel }}>
      <div style={wrap}>
        <div style={{ fontSize: 48, lineHeight: 1 }}>📈</div>
        <div style={titleStyle}>Build your multi-asset portfolio</div>
        <div style={subStyle}>
          Track Thai stocks, US stocks &amp; ETFs, crypto, and gold together in one
          dashboard with live prices, real-time charts, dividends, and news. Search
          above to add an asset, or start with a popular pick below.
        </div>
        <div style={chipsWrap}>
          {QUICK_ADD.map((sr) => {
            const meta = assetMeta(sr.type);
            return (
              <button
                key={sr.symbol}
                type="button"
                className="chip"
                onClick={() => onQuickAdd(sr)}
                title={`Add ${sr.name}`}
              >
                <span aria-hidden="true">{meta.emoji}</span>
                <span style={{ color: theme.colors.text }}>{sr.symbol}</span>
                <span style={{ color: theme.colors.textFaint }}>{meta.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
