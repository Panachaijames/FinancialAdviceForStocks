import React, { useEffect, useRef, useState } from 'react';
import { Compass, Loader2, RefreshCw } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { getHealth, getRetirementAdvice } from '../../api/client.js';
import AiMarkdown, { SourceList } from '../AiMarkdown.jsx';
import { useT } from '../../lib/i18n.js';

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
  const t = useT();
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
      setError((e && e.message) || t('pathadvisor.error.generateFailed'));
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
          {t('pathadvisor.heading')}
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={run}
          disabled={loading}
          title={t('pathadvisor.button.title')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: theme.colors.accent }}
        >
          {loading ? <Loader2 size={14} style={{ animation: 'pulse 1s linear infinite' }} /> : <RefreshCw size={14} />}
          {loading ? t('pathadvisor.button.researching', { seconds: elapsed }) : result ? t('pathadvisor.button.refresh') : t('pathadvisor.button.generate')}
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
          {t('pathadvisor.loadingDetail')}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: theme.colors.textDim, lineHeight: 1.6 }}>
          {t('pathadvisor.intro.lead')} <b>{t('pathadvisor.intro.today')}</b> {t('pathadvisor.intro.mid')}
          <b> {t('pathadvisor.intro.your')}</b> {t('pathadvisor.intro.tail')}
        </div>
      )}

      <div style={{ fontSize: 10, color: theme.colors.textFaint }}>
        {t('pathadvisor.disclaimer')}
      </div>
    </div>
  );
}
