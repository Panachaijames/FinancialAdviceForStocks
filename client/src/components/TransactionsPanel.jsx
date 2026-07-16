import React, { useMemo, useState } from 'react';
import { History, Pencil, Trash2, ChevronDown, ChevronUp, Upload, Download } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { fmtMoney, fmtNumber, classForChange } from '../lib/format.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import { useSettingsStore } from '../store/settingsStore.js';
import useFx from '../hooks/useFx.js';
import { realizedByCurrency, dividendsByCurrency } from '../lib/trades.js';
import { splitLabel } from '../lib/splits.js';
import { tradesToCsv } from '../lib/csvImport.js';
import { downloadTextFile } from '../lib/backup.js';
import { useT } from '../lib/i18n.js';
import CsvImportDialog from './CsvImportDialog.jsx';
import TradeDialog from './TradeDialog.jsx';

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
  const t = useT();
  const transactions = usePortfolioStore((s) => s.transactions);
  const deleteTransaction = usePortfolioStore((s) => s.deleteTransaction);
  const holdings = usePortfolioStore((s) => s.holdings);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const { convert } = useFx();
  const [showAll, setShowAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState(null); // { tx, holding } being edited

  const rows = useMemo(
    () => [...(transactions || [])].sort((a, b) => (a.at < b.at ? 1 : -1)),
    [transactions]
  );

  // Open the editor for a trade, pairing it with its holding (or a minimal
  // holding-like built from the entry, for a symbol no longer held).
  const openEdit = (tx) => {
    const holding =
      holdings.find((h) => h.symbol === tx.symbol) || {
        id: null,
        symbol: tx.symbol,
        type: tx.type || 'other',
        currency: tx.currency || 'USD',
        shares: 0,
        avgCost: 0,
      };
    setEditing({ tx, holding });
  };

  const totalRealized = useMemo(() => {
    const byCur = realizedByCurrency(transactions);
    return Object.entries(byCur).reduce((sum, [cur, v]) => sum + convert(v, cur), 0);
  }, [transactions, convert]);

  const totalDividends = useMemo(() => {
    const byCur = dividendsByCurrency(transactions);
    return Object.entries(byCur).reduce((sum, [cur, v]) => sum + convert(v, cur), 0);
  }, [transactions, convert]);
  // Presence-based (not `!== 0`), so a fully-withheld $0.00-net dividend still
  // shows the chip — matching PortfolioSummary's "Dividends Received" card.
  const hasDividends = useMemo(
    () => (transactions || []).some((t) => t && t.side === 'dividend'),
    [transactions]
  );

  const visible = showAll ? rows : rows.slice(0, SHOW_COLLAPSED);
  const td = { padding: `${theme.space(1)}px ${theme.space(2)}px`, borderTop: `1px solid ${theme.colors.border}`, fontSize: 12.5, whiteSpace: 'nowrap' };
  const right = { textAlign: 'right', fontFamily: theme.mono };

  return (
    <div className="panel" style={{ padding: theme.space(3), display: 'flex', flexDirection: 'column', gap: theme.space(2) }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(2), flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(1), fontWeight: 700, fontSize: 13, color: theme.colors.text }}>
          <History size={15} style={{ color: theme.colors.accent }} />
          {t('activity.title', { count: rows.length })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(3) }}>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setImporting(true)}
            title={t('activity.importCsvTitle')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: theme.colors.accent }}
          >
            <Upload size={14} /> {t('activity.importCsv')}
          </button>
          {rows.length > 0 && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => downloadTextFile('pt-trades.csv', tradesToCsv(transactions), 'text/csv')}
              title={t('activity.exportCsvTitle')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: theme.colors.accent }}
            >
              <Download size={14} /> {t('activity.exportCsv')}
            </button>
          )}
          {hasDividends && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: theme.space(1) }}>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: theme.colors.textDim }}>
                {t('activity.dividends')}
              </span>
              <span
                className="pm-mask"
                style={{ fontSize: 15, fontWeight: 800, fontFamily: theme.mono, color: theme.colors.gold }}
                title={t('activity.dividendsChipTitle')}
              >
                {fmtMoney(totalDividends, displayCurrency)}
              </span>
            </div>
          )}
          {rows.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: theme.space(1) }}>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: theme.colors.textDim }}>
                {t('activity.realizedPl')}
              </span>
              <span
                className="pm-mask"
                style={{ fontSize: 15, fontWeight: 800, fontFamily: theme.mono, color: colorForChange(totalRealized) }}
                title={t('activity.realizedPlChipTitle')}
              >
                {fmtMoney(totalRealized, displayCurrency)}
              </span>
            </div>
          )}
        </div>
      </div>

      {importing && <CsvImportDialog onClose={() => setImporting(false)} />}
      {editing && (
        <TradeDialog
          holding={editing.holding}
          side={editing.tx.side}
          editTx={editing.tx}
          onClose={() => setEditing(null)}
        />
      )}

      {rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: theme.colors.textDim }}>
          {t('activity.emptyBefore')}<b>{t('activity.emptyBuySell')}</b>{t('activity.emptyMiddle')}
          <b>{t('activity.emptyDividendIncome')}</b>{t('activity.emptyAfter')}
        </div>
      ) : (
      <div style={{ overflowX: 'auto', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.sm }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: theme.colors.bgElev }}>
              {[t('activity.colDate'), t('activity.colSide'), t('activity.colSymbol'), t('activity.colQty'), t('activity.colPrice'), t('activity.colFee'), t('activity.colRealizedPl'), ''].map((h, i) => (
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
            {visible.map((tx) => {
              const isSell = tx.side === 'sell';
              const isDividend = tx.side === 'dividend';
              const isSplit = tx.side === 'split';
              const badge = isDividend
                ? { bg: theme.colors.gold, fg: theme.colors.gold, text: 'DIV' }
                : isSell
                ? { bg: theme.colors.down, fg: theme.colors.down, text: 'SELL' }
                : isSplit
                ? { bg: theme.colors.accent, fg: theme.colors.accent, text: 'SPLIT' }
                : { bg: theme.colors.up, fg: theme.colors.up, text: 'BUY' };
              const net = isDividend ? Number(tx.amount || 0) - Number(tx.wht || 0) : 0;
              return (
                <tr key={tx.id}>
                  <td style={{ ...td, color: theme.colors.textDim }}>{String(tx.at).slice(0, 10)}</td>
                  <td style={td}>
                    <span
                      className="badge"
                      style={{ background: badge.bg + '22', color: badge.fg, fontWeight: 700 }}
                    >
                      {badge.text}
                    </span>
                  </td>
                  <td style={{ ...td, fontFamily: theme.mono, fontWeight: 700, color: theme.colors.text }}>{tx.symbol}</td>
                  {isDividend ? (
                    <>
                      {/* Qty / per-share Price don't apply to a cash dividend. */}
                      <td style={{ ...td, ...right, color: theme.colors.textFaint }}>—</td>
                      <td style={{ ...td, ...right, color: theme.colors.textFaint }}>—</td>
                      <td
                        className="pm-mask"
                        style={{ ...td, ...right, color: theme.colors.textDim }}
                        title={t('activity.whtTitle')}
                      >
                        {Number(tx.wht) > 0 ? fmtMoney(tx.wht, tx.currency) : '—'}
                      </td>
                      <td
                        className="pm-mask"
                        style={{ ...td, ...right, fontWeight: 700, color: theme.colors.gold }}
                        title={
                          Number(tx.wht) > 0
                            ? t('activity.dividendCellTitleNet', {
                                gross: fmtMoney(tx.amount, tx.currency),
                                wht: fmtMoney(tx.wht, tx.currency),
                              })
                            : t('activity.dividendCellTitleGross', {
                                gross: fmtMoney(tx.amount, tx.currency),
                              })
                        }
                      >
                        {fmtMoney(net, tx.currency)}
                      </td>
                    </>
                  ) : isSplit ? (
                    <td colSpan={4} style={{ ...td, color: theme.colors.textDim }}>
                      {splitLabel(tx)}
                    </td>
                  ) : (
                    <>
                      <td style={{ ...td, ...right, color: theme.colors.text }}>
                        {fmtNumber(tx.qty, Number.isInteger(tx.qty) ? 0 : 4)}
                      </td>
                      <td className="pm-mask" style={{ ...td, ...right, color: theme.colors.text }}>{fmtMoney(tx.price, tx.currency)}</td>
                      <td className="pm-mask" style={{ ...td, ...right, color: theme.colors.textDim }}>
                        {tx.fee > 0 ? fmtMoney(tx.fee, tx.currency) : '—'}
                      </td>
                      <td className="pm-mask" style={{ ...td, ...right, fontWeight: 700, color: isSell ? colorForChange(tx.realized) : theme.colors.textFaint }}>
                        {isSell ? fmtMoney(tx.realized, tx.currency) : '—'}
                      </td>
                    </>
                  )}
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {!isDividend && !isSplit && (
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => openEdit(tx)}
                        title={t('activity.editTradeTitle')}
                        aria-label={t('activity.editAria', { side: tx.side, symbol: tx.symbol })}
                        style={{ padding: 4, lineHeight: 0, color: theme.colors.textDim }}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => deleteTransaction(tx.id)}
                      title={isDividend ? t('activity.deleteDividendTitle') : t('activity.deleteTradeTitle')}
                      aria-label={t('activity.deleteAria', { side: tx.side, symbol: tx.symbol })}
                      style={{ padding: 4, lineHeight: 0, color: theme.colors.down }}
                    >
                      <Trash2 size={14} />
                    </button>
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
          {showAll ? t('activity.showRecent') : t('activity.showAll', { count: rows.length })}
        </button>
      )}

      {rows.length > 0 && (
        <div style={{ fontSize: 10.5, color: theme.colors.textFaint }}>
          {t('activity.footnote')}
        </div>
      )}
    </div>
  );
}
