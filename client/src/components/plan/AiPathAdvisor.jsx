import React, { useEffect, useRef, useState } from 'react';
import { Compass, Loader2, RefreshCw } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { getHealth, getRetirementAdvice } from '../../api/client.js';
import AiMarkdown, { SourceList } from '../AiMarkdown.jsx';

/**
 * AI Path Advisor — the deep-research companion to the Retirement planner.
 * Sends the planner's inputs + projection + live portfolio to the server, which
 * runs a multi-round Gemini analysis with Google Search grounding (current Thai
 * + US market and macro conditions) and returns a concrete, risk-balanced path:
 * allocation, glide path, tax-wrapper order, scenarios, and an action list.
 *
 * Renders nothing unless GEMINI_API_KEY is configured (via /api/health).
 */
export default function AiPathAdvisor({ payload }) {
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

  useEffect(() => () => clearInterval(timerRef.current), []);

  if (!enabled) return null;

  async function run() {
    setLoading(true);
    setError('');
    setElapsed(0);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    try {
      const res = await getRetirementAdvice(payload);
      setResult(res || null);
    } catch (e) {
      setError((e && e.message) || 'Failed to generate the plan');
    } finally {
      clearInterval(timerRef.current);
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.space(2),
        padding: theme.space(3),
        borderRadius: theme.radius.md,
        background: theme.colors.bgElev,
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
              background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.up})`,
              color: '#fff',
            }}
          >
            <Compass size={13} />
          </span>
          AI Path Advisor — deep research
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={run}
          disabled={loading}
          title="Researches current Thai + US markets and macro, then proposes a risk-balanced path to your retirement"
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: theme.colors.accent }}
        >
          {loading ? <Loader2 size={14} style={{ animation: 'pulse 1s linear infinite' }} /> : <RefreshCw size={14} />}
          {loading ? `Researching… ${elapsed}s` : result ? 'Refresh plan' : 'Generate my path plan'}
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
          Running multi-round research with live web search — current SET &amp; US market trends, rates,
          inflation and FX — then drafting and self-critiquing your plan. This usually takes 30–90 seconds.
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: theme.colors.textDim, lineHeight: 1.6 }}>
          Let the AI research <b>today's</b> Thai + US markets and macro-economy, then lay out the path for
          <b> your</b> numbers above: target allocation &amp; glide path, monthly plan, RMF/Thai ESG tax-wrapper
          order, best/base/worst scenarios, and a concrete action checklist — balanced for risk and reward.
        </div>
      )}

      <div style={{ fontSize: 10, color: theme.colors.textFaint }}>
        AI-generated with live web research · educational scenario analysis, not financial advice
      </div>
    </div>
  );
}
