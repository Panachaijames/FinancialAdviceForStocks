import React, { useMemo, useState } from 'react';
import { Wallet, Plus, Trash2 } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { fmtMoney } from '../../lib/format.js';
import { usePortfolioStore } from '../../store/portfolioStore.js';
import { useSavingsStore } from '../../store/savingsStore.js';
import { useSettingsStore } from '../../store/settingsStore.js';
import useQuotes from '../../hooks/useQuotes.js';
import useFx from '../../hooks/useFx.js';

/**
 * Net Worth = investments (live market value) + cash/savings. Lets the user add
 * cash balances so their full picture and allocation are visible.
 */
export default function SavingsPanel() {
  const holdings = usePortfolioStore((s) => s.holdings);
  const savings = useSavingsStore((s) => s.savings);
  const addSaving = useSavingsStore((s) => s.addSaving);
  const removeSaving = useSavingsStore((s) => s.removeSaving);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const { quotes } = useQuotes(symbols);
  const { convert } = useFx();

  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [curr, setCurr] = useState(displayCurrency);

  const investments = holdings.reduce((sum, h) => {
    const q = quotes[h.symbol];
    const native = h.currency || (h.type === 'th_stock' ? 'THB' : 'USD');
    const price = q && Number.isFinite(Number(q.price)) ? Number(q.price) : Number(h.avgCost) || 0;
    return sum + convert((Number(h.shares) || 0) * price, native);
  }, 0);
  const cash = savings.reduce((sum, s) => sum + convert(Number(s.amount) || 0, s.currency), 0);
  const net = investments + cash;
  const invPct = net > 0 ? (investments / net) * 100 : 0;
  const cashPct = net > 0 ? (cash / net) * 100 : 0;

  function handleAdd(e) {
    e.preventDefault();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    addSaving({ label: label || 'Savings', amount: amt, currency: curr });
    setLabel('');
    setAmount('');
  }

  const labelStyle = {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: theme.colors.textDim,
    fontWeight: 600,
  };

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
      <PanelHeader icon={<Wallet size={16} />} title="Savings & Net Worth" />

      <div>
        <div style={labelStyle}>Net Worth</div>
        <div style={{ fontSize: 30, fontWeight: 800, fontFamily: theme.mono, color: theme.colors.text, lineHeight: 1.1 }}>
          {fmtMoney(net, displayCurrency)}
        </div>
      </div>

      {/* Allocation bar */}
      <div>
        <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: theme.colors.bgElev }}>
          <div style={{ width: `${invPct}%`, background: theme.colors.accent }} title="Investments" />
          <div style={{ width: `${cashPct}%`, background: theme.colors.up }} title="Cash / savings" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: theme.space(1), fontSize: 12 }}>
          <span style={{ color: theme.colors.accent, fontWeight: 600 }}>
            ● Investments {fmtMoney(investments, displayCurrency)} ({invPct.toFixed(0)}%)
          </span>
          <span style={{ color: theme.colors.up, fontWeight: 600 }}>
            Cash {fmtMoney(cash, displayCurrency)} ({cashPct.toFixed(0)}%) ●
          </span>
        </div>
      </div>

      {/* Cash entries */}
      {savings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(1) }}>
          {savings.map((s) => (
            <div
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: theme.space(2),
                padding: `${theme.space(1)}px ${theme.space(2)}px`,
                background: theme.colors.bgElev,
                borderRadius: theme.radius.sm,
                fontSize: 13,
              }}
            >
              <span style={{ color: theme.colors.text }}>{s.label}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: theme.space(2) }}>
                <span style={{ fontFamily: theme.mono, color: theme.colors.text }}>
                  {fmtMoney(s.amount, s.currency)}
                </span>
                <button
                  type="button"
                  className="btn-ghost"
                  aria-label={`Remove ${s.label}`}
                  onClick={() => removeSaving(s.id)}
                  style={{ padding: 4, lineHeight: 0, color: theme.colors.down }}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Add cash form */}
      <form onSubmit={handleAdd} style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ flex: '2 1 120px' }}>
          <span style={{ ...labelStyle, display: 'block', marginBottom: 4 }}>Label</span>
          <input className="input" placeholder="e.g. Bank savings" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label style={{ flex: '1 1 90px' }}>
          <span style={{ ...labelStyle, display: 'block', marginBottom: 4 }}>Amount</span>
          <input className="input" type="number" inputMode="decimal" step="any" min="0" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <div className="segmented" role="group" aria-label="Currency">
          {['USD', 'THB'].map((c) => (
            <button
              key={c}
              type="button"
              className="segmented-item"
              aria-pressed={curr === c}
              onClick={() => setCurr(c)}
              style={{ background: curr === c ? theme.colors.accent : 'transparent', color: curr === c ? '#fff' : theme.colors.textDim }}
            >
              {c}
            </button>
          ))}
        </div>
        <button type="submit" className="btn btn-primary" style={{ flex: '0 0 auto' }}>
          <Plus size={15} /> Add
        </button>
      </form>
    </div>
  );
}

export function PanelHeader({ icon, title, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(2) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(1), fontWeight: 700, fontSize: 14, color: theme.colors.text }}>
        <span
          style={{
            display: 'flex',
            width: 24,
            height: 24,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radius.sm,
            background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.up})`,
            color: '#fff',
          }}
        >
          {icon}
        </span>
        {title}
      </div>
      {right}
    </div>
  );
}
