import React, { useMemo, useState } from 'react';
import { History, Undo2, ChevronDown, ChevronUp, Upload, Download } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { fmtMoney, fmtNumber, classForChange } from '../lib/format.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import { useSettingsStore } from '../store/settingsStore.js';
import useFx from '../hooks/useFx.js';
import { realizedByCurrency } from '../lib/trades.js';
import { tradesToCsv } from '../lib/csvImport.js';
import { downloadTextFile } from '../lib/backup.js';
import CsvImportDialog from './CsvImportDialog.jsx';

const SHOW_COLLAPSED = 8;

function colorForChange(v) {
  const c = classForChange(v);
  if (c === 'up') return theme.colors.up;
  if (c === 'down') return theme.colors.down;
  return theme.colors.textDim;
}

/**
 * Trade history — every buy/sell the user recorded, newest first, with the
 * total realized P/L (converted to the display currency). The latest trade of
 * each symbol can be undone (it restores the position snapshot taken when the
 * trade was recorded). Renders nothing until there is at least one trade.
 */
export default function TransactionsPanel() {
  const transactions = usePortfolioStore((s) => s.transactions);
  const undoTransaction = usePortfolioStore((s) => s.undoTransaction);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const { convert } = useFx();
  const [showAll, setShowAll] = useState(false);
  const [importing, setImporting] = useState(false);

  const rows = useMemo(
    () => [...(transactions || [])].sort((a, b) => (a.at < b.at ? 1 : -1)),
    [transactions]
  );

  // Latest transaction per symbol -> the only ones that may be undone.
  const undoable = useMemo(() => {
    const latest = new Set();
    const seen = new Set();
    for (const t of rows) {
      if (!seen.has(t.symbol)) {
        latest.add(t.id);
        seen.add(t.symbol);
      }
    }
    return latest;
  }, [rows]);

  const totalRealized = useMemo(() => {
    const byCur = realizedByCurrency(transactions);
    return Object.entries(byCur).reduce((sum, [cur, v]) => sum + convert(v, cur), 0);
  }, [transactions, convert]);

  const visible = showAll ? rows : rows.slice(0, SHOW_COLLAPSED);
  const td = { padding: `${theme.space(1)}px ${theme.space(2)}px`, borderTop: `1px solid ${theme.colors.border}`, fontSize: 12.5, whiteSpace: 'nowrap' };
  const right = { textAlign: 'right', fontFamily: theme.mono };

  return (
    <div className="panel" style={{ padding: theme.space(3), display: 'flex', flexDirection: 'column', gap: theme.space(2) }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(2), flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(1), fontWeight: 700, fontSize: 13, color: theme.colors.text }}>
          <History size={15} style={{ color: theme.colors.accent }} />
          Trades ({rows.length})
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(3) }}>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setImporting(true)}
            title="Import a broker CSV of trades"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: theme.colors.accent }}
          >
            <Upload size={14} /> Import CSV
          </button>
          {rows.length > 0 && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => downloadTextFile('pt-trades.csv', tradesToCsv(transactions), 'text/csv')}
              title="Export your trades as a CSV (re-importable)"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: theme.colors.accent }}
            >
              <Download size={14} /> Export CSV
            </button>
          )}
          {rows.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: theme.space(1) }}>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: theme.colors.textDim }}>
                Realized P/L
              </span>
              <span style={{ fontSize: 15, fontWeight: 800, fontFamily: theme.mono, color: colorForChange(totalRealized) }}>
                {fmtMoney(totalRealized, displayCurrency)}
              </span>
            </div>
          )}
        </div>
      </div>

      {importing && <CsvImportDialog onClose={() => setImporting(false)} />}

      {rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: theme.colors.textDim }}>
          Record buys/sells with the <b>Buy / Sell</b> buttons on your asset cards — or import your broker's
          CSV — to track realized profit &amp; loss here.
        </div>
      ) : (
      <div style={{ overflowX: 'auto', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.sm }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: theme.colors.bgElev }}>
              {['Date', 'Side', 'Symbol', 'Qty', 'Price', 'Fee', 'Realized P/L', ''].map((h, i) => (
                <th
                  key={i}
                  style={{
                    padding: `${theme.space(1)}px ${theme.space(2)}px`,
                    fontSize: 11,
                    color: theme.colors.textDim,
                    fontWeight: 600,
                    textAlign: i >= 3 && i <= 6 ? 'right' : 'left',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => {
              const isSell = t.side === 'sell';
              return (
                <tr key={t.id}>
                  <td style={{ ...td, color: theme.colors.textDim }}>{String(t.at).slice(0, 10)}</td>
                  <td style={td}>
                    <span
                      className="badge"
                      style={{
                        background: (isSell ? theme.colors.down : theme.colors.up) + '22',
                        color: isSell ? theme.colors.down : theme.colors.up,
                        fontWeight: 700,
                      }}
                    >
                      {isSell ? 'SELL' : 'BUY'}
                    </span>
                  </td>
                  <td style={{ ...td, fontFamily: theme.mono, fontWeight: 700, color: theme.colors.text }}>{t.symbol}</td>
                  <td style={{ ...td, ...right, color: theme.colors.text }}>
                    {fmtNumber(t.qty, Number.isInteger(t.qty) ? 0 : 4)}
                  </td>
                  <td style={{ ...td, ...right, color: theme.colors.text }}>{fmtMoney(t.price, t.currency)}</td>
                  <td style={{ ...td, ...right, color: theme.colors.textDim }}>
                    {t.fee > 0 ? fmtMoney(t.fee, t.currency) : '—'}
                  </td>
                  <td style={{ ...td, ...right, fontWeight: 700, color: isSell ? colorForChange(t.realized) : theme.colors.textFaint }}>
                    {isSell ? fmtMoney(t.realized, t.currency) : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {undoable.has(t.id) && (
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => undoTransaction(t.id)}
                        title="Undo this trade (restores the position as it was before)"
                        style={{ padding: 4, lineHeight: 0, color: theme.colors.textDim }}
                      >
                        <Undo2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {rows.length > SHOW_COLLAPSED && (
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setShowAll((s) => !s)}
          style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: theme.colors.accent }}
        >
          {showAll ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {showAll ? 'Show recent only' : `Show all ${rows.length} trades`}
        </button>
      )}

      {rows.length > 0 && (
        <div style={{ fontSize: 10.5, color: theme.colors.textFaint }}>
          Records of what you did at your broker — realized P/L uses the average-cost method. Only the latest
          trade per symbol can be undone.
        </div>
      )}
    </div>
  );
}
