import React, { useMemo, useState } from 'react';
import { Scale, ChevronDown, ChevronUp } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { fmtMoney, fmtSignedPct } from '../lib/format.js';
import { assetMeta } from '../lib/assetType.js';
import { useT } from '../lib/i18n.js';
import { useSettingsStore } from '../store/settingsStore.js';
import { useTargetsStore } from '../store/targetsStore.js';
import useNetWorth from '../hooks/useNetWorth.js';
import { computeRebalance } from '../lib/rebalance.js';

/**
 * Target allocation & rebalance helper. Set a target percent per asset class;
 * the panel shows the live drift and the exact buy/sell amount per class that
 * would restore the targets. Collapsed until opened; targets persist
 * (pt-targets). Pairs with the AI Path Advisor's recommended allocation.
 */
export default function RebalancePanel() {
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const { byType, net } = useNetWorth();
  const targets = useTargetsStore((s) => s.targets);
  const setTarget = useTargetsStore((s) => s.setTarget);
  const [open, setOpen] = useState(false);
  const t = useT();

  const { rows, total, targetSum, maxDrift } = useMemo(
    () => computeRebalance(byType, targets),
    [byType, targets]
  );

  const hasTargets = Object.keys(targets).length > 0;
  if (net <= 0) return null;

  const sumOk = !hasTargets || Math.abs(targetSum - 100) < 0.5;

  return (
    <div className="panel" style={{ padding: theme.space(3), display: 'flex', flexDirection: 'column', gap: theme.space(2) }}>
      <button
        type="button"
        className="btn-ghost"
        onClick={() => setOpen((s) => !s)}
        style={{ display: 'flex', alignItems: 'center', gap: theme.space(1), fontWeight: 700, fontSize: 13, color: theme.colors.text, padding: 0, textAlign: 'left' }}
      >
        <Scale size={15} style={{ color: theme.colors.accent }} />
        {t('rebalance.title')}
        {hasTargets && (
          <span
            className="badge"
            style={{
              marginLeft: theme.space(1),
              background: (maxDrift > 5 ? theme.colors.warn : theme.colors.up) + '22',
              color: maxDrift > 5 ? theme.colors.warn : theme.colors.up,
              fontWeight: 700,
            }}
          >
            {maxDrift > 5 ? t('rebalance.driftBadge', { pct: maxDrift.toFixed(0) }) : t('rebalance.onTargetBadge')}
          </span>
        )}
        <span style={{ marginLeft: 'auto', color: theme.colors.textDim, display: 'flex' }}>
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </span>
      </button>

      {open && (
        <>
          {!sumOk && (
            <div style={{ fontSize: 12, color: theme.colors.warn }}>
              {t('rebalance.sumWarning', { pct: targetSum.toFixed(0) })}
            </div>
          )}
          <div style={{ overflowX: 'auto', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.sm }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: theme.colors.bgElev }}>
                  {[t('rebalance.colAssetClass'), t('rebalance.colNow'), t('rebalance.colTargetPct'), t('rebalance.colDrift'), t('rebalance.colToRebalance')].map((h, i) => (
                    <th key={i} style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, fontSize: 11, color: theme.colors.textDim, fontWeight: 600, textAlign: i === 0 ? 'left' : 'right', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const meta = assetMeta(r.type);
                  const hasTarget = r.targetPct > 0;
                  return (
                    <tr key={r.type}>
                      <td style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, borderTop: `1px solid ${theme.colors.border}`, fontSize: 12.5, fontWeight: 700, color: theme.colors.text, whiteSpace: 'nowrap' }}>
                        {meta.emoji} {meta.label}
                      </td>
                      <td style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, borderTop: `1px solid ${theme.colors.border}`, fontSize: 12.5, textAlign: 'right', fontFamily: theme.mono, color: theme.colors.text, whiteSpace: 'nowrap' }}>
                        {r.currentPct.toFixed(1)}%
                        <span className="pm-mask" style={{ color: theme.colors.textFaint, fontSize: 11 }}> · {fmtMoney(r.value, displayCurrency)}</span>
                      </td>
                      <td style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, borderTop: `1px solid ${theme.colors.border}`, textAlign: 'right' }}>
                        <input
                          className="input"
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          max="100"
                          placeholder="—"
                          value={targets[r.type] ?? ''}
                          onChange={(e) => setTarget(r.type, e.target.value)}
                          style={{ width: 72, textAlign: 'right', padding: '4px 8px', fontSize: 12.5 }}
                        />
                      </td>
                      <td style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, borderTop: `1px solid ${theme.colors.border}`, fontSize: 12.5, textAlign: 'right', fontFamily: theme.mono, fontWeight: 600, color: !hasTarget ? theme.colors.textFaint : Math.abs(r.driftPct) <= 2 ? theme.colors.up : theme.colors.warn, whiteSpace: 'nowrap' }}>
                        {hasTarget ? fmtSignedPct(r.driftPct) : '—'}
                      </td>
                      <td className="pm-mask" style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, borderTop: `1px solid ${theme.colors.border}`, fontSize: 12.5, textAlign: 'right', fontFamily: theme.mono, fontWeight: 700, whiteSpace: 'nowrap', color: !hasTarget || !sumOk ? theme.colors.textFaint : r.amount > 0.5 ? theme.colors.up : r.amount < -0.5 ? theme.colors.down : theme.colors.textDim }}>
                        {hasTarget && sumOk
                          ? r.amount > 0.5
                            ? t('rebalance.buyAmount', { amount: fmtMoney(r.amount, displayCurrency) })
                            : r.amount < -0.5
                              ? t('rebalance.sellAmount', { amount: fmtMoney(-r.amount, displayCurrency) })
                              : t('rebalance.onTargetCell')
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pm-mask" style={{ fontSize: 10.5, color: theme.colors.textFaint }}>
            {t('rebalance.footnote', { total: fmtMoney(total, displayCurrency) })}
          </div>
        </>
      )}
    </div>
  );
}
