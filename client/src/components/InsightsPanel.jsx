import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import { useSettingsStore } from '../store/settingsStore.js';
import useQuotes from '../hooks/useQuotes.js';
import useFx from '../hooks/useFx.js';
import { getAnalysis } from '../api/client.js';

/**
 * AI Insights panel (Gemini-backed). Analysis only — summarizes the portfolio +
 * news the app already fetched. Renders nothing unless a GEMINI_API_KEY is set
 * (detected via /api/health). On-demand (button) to keep API usage minimal.
 */
export default function InsightsPanel() {
  const holdings = usePortfolioStore((s) => s.holdings);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const { quotes } = useQuotes(symbols);
  const { convert } = useFx();

  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let ok = true;
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => {
        if (ok) setEnabled(!!(d && d.providers && d.providers.gemini));
      })
      .catch(() => {});
    return () => {
      ok = false;
    };
  }, []);

  if (holdings.length === 0 || !enabled) return null;

  async function run() {
    setLoading(true);
    setError('');
    try {
      const payload = {
        displayCurrency,
        holdings: holdings.map((h) => {
          const q = quotes[h.symbol];
          const native = h.currency || (h.type === 'th_stock' ? 'THB' : 'USD');
          const price =
            q && Number.isFinite(Number(q.price)) ? Number(q.price) : Number(h.avgCost) || 0;
          const shares = Number(h.shares) || 0;
          const mvNative = shares * price;
          const costNative = shares * (Number(h.avgCost) || 0);
          const plPct = costNative > 0 ? ((mvNative - costNative) / costNative) * 100 : 0;
          return {
            symbol: h.symbol,
            name: h.name,
            shares,
            price,
            changePct: q && Number.isFinite(Number(q.changePct)) ? Number(q.changePct) : null,
            marketValue: convert(mvNative, native),
            plPct,
          };
        }),
      };
      const res = await getAnalysis(payload);
      setText((res && res.text) || '');
    } catch (e) {
      setError((e && e.message) || 'Failed to generate insights');
    } finally {
      setLoading(false);
    }
  }

  // Light markdown cleanup: drop ** bold markers; keep bullets/newlines as-is.
  const clean = text.replace(/\*\*(.*?)\*\*/g, '$1');

  return (
    <div
      className="panel"
      style={{
        padding: theme.space(3),
        display: 'flex',
        flexDirection: 'column',
        gap: theme.space(2),
        borderLeft: `3px solid ${theme.colors.accent}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(2) }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.space(1),
            fontWeight: 700,
            fontSize: 13,
            color: theme.colors.text,
          }}
        >
          <span
            style={{
              display: 'flex',
              width: 22,
              height: 22,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radius.sm,
              background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.up})`,
              color: '#fff',
            }}
          >
            <Sparkles size={13} />
          </span>
          AI Insights
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={run}
          disabled={loading}
          title="Generate an AI summary of your portfolio"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
            color: theme.colors.accent,
            padding: `${theme.space(1)}px ${theme.space(2)}px`,
          }}
        >
          {loading ? (
            <Loader2 size={14} style={{ animation: 'pulse 1s linear infinite' }} />
          ) : (
            <RefreshCw size={14} />
          )}
          {loading ? 'Analyzing…' : text ? 'Refresh' : 'Generate'}
        </button>
      </div>

      {error ? (
        <div style={{ fontSize: 13, color: theme.colors.down }}>{error}</div>
      ) : clean ? (
        <div
          style={{
            fontSize: 13.5,
            lineHeight: 1.6,
            color: theme.colors.text,
            whiteSpace: 'pre-wrap',
          }}
        >
          {clean}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: theme.colors.textDim }}>
          Get a quick AI read on how your portfolio is doing today and what the news says.
        </div>
      )}

      <div style={{ fontSize: 10, color: theme.colors.textFaint }}>
        AI-generated · informational only, not financial advice
      </div>
    </div>
  );
}
