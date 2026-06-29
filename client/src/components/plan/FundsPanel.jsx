import React, { useEffect, useRef, useState } from 'react';
import { PiggyBank, Plus, Trash2, Search } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { fmtMoney, fmtNumber, fmtSignedPct } from '../../lib/format.js';
import { useSettingsStore } from '../../store/settingsStore.js';
import { useFundsStore } from '../../store/fundsStore.js';
import useFunds from '../../hooks/useFunds.js';
import useFx from '../../hooks/useFx.js';
import { searchFunds } from '../../api/client.js';
import { PanelHeader } from './SavingsPanel.jsx';

const dim = { fontSize: 11, color: theme.colors.textDim, textTransform: 'uppercase', letterSpacing: 0.4 };

/**
 * Thai mutual funds (RMF/LTF/SSF/…) via the SEC OpenAPI. Search a fund, track
 * units, and see daily NAV + value (in the display currency). NAV is in THB.
 */
export default function FundsPanel() {
  const { funds } = useFunds();
  const addFund = useFundsStore((s) => s.addFund);
  const updateFund = useFundsStore((s) => s.updateFund);
  const removeFund = useFundsStore((s) => s.removeFund);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const { convert } = useFx();

  const [enabled, setEnabled] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    let ok = true;
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => ok && setEnabled(!!(d && d.providers && d.providers.secFunds)))
      .catch(() => {});
    return () => {
      ok = false;
    };
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      return undefined;
    }
    timer.current = setTimeout(() => {
      setSearching(true);
      searchFunds(query)
        .then((r) => setResults(Array.isArray(r) ? r : []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(timer.current);
  }, [q]);

  if (!enabled) return null;

  const tracked = new Set(funds.map((f) => f.projId));

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
      <PanelHeader icon={<PiggyBank size={16} />} title="Thai Funds (RMF / LTF / SSF)" />

      {/* Search */}
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <Search
            size={15}
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.colors.textFaint }}
          />
          <input
            className="input"
            style={{ paddingLeft: 32 }}
            placeholder="Search a fund (e.g. K-BLRMF, RMF, SCB…)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {results.length > 0 && (
          <div
            style={{
              marginTop: 6,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radius.md,
              background: theme.colors.bgElev,
              maxHeight: 240,
              overflowY: 'auto',
            }}
          >
            {results.map((f) => (
              <button
                key={f.projId}
                type="button"
                disabled={tracked.has(f.projId)}
                onClick={() => {
                  addFund(f);
                  setQ('');
                  setResults([]);
                }}
                style={{
                  display: 'flex',
                  width: '100%',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: theme.space(2),
                  padding: `${theme.space(1)}px ${theme.space(2)}px`,
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `1px solid ${theme.colors.border}`,
                  textAlign: 'left',
                  cursor: tracked.has(f.projId) ? 'default' : 'pointer',
                  opacity: tracked.has(f.projId) ? 0.5 : 1,
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 700, color: theme.colors.text, fontFamily: theme.mono }}>{f.abbr}</span>
                  <span style={{ display: 'block', fontSize: 11, color: theme.colors.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.nameEn || f.nameTh}
                  </span>
                </span>
                {tracked.has(f.projId) ? (
                  <span style={{ fontSize: 11, color: theme.colors.textFaint }}>added</span>
                ) : (
                  <Plus size={15} style={{ color: theme.colors.accent, flexShrink: 0 }} />
                )}
              </button>
            ))}
          </div>
        )}
        {searching && <div style={{ fontSize: 11, color: theme.colors.textFaint, marginTop: 4 }}>Searching…</div>}
      </div>

      {/* Tracked funds */}
      {funds.length === 0 ? (
        <div style={{ fontSize: 13, color: theme.colors.textDim }}>
          Search and add your RMF/LTF/SSF funds to track daily NAV and value here (counts toward Net Worth).
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(2) }}>
          {funds.map((f) => {
            const valueDisplay = f.valueThb != null ? convert(f.valueThb, 'THB') : convert(f.costThb, 'THB');
            return (
              <div key={f.id} style={{ background: theme.colors.bgElev, borderRadius: theme.radius.md, padding: theme.space(2), display: 'flex', flexDirection: 'column', gap: theme.space(1) }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.space(2) }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 700, fontFamily: theme.mono, color: theme.colors.text }}>{f.abbr}</span>
                    <span style={{ display: 'block', fontSize: 11, color: theme.colors.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>{f.name}</span>
                  </div>
                  <button type="button" className="btn-ghost" aria-label={`Remove ${f.abbr}`} onClick={() => removeFund(f.id)} style={{ padding: 4, lineHeight: 0, color: theme.colors.down }}>
                    <Trash2 size={14} />
                  </button>
                </div>

                <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <span>
                    <span style={dim}>NAV</span>{' '}
                    <span style={{ fontFamily: theme.mono, fontWeight: 700, color: theme.colors.text }}>
                      {f.nav != null ? `฿${fmtNumber(f.nav, 4)}` : '—'}
                    </span>{' '}
                    {f.changePct != null && (
                      <span style={{ fontSize: 12, fontWeight: 700, color: f.changePct >= 0 ? theme.colors.up : theme.colors.down }}>
                        {fmtSignedPct(f.changePct)}
                      </span>
                    )}
                    {f.navDate && <span style={{ fontSize: 10, color: theme.colors.textFaint }}> · {f.navDate}</span>}
                  </span>
                  <span style={{ marginLeft: 'auto', textAlign: 'right' }}>
                    <span style={dim}>Value</span>{' '}
                    <span style={{ fontFamily: theme.mono, fontWeight: 800, color: theme.colors.text }}>{fmtMoney(valueDisplay, displayCurrency)}</span>
                    {f.plPct != null && (
                      <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 6, color: f.plPct >= 0 ? theme.colors.up : theme.colors.down }}>
                        ({fmtSignedPct(f.plPct)})
                      </span>
                    )}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: theme.space(2) }}>
                  <label style={{ flex: 1 }}>
                    <span style={{ ...dim, display: 'block', marginBottom: 2 }}>Units</span>
                    <input className="input" type="number" inputMode="decimal" step="any" min="0" value={f.units || ''} placeholder="0" onChange={(e) => updateFund(f.id, { units: e.target.value })} />
                  </label>
                  <label style={{ flex: 1 }}>
                    <span style={{ ...dim, display: 'block', marginBottom: 2 }}>Avg cost (฿/unit)</span>
                    <input className="input" type="number" inputMode="decimal" step="any" min="0" value={f.avgCost || ''} placeholder="0" onChange={(e) => updateFund(f.id, { avgCost: e.target.value })} />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ fontSize: 10, color: theme.colors.textFaint }}>
        NAV from the Thai SEC (updated once per business day). Values shown in {displayCurrency}.
      </div>
    </div>
  );
}
