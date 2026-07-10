import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import { useSettingsStore } from '../store/settingsStore.js';
import { usePlanStore } from '../store/planStore.js';
import useQuotes from '../hooks/useQuotes.js';
import useFx from '../hooks/useFx.js';
import useFunds from '../hooks/useFunds.js';
import useMagnetic from '../hooks/useMagnetic.js';
import { getAnalysis } from '../api/client.js';
import AiMarkdown from './AiMarkdown.jsx';

/**
 * AI Insights panel (Gemini-backed). Analysis only — summarizes the portfolio +
 * news the app already fetched. Renders nothing unless a GEMINI_API_KEY is set
 * (detected via /api/health). On-demand (button) to keep API usage minimal.
 */
const GOAL_EXAMPLES = [
  'Steady dividend income',
  'Long-term growth, high risk tolerance',
  'Preserve capital, low volatility',
  'Retire in 10 years',
  'Reduce single-stock concentration',
];

export default function InsightsPanel() {
  const holdings = usePortfolioStore((s) => s.holdings);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const analysisGoal = useSettingsStore((s) => s.analysisGoal);
  const setAnalysisGoal = useSettingsStore((s) => s.setAnalysisGoal);
  const analysisAge = useSettingsStore((s) => s.analysisAge);
  const setAnalysisAge = useSettingsStore((s) => s.setAnalysisAge);
  // Fall back to the age already entered in the retirement planner, if any.
  const planAge = usePlanStore((s) => s.currentAge);
  const effectiveAge = (analysisAge || '').trim() || (planAge || '').trim();
  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const { quotes } = useQuotes(symbols);
  const { convert } = useFx();
  const { funds: fundRows } = useFunds();

  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Subtle "magnetic" pull on the Generate/Refresh button (fx).
  const genMagnet = useMagnetic({ strength: 5 });

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

  if ((holdings.length === 0 && fundRows.length === 0) || !enabled) return null;

  async function run() {
    setLoading(true);
    setError('');
    try {
      const stockEntries = holdings.map((h) => {
        const q = quotes[h.symbol];
        const native = h.currency || (h.type === 'th_stock' ? 'THB' : 'USD');
        const price = q && Number.isFinite(Number(q.price)) ? Number(q.price) : Number(h.avgCost) || 0;
        const shares = Number(h.shares) || 0;
        const mvNative = shares * price;
        const costNative = shares * (Number(h.avgCost) || 0);
        const plPct = costNative > 0 ? ((mvNative - costNative) / costNative) * 100 : 0;
        return {
          symbol: h.symbol,
          name: h.name,
          type: h.type,
          shares,
          price,
          changePct: q && Number.isFinite(Number(q.changePct)) ? Number(q.changePct) : null,
          marketValue: convert(mvNative, native),
          plPct,
        };
      });
      // Include tracked Thai funds (RMF/LTF/SSF) so the analysis covers them too.
      const fundEntries = fundRows.map((f) => ({
        symbol: f.abbr,
        name: f.name,
        type: 'thai_fund',
        shares: Number(f.units) || 0,
        price: f.nav != null ? f.nav : null,
        changePct: f.changePct != null ? Number(f.changePct) : null,
        marketValue: convert(f.valueThb != null ? f.valueThb : f.costThb, 'THB'),
        plPct: f.plPct != null ? Number(f.plPct) : null,
      }));
      const ageNum = Number(effectiveAge);
      const payload = {
        displayCurrency,
        goal: (analysisGoal || '').trim(),
        age: Number.isFinite(ageNum) && ageNum > 0 && ageNum < 120 ? Math.round(ageNum) : undefined,
        holdings: [...stockEntries, ...fundEntries],
      };
      const res = await getAnalysis(payload);
      setText((res && res.text) || '');
    } catch (e) {
      setError((e && e.message) || 'Failed to generate insights');
    } finally {
      setLoading(false);
    }
  }

  const hasText = !!text.trim();

  return (
    <div
      className="panel fx-border-beam"
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
          className="btn-ghost btn-shine"
          ref={genMagnet.ref}
          onPointerMove={genMagnet.onPointerMove}
          onPointerLeave={genMagnet.onPointerLeave}
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

      {/* Goal input — tailors the whole analysis + suggested plan. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(1) }}>
        <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: theme.colors.textDim }}>
          Your goal for this portfolio <span style={{ textTransform: 'none', fontWeight: 400, color: theme.colors.textFaint }}>(optional — makes the analysis specific to you)</span>
        </label>
        <textarea
          className="input"
          value={analysisGoal}
          onChange={(e) => setAnalysisGoal(e.target.value)}
          placeholder="e.g. I want steady dividend income with low volatility, holding 5+ years"
          rows={2}
          style={{ width: '100%', resize: 'vertical', fontSize: 13, lineHeight: 1.5 }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {GOAL_EXAMPLES.map((g) => (
            <button
              key={g}
              type="button"
              className="chip"
              onClick={() => setAnalysisGoal(g)}
              style={{ fontSize: 11, color: analysisGoal === g ? '#fff' : theme.colors.textDim, background: analysisGoal === g ? theme.colors.accent : undefined }}
            >
              {g}
            </button>
          ))}
          {analysisGoal ? (
            <button type="button" className="chip" onClick={() => setAnalysisGoal('')} style={{ fontSize: 11, color: theme.colors.textFaint }}>
              Clear
            </button>
          ) : null}
          {/* Age — lets the AI reason about risk capacity & time horizon. */}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: theme.colors.textDim }}>
            Your age
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="119"
              value={analysisAge}
              onChange={(e) => setAnalysisAge(e.target.value)}
              placeholder={planAge && !analysisAge ? `${planAge}*` : 'e.g. 30'}
              title={planAge && !analysisAge ? `Using ${planAge} from your retirement plan — type to override` : 'Optional — the AI factors risk capacity by age'}
              className="input"
              style={{ width: 68, padding: '4px 8px', fontSize: 12 }}
            />
          </span>
        </div>
      </div>

      {error ? (
        <div style={{ fontSize: 13, color: theme.colors.down }}>{error}</div>
      ) : hasText ? (
        <AiMarkdown text={text} />
      ) : (
        <div style={{ fontSize: 13, color: theme.colors.textDim }}>
          Get a deep AI read on your portfolio — today's movers, allocation &amp; concentration,
          dividend income, risks, and a suggested plan. <b>Add a goal above</b> and the analysis
          judges how well your holdings fit it and tailors the plan to reach it.
        </div>
      )}

      <div style={{ fontSize: 10, color: theme.colors.textFaint }}>
        AI-generated · informational only, not financial advice
      </div>
    </div>
  );
}

