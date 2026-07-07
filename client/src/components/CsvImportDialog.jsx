import React, { useMemo, useState } from 'react';
import { X, Upload, FileUp } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { fmtNumber } from '../lib/format.js';
import { parseTradesCsv } from '../lib/csvImport.js';
import { usePortfolioStore } from '../store/portfolioStore.js';

/**
 * Import a broker CSV of trades into the ledger. Accepts a picked file or
 * pasted text; column names are matched flexibly (date / trade date, side /
 * action, symbol / ticker, qty / shares / units, price, fee / commission).
 * Shows a parsed preview + row-level errors BEFORE anything is applied.
 * Trades replay oldest-first through the same average-cost math as the Buy/
 * Sell buttons; unknown symbols become new holdings automatically.
 */
export default function CsvImportDialog({ onClose }) {
  const importTrades = usePortfolioStore((s) => s.importTrades);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState(null); // { applied, skipped } after apply

  const parsed = useMemo(() => (text.trim() ? parseTradesCsv(text) : null), [text]);

  function pickFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ''));
    reader.readAsText(f);
  }

  function apply() {
    if (!parsed || parsed.trades.length === 0) return;
    setResult(importTrades(parsed.trades));
  }

  const td = { padding: '4px 8px', borderTop: `1px solid ${theme.colors.border}`, fontSize: 12, whiteSpace: 'nowrap' };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose && onClose();
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Import trades CSV" style={{ maxWidth: 640, width: '100%', maxHeight: '86vh', overflow: 'auto' }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.space(3) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(1), fontWeight: 700, fontSize: 15, color: theme.colors.text }}>
            <Upload size={16} style={{ color: theme.colors.accent }} />
            Import trades from CSV
          </div>
          <button type="button" className="btn-ghost" onClick={() => onClose && onClose()} aria-label="Close" style={{ padding: theme.space(1), lineHeight: 0 }}>
            <X size={18} />
          </button>
        </div>

        {result ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
            <div style={{ padding: theme.space(3), borderRadius: theme.radius.md, background: theme.colors.bgElev, borderLeft: `3px solid ${result.skipped.length ? theme.colors.warn : theme.colors.up}` }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: theme.colors.text }}>
                ✅ Imported {result.applied} trade{result.applied === 1 ? '' : 's'}
              </div>
              {result.skipped.length > 0 && (
                <div style={{ fontSize: 12, color: theme.colors.warn, marginTop: theme.space(1) }}>
                  Skipped {result.skipped.length}:{' '}
                  {result.skipped.slice(0, 5).map((s, i) => (
                    <div key={i}>· {s}</div>
                  ))}
                  {result.skipped.length > 5 ? `…and ${result.skipped.length - 5} more` : ''}
                </div>
              )}
            </div>
            <button type="button" className="btn btn-primary" onClick={() => onClose && onClose()} style={{ alignSelf: 'flex-end' }}>
              Done
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
            <div style={{ fontSize: 12, color: theme.colors.textDim, lineHeight: 1.6 }}>
              Needs columns for <b>date, side (buy/sell), symbol, quantity, price</b> — fee/commission optional.
              Header names are matched flexibly (e.g. "Trade Date", "Action", "Ticker", "Shares", "Commission").
              Trades apply oldest-first with the same average-cost math as the Buy/Sell buttons.
            </div>

            <label className="btn" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5 }}>
              <FileUp size={14} />
              {fileName || 'Choose CSV file…'}
              <input type="file" accept=".csv,text/csv,text/plain" onChange={pickFile} style={{ display: 'none' }} />
            </label>

            <textarea
              className="input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'…or paste CSV here, e.g.\ndate,side,symbol,qty,price,fee\n2026-01-15,buy,AAPL,10,150.25,1.2'}
              rows={6}
              style={{ width: '100%', resize: 'vertical', fontFamily: theme.mono, fontSize: 12 }}
            />

            {parsed && parsed.errors.length > 0 && (
              <div style={{ fontSize: 12, color: theme.colors.down, maxHeight: 96, overflow: 'auto' }}>
                {parsed.errors.slice(0, 8).map((e, i) => (
                  <div key={i}>⚠ {e}</div>
                ))}
                {parsed.errors.length > 8 ? `…and ${parsed.errors.length - 8} more` : ''}
              </div>
            )}

            {parsed && parsed.trades.length > 0 && (
              <>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: theme.colors.text }}>
                  Preview — {parsed.trades.length} trade{parsed.trades.length === 1 ? '' : 's'} ready
                </div>
                <div style={{ overflowX: 'auto', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.sm, maxHeight: 200, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: theme.colors.bgElev }}>
                        {['Date', 'Side', 'Symbol', 'Qty', 'Price', 'Fee'].map((h, i) => (
                          <th key={i} style={{ padding: '4px 8px', fontSize: 11, color: theme.colors.textDim, textAlign: i >= 3 ? 'right' : 'left' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.trades.map((t, i) => (
                        <tr key={i}>
                          <td style={{ ...td, color: theme.colors.textDim }}>{t.date.slice(0, 10)}</td>
                          <td style={{ ...td, fontWeight: 700, color: t.side === 'sell' ? theme.colors.down : theme.colors.up }}>{t.side.toUpperCase()}</td>
                          <td style={{ ...td, fontFamily: theme.mono, color: theme.colors.text }}>{t.symbol}</td>
                          <td style={{ ...td, textAlign: 'right', fontFamily: theme.mono, color: theme.colors.text }}>{fmtNumber(t.qty, Number.isInteger(t.qty) ? 0 : 4)}</td>
                          <td style={{ ...td, textAlign: 'right', fontFamily: theme.mono, color: theme.colors.text }}>{t.price}</td>
                          <td style={{ ...td, textAlign: 'right', fontFamily: theme.mono, color: theme.colors.textDim }}>{t.fee || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: theme.space(2), justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => onClose && onClose()}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!parsed || parsed.trades.length === 0}
                onClick={apply}
                style={{ opacity: parsed && parsed.trades.length > 0 ? 1 : 0.55 }}
              >
                Import {parsed && parsed.trades.length > 0 ? parsed.trades.length : ''} trade{parsed && parsed.trades.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
