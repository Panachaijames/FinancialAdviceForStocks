import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Search, Plus, Loader2, Eye } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { searchSymbols } from '../api/client.js';
import { classify, assetMeta, normalizeInput } from '../lib/assetType.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import HoldingEditor from './HoldingEditor.jsx';

const QUICK_ADD = [
  { symbol: 'BTC-USD', label: 'BTC' },
  { symbol: 'ETH-USD', label: 'ETH' },
  { symbol: 'GC=F', label: 'Gold' },
  { symbol: 'AAPL', label: 'AAPL' },
  { symbol: 'NVDA', label: 'NVDA' },
  { symbol: 'SCHD', label: 'SCHD' },
  { symbol: 'PTT.BK', label: 'PTT (TH)' },
  { symbol: 'CPALL.BK', label: 'CPALL (TH)' },
];

const NICE_NAMES = {
  'BTC-USD': 'Bitcoin',
  'ETH-USD': 'Ethereum',
  'GC=F': 'Gold Futures',
  AAPL: 'Apple Inc.',
  NVDA: 'NVIDIA Corp.',
  SCHD: 'Schwab US Dividend Equity ETF',
  'PTT.BK': 'PTT PCL',
  'CPALL.BK': 'CP All PCL',
};

function currencyForType(type) {
  return type === 'th_stock' ? 'THB' : 'USD';
}

/**
 * Build a SearchResult-like object from a bare symbol (quick-add / free-text).
 */
function resultFromSymbol(symbol, name) {
  const type = classify(symbol);
  return {
    symbol,
    name: name || NICE_NAMES[symbol] || symbol,
    type,
    exchange: '',
    currency: currencyForType(type),
  };
}

export default function AddAssetBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [pending, setPending] = useState(null); // asset selected -> open HoldingEditor
  const [error, setError] = useState('');

  const addHolding = usePortfolioStore((s) => s.addHolding);
  const holdings = usePortfolioStore((s) => s.holdings);
  const watchlist = usePortfolioStore((s) => s.watchlist);
  const addToWatchlist = usePortfolioStore((s) => s.addToWatchlist);

  const boxRef = useRef(null);
  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);

  const existingSymbols = new Set(holdings.map((h) => h.symbol));
  const watchedSymbols = new Set((watchlist || []).map((w) => w.symbol));

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 1) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const myReq = ++reqIdRef.current;
      try {
        const res = await searchSymbols(q);
        if (myReq !== reqIdRef.current) return; // stale
        setResults(Array.isArray(res) ? res : []);
        setError('');
      } catch (err) {
        if (myReq !== reqIdRef.current) return;
        setResults([]);
        setError('Search unavailable');
      } finally {
        if (myReq === reqIdRef.current) setLoading(false);
      }
    }, 280);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Close dropdown on outside click.
  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false);
        setHighlight(-1);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const selectResult = useCallback((r) => {
    setPending({
      symbol: r.symbol,
      name: r.name,
      type: r.type || classify(r.symbol),
      currency: r.currency || currencyForType(r.type || classify(r.symbol)),
      exchange: r.exchange || '',
    });
    setOpen(false);
    setHighlight(-1);
    setQuery('');
    setResults([]);
  }, []);

  // Free-text submit: try first result, else normalizeInput.
  const submitFreeText = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    if (results.length > 0) {
      selectResult(results[0]);
      return;
    }
    const sym = normalizeInput(q);
    if (sym) {
      selectResult(resultFromSymbol(sym));
    }
  }, [query, results, selectResult]);

  function onKeyDown(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlight >= 0 && results[highlight]) {
        selectResult(results[highlight]);
      } else {
        submitFreeText();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlight(-1);
    }
  }

  function handleSaveHolding({ shares, avgCost }) {
    if (pending) {
      addHolding(pending, { shares, avgCost });
    }
    setPending(null);
  }

  const showDropdown = open && query.trim().length >= 1;

  return (
    <div style={{ width: '100%' }}>
      <div
        ref={boxRef}
        style={{ position: 'relative', width: '100%', maxWidth: 560 }}
      >
        <div style={{ position: 'relative' }}>
          <span
            style={{
              position: 'absolute',
              left: theme.space(3),
              top: '50%',
              transform: 'translateY(-50%)',
              color: theme.colors.textFaint,
              pointerEvents: 'none',
              display: 'flex',
            }}
          >
            <Search size={16} />
          </span>
          <input
            className="input"
            type="text"
            placeholder="Search stocks, crypto, gold...  (e.g. AAPL, bitcoin, PTT.BK)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setHighlight(-1);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            aria-label="Search assets"
            autoComplete="off"
            style={{ paddingLeft: theme.space(7), paddingRight: theme.space(7) }}
          />
          <span
            style={{
              position: 'absolute',
              right: theme.space(3),
              top: '50%',
              transform: 'translateY(-50%)',
              color: theme.colors.textFaint,
              display: 'flex',
            }}
          >
            {loading ? (
              <Loader2 size={16} style={{ animation: 'pulse 1s linear infinite' }} />
            ) : null}
          </span>
        </div>

        {showDropdown && (
          <div
            className="panel scroll-area"
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              right: 0,
              zIndex: 40,
              maxHeight: 320,
              overflowY: 'auto',
              padding: theme.space(1),
              boxShadow: theme.shadow,
            }}
            role="listbox"
          >
            {loading && results.length === 0 && (
              <div style={{ padding: theme.space(3), color: theme.colors.textDim, fontSize: 13 }}>
                Searching...
              </div>
            )}
            {!loading && results.length === 0 && (
              <div style={{ padding: theme.space(3), color: theme.colors.textDim, fontSize: 13 }}>
                {error
                  ? error + '. '
                  : 'No matches. '}
                Press Enter to try "{query.trim()}" as a symbol.
              </div>
            )}
            {results.map((r, i) => {
              const meta = assetMeta(r.type || classify(r.symbol));
              const already = existingSymbols.has(r.symbol);
              const watched = watchedSymbols.has(r.symbol);
              const active = i === highlight;
              return (
                // A div (not a button) so it can hold the nested Watch button;
                // arrow-key highlight + Enter selection still runs via the input.
                <div
                  key={`${r.symbol}-${i}`}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => selectResult(r)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: theme.space(2),
                    width: '100%',
                    textAlign: 'left',
                    padding: `${theme.space(2)}px ${theme.space(2)}px`,
                    background: active ? theme.colors.panelElev : 'transparent',
                    borderRadius: theme.radius.sm,
                    cursor: 'pointer',
                    color: theme.colors.text,
                  }}
                >
                  <span style={{ fontSize: 18, width: 24, textAlign: 'center' }} aria-hidden="true">
                    {meta.emoji}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontWeight: 700,
                        fontSize: 13,
                        fontFamily: theme.mono,
                      }}
                    >
                      {r.symbol}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 12,
                        color: theme.colors.textDim,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {r.name}
                      {r.exchange ? ` · ${r.exchange}` : ''}
                    </span>
                  </span>
                  <span
                    className="badge"
                    style={{ background: meta.color + '22', color: meta.color, flexShrink: 0 }}
                  >
                    {meta.label}
                  </span>
                  {/* Watch (track without a position) — hidden once owned */}
                  {!already && (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={(e) => { e.stopPropagation(); addToWatchlist(r); }}
                      disabled={watched}
                      title={watched ? 'On your watchlist' : `Watch ${r.symbol} (no position)`}
                      aria-label={watched ? `${r.symbol} is on your watchlist` : `Watch ${r.symbol}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: 3,
                        lineHeight: 0,
                        color: watched ? theme.colors.accent : theme.colors.textFaint,
                        flexShrink: 0,
                        cursor: watched ? 'default' : 'pointer',
                      }}
                    >
                      <Eye size={15} />
                    </button>
                  )}
                  {already ? (
                    <span style={{ fontSize: 11, color: theme.colors.textFaint }}>added</span>
                  ) : (
                    <Plus size={16} style={{ color: theme.colors.accent, flexShrink: 0 }} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick-add suggestion chips */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: theme.space(1),
          marginTop: theme.space(2),
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 11, color: theme.colors.textFaint, marginRight: theme.space(1) }}>
          Quick add:
        </span>
        {QUICK_ADD.map((q) => {
          const meta = assetMeta(classify(q.symbol));
          const already = existingSymbols.has(q.symbol);
          return (
            <button
              key={q.symbol}
              type="button"
              className="chip"
              onClick={() => selectResult(resultFromSymbol(q.symbol))}
              disabled={already}
              title={already ? 'Already in portfolio' : `Add ${q.symbol}`}
              style={{
                cursor: already ? 'default' : 'pointer',
                opacity: already ? 0.45 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span aria-hidden="true">{meta.emoji}</span>
              {q.label}
            </button>
          );
        })}
      </div>

      {pending && (
        <HoldingEditor
          asset={pending}
          mode="add"
          onSave={handleSaveHolding}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
