import React from 'react';
import { Loader2 } from 'lucide-react';
import { theme } from '../../lib/theme.js';

/**
 * Live training log — one row per stage, updated in place while running (with
 * a progress bar for epochs/trees) and kept after the run so "what was
 * trained, and for how many epochs" stays visible. (Extracted from ForecastView.)
 */
export default function TrainingLog({ entries, busy }) {
  if (!entries.length) return null;
  const icon = (e) => {
    if (e.state === 'running') return <Loader2 size={13} style={{ color: theme.colors.accent, animation: 'pulse 1s linear infinite', flex: '0 0 auto' }} />;
    if (e.state === 'error') return <span style={{ color: theme.colors.down, fontWeight: 700, flex: '0 0 auto' }}>✕</span>;
    return <span style={{ color: theme.colors.up, fontWeight: 700, flex: '0 0 auto' }}>✓</span>;
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, background: theme.colors.bgElev, borderRadius: theme.radius.sm, padding: theme.space(2) }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: theme.colors.textDim, fontWeight: 600 }}>
        Training status{busy ? '' : ' — finished'}
      </div>
      {entries.map((e) => (
        <div key={e.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            {icon(e)}
            <span style={{ fontWeight: 700, color: theme.colors.text, whiteSpace: 'nowrap' }}>{e.label}</span>
            <span style={{ color: theme.colors.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {e.progress ? `${e.progress.done}/${e.progress.total} ${e.progress.unit}${e.progress.extra ? ` · ${e.progress.extra}` : ''}` : e.detail}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 10.5, fontFamily: theme.mono, color: theme.colors.textFaint, whiteSpace: 'nowrap' }}>
              {e.ms != null ? `${(e.ms / 1000).toFixed(1)}s` : ''}
            </span>
          </div>
          {e.progress && (
            <div style={{ height: 5, borderRadius: 3, background: theme.colors.panel, overflow: 'hidden', marginLeft: 21 }}>
              <div style={{ width: `${(e.progress.done / e.progress.total) * 100}%`, height: '100%', background: theme.colors.accent, transition: 'width 0.15s' }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
