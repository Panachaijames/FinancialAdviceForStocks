import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import theme from '../lib/theme.js';
import { getNews } from '../api/client.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import { timeAgo } from '../lib/format.js';

const REFRESH_MS = 5 * 60 * 1000; // auto-refresh every 5 minutes

/**
 * NewsPanel
 * Fetches news for the portfolio's symbols, lists items (thumbnail, headline link,
 * source + relative time, related-symbol chips). Clicking a related-symbol chip
 * filters the list to items mentioning that symbol. Auto-refreshes every 5 minutes.
 */
export default function NewsPanel() {
  const symbols = usePortfolioStore((s) =>
    Array.from(new Set(s.holdings.map((h) => h.symbol))),
  );
  const symbolsKey = symbols.slice().sort().join(',');

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeFilter, setActiveFilter] = useState(null);

  // Track the latest request so stale responses don't overwrite fresh ones.
  const reqId = useRef(0);

  const load = useCallback(
    (showSpinner = true) => {
      const list = symbolsKey ? symbolsKey.split(',') : [];
      const id = ++reqId.current;
      if (showSpinner) setLoading(true);
      setError(null);

      getNews(list)
        .then((arr) => {
          if (id !== reqId.current) return; // superseded
          const next = Array.isArray(arr) ? arr : [];
          // Newest first; tolerate missing/invalid dates.
          next.sort((a, b) => {
            const ta = Date.parse(a?.publishedAt) || 0;
            const tb = Date.parse(b?.publishedAt) || 0;
            return tb - ta;
          });
          setItems(next);
          setLastUpdated(Date.now());
        })
        .catch((e) => {
          if (id !== reqId.current) return;
          setError(e?.message || 'Failed to load news');
        })
        .finally(() => {
          if (id === reqId.current) setLoading(false);
        });
    },
    [symbolsKey],
  );

  // Initial + on-symbol-change load.
  useEffect(() => {
    load(true);
    // Clear an active filter that no longer applies to the new symbol set.
    setActiveFilter((f) => (f && symbolsKey.split(',').includes(f) ? f : null));
  }, [symbolsKey, load]);

  // Auto-refresh every 5 minutes (silent, no spinner).
  useEffect(() => {
    const t = setInterval(() => load(false), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // The set of symbols that actually appear as related symbols across items,
  // restricted to the portfolio (used to render the filter chips).
  const filterChips = useMemo(() => {
    const portfolioSet = new Set(symbolsKey ? symbolsKey.split(',') : []);
    const seen = new Set();
    for (const it of items) {
      for (const s of it?.relatedSymbols || []) {
        if (portfolioSet.has(s)) seen.add(s);
      }
    }
    return Array.from(seen).sort();
  }, [items, symbolsKey]);

  const visibleItems = useMemo(() => {
    if (!activeFilter) return items;
    return items.filter((it) => (it?.relatedSymbols || []).includes(activeFilter));
  }, [items, activeFilter]);

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.space(2),
          marginBottom: theme.space(3),
        }}
      >
        <span style={{ fontSize: 18 }}>📰</span>
        <div style={{ fontSize: 15, fontWeight: 700, color: theme.colors.text }}>
          Portfolio News
        </div>
        <div style={{ flex: 1 }} />
        {lastUpdated ? (
          <span style={{ fontSize: 11, color: theme.colors.textFaint }}>
            {timeAgo(lastUpdated)}
          </span>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Refresh news"
          title="Refresh"
          onClick={() => load(true)}
          disabled={loading}
          style={{ padding: theme.space(2) }}
        >
          <RefreshCw
            size={15}
            style={loading ? { animation: 'pulse 1s ease-in-out infinite' } : undefined}
          />
        </button>
      </div>

      {/* Filter chips */}
      {filterChips.length > 0 ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: theme.space(2),
            marginBottom: theme.space(3),
          }}
        >
          <button
            type="button"
            className="chip"
            onClick={() => setActiveFilter(null)}
            style={
              activeFilter === null
                ? { borderColor: theme.colors.accent, color: theme.colors.text }
                : undefined
            }
          >
            All
          </button>
          {filterChips.map((s) => (
            <button
              key={s}
              type="button"
              className="chip"
              onClick={() => setActiveFilter((cur) => (cur === s ? null : s))}
              style={
                activeFilter === s
                  ? { borderColor: theme.colors.accent, color: theme.colors.text }
                  : undefined
              }
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      {/* Body */}
      <div className="scroll-area" style={{ display: 'flex', flexDirection: 'column', gap: theme.space(2), minHeight: 0 }}>
        {loading && items.length === 0 ? (
          <NewsSkeletons />
        ) : error && items.length === 0 ? (
          <ErrorState message={error} onRetry={() => load(true)} />
        ) : visibleItems.length === 0 ? (
          <EmptyState hasSymbols={symbols.length > 0} filtered={!!activeFilter} />
        ) : (
          visibleItems.map((it) => (
            <NewsRow key={it.id || it.url} item={it} onChip={setActiveFilter} activeFilter={activeFilter} />
          ))
        )}
      </div>
    </div>
  );
}

function NewsRow({ item, onChip, activeFilter }) {
  const related = Array.isArray(item.relatedSymbols) ? item.relatedSymbols : [];
  return (
    <a
      className="link-reset"
      href={item.url || '#'}
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'flex',
        gap: theme.space(3),
        padding: theme.space(2),
        borderRadius: theme.radius.md,
        border: `1px solid ${theme.colors.border}`,
        background: theme.colors.bgElev,
        transition: 'border-color 0.15s ease, background 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = theme.colors.accent;
        e.currentTarget.style.background = theme.colors.panelElev;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = theme.colors.border;
        e.currentTarget.style.background = theme.colors.bgElev;
      }}
    >
      {item.thumbnail ? (
        <img
          src={item.thumbnail}
          alt=""
          loading="lazy"
          style={{
            width: 72,
            height: 72,
            objectFit: 'cover',
            borderRadius: theme.radius.sm,
            flex: '0 0 auto',
            background: theme.colors.panel,
          }}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : null}

      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: theme.space(1) }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: theme.colors.text,
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {item.title || 'Untitled'}
        </div>

        {item.summary ? (
          <div
            style={{
              fontSize: 12,
              color: theme.colors.textDim,
              lineHeight: 1.4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {item.summary}
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.space(2),
            flexWrap: 'wrap',
            fontSize: 11,
            color: theme.colors.textFaint,
            marginTop: theme.space(1),
          }}
        >
          {item.source ? <span style={{ fontWeight: 600 }}>{item.source}</span> : null}
          {item.source && item.publishedAt ? <span>·</span> : null}
          {item.publishedAt ? <span>{timeAgo(item.publishedAt)}</span> : null}

          {related.length > 0 ? (
            <span style={{ display: 'inline-flex', gap: theme.space(1), flexWrap: 'wrap', marginLeft: theme.space(1) }}>
              {related.map((sym) => (
                <button
                  key={sym}
                  type="button"
                  className="chip"
                  // Prevent the parent <a> from navigating when filtering.
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onChip((cur) => (cur === sym ? null : sym));
                  }}
                  style={{
                    padding: '1px 8px',
                    fontSize: 10,
                    ...(activeFilter === sym
                      ? { borderColor: theme.colors.accent, color: theme.colors.text }
                      : {}),
                  }}
                >
                  {sym}
                </button>
              ))}
            </span>
          ) : null}
        </div>
      </div>
    </a>
  );
}

function NewsSkeletons() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: theme.space(3),
            padding: theme.space(2),
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.colors.border}`,
          }}
        >
          <div className="skeleton" style={{ width: 72, height: 72, borderRadius: theme.radius.sm, flex: '0 0 auto' }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: theme.space(2), justifyContent: 'center' }}>
            <div className="skeleton" style={{ height: 12, width: '85%', borderRadius: theme.radius.sm }} />
            <div className="skeleton" style={{ height: 12, width: '60%', borderRadius: theme.radius.sm }} />
            <div className="skeleton" style={{ height: 10, width: '40%', borderRadius: theme.radius.sm }} />
          </div>
        </div>
      ))}
    </>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: `${theme.space(8)}px ${theme.space(4)}px`,
        gap: theme.space(2),
        color: theme.colors.textDim,
      }}
    >
      <span style={{ fontSize: 26, opacity: 0.7 }}>⚠️</span>
      <div style={{ fontSize: 13, color: theme.colors.down }}>{message}</div>
      <button type="button" className="btn btn-ghost" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

function EmptyState({ hasSymbols, filtered }) {
  let title;
  let body;
  if (filtered) {
    title = 'No matching stories';
    body = 'No recent news mentions the selected symbol. Clear the filter to see everything.';
  } else if (hasSymbols) {
    title = 'No news right now';
    body = 'There are no recent stories for your holdings. Check back later.';
  } else {
    title = 'No holdings yet';
    body = 'Add assets to your portfolio to see related market news here.';
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: `${theme.space(8)}px ${theme.space(4)}px`,
        gap: theme.space(2),
        color: theme.colors.textDim,
      }}
    >
      <span style={{ fontSize: 28, opacity: 0.6 }}>🗞️</span>
      <div style={{ fontSize: 14, fontWeight: 600, color: theme.colors.text }}>{title}</div>
      <div style={{ fontSize: 12, maxWidth: 360, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}
