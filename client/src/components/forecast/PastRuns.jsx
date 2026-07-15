import React, { useState } from 'react';
import { History, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { useForecastStore } from '../../store/forecastStore.js';

/**
 * Persisted run history (pt-forecast, last 20): when, what symbol, what was
 * trained (models + epochs/trees), how each scored, and the horizon calls.
 * (Extracted from ForecastView.)
 */
export default function PastRuns() {
  const runs = useForecastStore((s) => s.runs);
  const clearRuns = useForecastStore((s) => s.clearRuns);
  const [open, setOpen] = useState(false);
  if (runs.length === 0) return null;

  const td = { padding: `${theme.space(1)}px ${theme.space(2)}px`, borderTop: `1px solid ${theme.colors.border}`, fontSize: 12, whiteSpace: 'nowrap', verticalAlign: 'top' };
  const pct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);

  return (
    <div className="panel" style={{ padding: theme.space(3), display: 'flex', flexDirection: 'column', gap: theme.space(2) }}>
      <button
        type="button"
        className="btn-ghost"
        onClick={() => setOpen((s) => !s)}
        style={{ display: 'flex', alignItems: 'center', gap: theme.space(1), fontWeight: 700, fontSize: 13, color: theme.colors.text, padding: 0, textAlign: 'left' }}
      >
        <History size={15} style={{ color: theme.colors.accent }} />
        Past runs ({runs.length})
        <span style={{ marginLeft: 'auto', color: theme.colors.textDim, display: 'flex' }}>
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </span>
      </button>

      {open && (
        <>
          <div style={{ overflowX: 'auto', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.sm }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: theme.colors.bgElev }}>
                  {['When', 'Symbol', 'Trained', 'Direction (holdout)', 'Ensemble call', 'Took'].map((h, i) => (
                    <th key={h} style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, fontSize: 11, color: theme.colors.textDim, fontWeight: 600, textAlign: i >= 4 ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const ensemble = r.returns?.ensemble ?? r.returns?.[r.models[0]?.key];
                  return (
                    <tr key={r.id}>
                      <td style={{ ...td, color: theme.colors.textDim }}>{String(r.at).slice(0, 16).replace('T', ' ')}</td>
                      <td style={{ ...td, fontFamily: theme.mono, fontWeight: 700, color: theme.colors.text }}>
                        {r.symbol}
                        <span style={{ color: theme.colors.textFaint, fontWeight: 400 }}> · {r.range} · {r.horizon}d</span>
                      </td>
                      <td style={{ ...td, color: theme.colors.text }} title={(r.models || []).map((m) => m.detail).join('\n')}>
                        {(r.models || []).map((m) => m.short).join(' · ') || '—'}
                        <div style={{ fontSize: 10.5, color: theme.colors.textFaint }}>{r.nFeatures} features × {r.nSamples} samples</div>
                      </td>
                      <td style={{ ...td, fontFamily: theme.mono, color: theme.colors.textDim }}>
                        {(r.models || []).map((m) => `${m.short.split(' ')[0]} ${m.dirAcc != null ? m.dirAcc.toFixed(0) : '—'}%`).join(' · ')}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: theme.mono, fontWeight: 700, color: ensemble >= 0 ? theme.colors.up : theme.colors.down }}>
                        {pct(ensemble)}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: theme.mono, color: theme.colors.textFaint }}>
                        {r.durationMs != null ? `${(r.durationMs / 1000).toFixed(0)}s` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(2) }}>
            <span style={{ fontSize: 10.5, color: theme.colors.textFaint }}>
              Hover "Trained" for full hyperparameters · "Ensemble call" is the predicted move over that run's horizon — check back later to see how it aged
            </span>
            <button
              type="button"
              className="btn-ghost"
              onClick={clearRuns}
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: theme.colors.textFaint }}
            >
              <Trash2 size={12} /> Clear history
            </button>
          </div>
        </>
      )}
    </div>
  );
}
