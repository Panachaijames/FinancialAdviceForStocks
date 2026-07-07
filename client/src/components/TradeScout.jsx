import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, Loader2, RefreshCw } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { getHealth, getTradeIdea } from '../api/client.js';
import AiMarkdown, { SourceList } from './AiMarkdown.jsx';

/**
 * AI Trade Scout — short-term (days-to-weeks) research dossier for one symbol,
 * shown inside the chart modal. The server combines the app's own data (live
 * quote, candles -> technical snapshot, news feed) with multi-round Gemini
 * research using Google Search grounding, and returns a dossier: verdict,
 * dated catalysts with sources, technical read, a hypothetical trade scenario
 * with levels, the bear case, and what to watch next.
 *
 * Renders nothing unless GEMINI_API_KEY is configured (via /api/health).
 */
export default function TradeScout({ symbol }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null); // { text, sources, rounds }
  const [error, setError] = useState('');
  const timerRef = useRef(null);

  useEffect(() => {
    let ok = true;
    getHealth()
      .then((d) => {
        if (ok) setEnabled(!!(d && d.providers && d.providers.gemini));
      })
      .catch(() => {});
    return () => {
      ok = false;
    };
  }, []);

  // New symbol -> old dossier no longer applies.
  useEffect(() => {
    setResult(null);
    setError('');
  }, [symbol]);

  useEffect(() => () => clearInterval(timerRef.current), []);

  if (!enabled || !symbol) return null;

  async function run() {
    setLoading(true);
    setError('');
    setElapsed(0);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    try {
      const res = await getTradeIdea({ symbol });
      setResult(res || null);
    } catch (e) {
      setError((e && e.message) || 'Failed to generate the dossier');
    } finally {
      clearInterval(timerRef.current);
      setLoading(false);
    }
  }

  return (
    <div
      className="panel"
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: theme.space(2),
        padding: theme.space(3),
        borderLeft: `3px solid ${theme.colors.accent}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(2), flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(1), fontWeight: 700, fontSize: 13, color: theme.colors.text }}>
          <span
            style={{
              display: 'flex',
              width: 22,
              height: 22,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radius.sm,
              background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.down})`,
              color: '#fff',
            }}
          >
            <Crosshair size={13} />
          </span>
          AI Trade Scout — short-term read on {symbol}
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={run}
          disabled={loading}
          title="Deep-researches fresh news, catalysts and technicals for a short-term scenario"
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: theme.colors.accent }}
        >
          {loading ? <Loader2 size={14} style={{ animation: 'pulse 1s linear infinite' }} /> : <RefreshCw size={14} />}
          {loading ? `Researching… ${elapsed}s` : result ? 'Refresh' : 'Scout this symbol'}
        </button>
      </div>

      {error ? (
        <div style={{ fontSize: 13, color: theme.colors.down }}>{error}</div>
      ) : result && result.text ? (
        <>
          <AiMarkdown text={result.text} />
          <SourceList sources={result.sources} />
        </>
      ) : loading ? (
        <div style={{ fontSize: 12.5, color: theme.colors.textDim, lineHeight: 1.6 }}>
          Combining the live quote, a technical snapshot and the news feed with multi-round web research
          (latest catalysts, earnings dates, analyst moves, sector momentum, this week's macro events).
          Usually takes 30–90 seconds.
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: theme.colors.textDim, lineHeight: 1.6 }}>
          Ask the AI whether there's a credible <b>short-term</b> (days-to-weeks) opportunity in {symbol} right
          now: dated catalysts with sources, technical read, a hypothetical entry/stop/target scenario, the
          bear case, and what to watch next.
        </div>
      )}

      <div style={{ fontSize: 10, color: theme.colors.textFaint }}>
        AI-generated with live web research · educational scenario, not financial advice — short-term trading
        carries a high risk of loss
      </div>
    </div>
  );
}
