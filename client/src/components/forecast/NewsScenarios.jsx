import React from 'react';
import { Newspaper, ExternalLink } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { timeAgo } from '../../lib/format.js';
import { useT } from '../../lib/i18n.js';

// Mood polarity -> i18n key (mirrors sentiment.js moodLabel thresholds).
function moodKey(s) {
  if (s >= 0.33) return 'fnews.moodPositive';
  if (s >= 0.1) return 'fnews.moodSlightlyPositive';
  if (s > -0.1) return 'fnews.moodNeutral';
  if (s > -0.33) return 'fnews.moodSlightlyNegative';
  return 'fnews.moodNegative';
}

const toneColor = (s) => (s > 0.05 ? theme.colors.up : s < -0.05 ? theme.colors.down : theme.colors.textFaint);
const fmtPct = (p) => (Number.isFinite(p) ? `${p >= 0 ? '+' : ''}${p.toFixed(1)}%` : '—');
// Color a % by its sign (green up / red down) — a "bearish" branch can still end
// above today when the base forecast is strongly up, so tie color to the number.
const pctColor = (p) => (!Number.isFinite(p) ? theme.colors.textFaint : p > 0 ? theme.colors.up : p < 0 ? theme.colors.down : theme.colors.textFaint);

/**
 * News & scenarios panel under the forecast chart. Lists the recent headlines
 * that could move the symbol (tone-scored by the built-in lexicon), shows the
 * aggregate headline mood, and — when the overlay is on — the terminal size of
 * the illustrative bullish/bearish scenario branches drawn on the chart.
 *
 * Purely presentational: the parent owns the fetch + the branch math. Explicitly
 * framed as illustrative, not a prediction and not investment advice.
 */
export default function NewsScenarios({ symbol, news, loading = false, showOverlay = true, onToggleOverlay, scenario = null }) {
  const t = useT();
  const items = (news && news.items) || [];
  const agg = (news && news.agg) || { score: 0, count: 0 };

  return (
    <div className="panel" style={{ padding: theme.space(3), display: 'flex', flexDirection: 'column', gap: theme.space(2), borderLeft: `3px solid ${theme.colors.accent}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(1), flexWrap: 'wrap' }}>
        <Newspaper size={15} style={{ color: theme.colors.accent }} />
        <span style={{ fontWeight: 700, fontSize: 13, color: theme.colors.text }}>{t('fnews.title')}</span>
        {items.length > 0 && (
          <span
            style={{
              marginLeft: theme.space(1),
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 999,
              color: toneColor(agg.score),
              background: theme.colors.bgElev,
            }}
            title={t('fnews.basedOn', { count: agg.count })}
          >
            {t('fnews.mood')}: {t(moodKey(agg.score))}
          </span>
        )}
        <label
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: theme.colors.textDim, cursor: 'pointer' }}
          title={t('fnews.showOverlay')}
        >
          <input type="checkbox" checked={showOverlay} onChange={onToggleOverlay} style={{ accentColor: theme.colors.accent }} />
          {t('fnews.showOverlay')}
        </label>
      </div>

      <div style={{ fontSize: 11.5, color: theme.colors.textDim, lineHeight: 1.5 }}>{t('fnews.subtitle', { symbol })}</div>

      {/* Scenario terminal sizes (only meaningful while the overlay is drawn). */}
      {showOverlay && scenario && (
        <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', fontSize: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: theme.colors.textDim }}>
            <span style={{ width: 14, height: 0, borderTop: `2px dotted ${theme.colors.up}`, display: 'inline-block' }} />
            {t('fnews.bullishCase')} <b style={{ fontFamily: theme.mono, color: pctColor(scenario.upPct) }}>{fmtPct(scenario.upPct)}</b>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: theme.colors.textDim }}>
            <span style={{ width: 14, height: 0, borderTop: `2px dotted ${theme.colors.down}`, display: 'inline-block' }} />
            {t('fnews.bearishCase')} <b style={{ fontFamily: theme.mono, color: pctColor(scenario.downPct) }}>{fmtPct(scenario.downPct)}</b>
          </span>
        </div>
      )}

      {/* Headlines */}
      {loading ? (
        <div style={{ fontSize: 12.5, color: theme.colors.textDim }}>{t('fnews.loading')}</div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 12.5, color: theme.colors.textFaint }}>{t('fnews.noNews', { symbol })}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(1) }}>
          {items.slice(0, 8).map((it, i) => (
            <a
              key={it.url || i}
              href={it.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'baseline', gap: theme.space(1), fontSize: 12.5, color: theme.colors.text, textDecoration: 'none', lineHeight: 1.45 }}
            >
              <span
                title={t(moodKey(it.score))}
                style={{ flex: '0 0 auto', width: 8, height: 8, borderRadius: 4, background: toneColor(it.score), display: 'inline-block', transform: 'translateY(1px)' }}
              />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</span>
              <span style={{ flex: '0 0 auto', fontSize: 10.5, color: theme.colors.textFaint, whiteSpace: 'nowrap' }}>
                {it.source}
                {it.publishedAt ? ` · ${timeAgo(it.publishedAt)}` : ''}
              </span>
              <ExternalLink size={11} style={{ flex: '0 0 auto', color: theme.colors.textFaint, transform: 'translateY(1px)' }} />
            </a>
          ))}
        </div>
      )}

      <div style={{ fontSize: 10, color: theme.colors.textFaint, lineHeight: 1.5 }}>⚠️ {t('fnews.notAdvice')}</div>
    </div>
  );
}
