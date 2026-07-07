import React, { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { fmtMoney } from '../../lib/format.js';
import { usePortfolioStore } from '../../store/portfolioStore.js';
import { useSettingsStore } from '../../store/settingsStore.js';
import useFx from '../../hooks/useFx.js';
import { buildTaxReport, sellYears, DIVIDEND_NOTES } from '../../lib/taxReport.js';
import { PanelHeader } from './SavingsPanel.jsx';

const BADGE = {
  no: { text: 'ยกเว้นภาษี', color: theme.colors.up },
  conditional: { text: 'มีเงื่อนไข', color: theme.colors.warn },
  yes: { text: 'เสียภาษี', color: theme.colors.down },
};

/**
 * Yearly investment-tax report built from the trade ledger: realized P/L per
 * asset class with the Thai tax treatment of each class (linked to the same
 * legal sources as the tax calculator). Amounts are converted to the display
 * currency at today's FX — an estimate for planning, not a filing document.
 */
export default function TaxReportPanel() {
  const transactions = usePortfolioStore((s) => s.transactions);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const { convert } = useFx();

  const years = useMemo(() => sellYears(transactions), [transactions]);
  const [year, setYear] = useState(null);
  const activeYear = year != null && years.includes(year) ? year : years[0];

  const report = useMemo(
    () => (activeYear != null ? buildTaxReport(transactions, activeYear) : null),
    [transactions, activeYear]
  );

  const toDisplay = (byCurrency) =>
    Object.entries(byCurrency || {}).reduce((s, [cur, v]) => s + convert(v, cur), 0);

  const totalRealized = report ? report.groups.reduce((s, g) => s + toDisplay(g.byCurrency), 0) : 0;

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
      <PanelHeader icon={<FileText size={16} />} title="รายงานภาษีการลงทุน (จากรายการซื้อขาย)" />

      {years.length === 0 ? (
        <div style={{ fontSize: 13, color: theme.colors.textDim, lineHeight: 1.6 }}>
          ยังไม่มีรายการขาย — กดปุ่ม <b>Sell</b> บนการ์ดสินทรัพย์ (แท็บ Portfolio) เพื่อบันทึกการขายที่ทำกับโบรกเกอร์
          แล้วระบบจะสรุปกำไร/ขาดทุนที่เกิดขึ้นจริงของแต่ละปี พร้อมสถานะภาษีไทยของสินทรัพย์แต่ละประเภทให้ที่นี่
        </div>
      ) : (
        <>
          {/* Year selector */}
          <div style={{ display: 'flex', gap: theme.space(1), flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: theme.colors.textDim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              ปี:
            </span>
            {years.map((y) => (
              <button
                key={y}
                type="button"
                className="chip"
                onClick={() => setYear(y)}
                style={{
                  fontWeight: 700,
                  color: y === activeYear ? '#fff' : theme.colors.textDim,
                  background: y === activeYear ? theme.colors.accent : undefined,
                }}
              >
                {y} ({y + 543})
              </button>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: 13, color: theme.colors.textDim }}>
              รวมกำไรที่ขายแล้ว:{' '}
              <b style={{ fontFamily: theme.mono, color: totalRealized >= 0 ? theme.colors.up : theme.colors.down }}>
                {fmtMoney(totalRealized, displayCurrency)}
              </b>
            </span>
          </div>

          {/* Per-class table */}
          <div style={{ overflowX: 'auto', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.sm }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: theme.colors.bgElev }}>
                  {['ประเภทสินทรัพย์', 'ขาย (ครั้ง)', 'กำไร/ขาดทุนที่ขายแล้ว', 'สถานะภาษีไทย', 'หมายเหตุ / กฎหมาย'].map((h, i) => (
                    <th key={i} style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, fontSize: 11, color: theme.colors.textDim, fontWeight: 600, textAlign: i === 1 || i === 2 ? 'right' : 'left', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.groups.map((g) => {
                  const badge = BADGE[g.treatment.taxable] || BADGE.conditional;
                  const realized = toDisplay(g.byCurrency);
                  return (
                    <tr key={g.type}>
                      <td style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, borderTop: `1px solid ${theme.colors.border}`, fontSize: 12.5, fontWeight: 700, color: theme.colors.text, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                        {g.treatment.label}
                      </td>
                      <td style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, borderTop: `1px solid ${theme.colors.border}`, fontSize: 12.5, textAlign: 'right', fontFamily: theme.mono, color: theme.colors.textDim, verticalAlign: 'top' }}>
                        {g.sellCount}
                      </td>
                      <td style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, borderTop: `1px solid ${theme.colors.border}`, fontSize: 12.5, textAlign: 'right', fontFamily: theme.mono, fontWeight: 700, color: realized >= 0 ? theme.colors.up : theme.colors.down, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                        {fmtMoney(realized, displayCurrency)}
                      </td>
                      <td style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, borderTop: `1px solid ${theme.colors.border}`, verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        <span className="badge" style={{ background: badge.color + '22', color: badge.color, fontWeight: 700 }}>
                          {badge.text}
                        </span>
                      </td>
                      <td style={{ padding: `${theme.space(1)}px ${theme.space(2)}px`, borderTop: `1px solid ${theme.colors.border}`, fontSize: 11.5, color: theme.colors.textDim, lineHeight: 1.5, minWidth: 260, verticalAlign: 'top' }}>
                        {g.treatment.note}{' '}
                        <a href={g.treatment.url} target="_blank" rel="noopener noreferrer" style={{ color: theme.colors.accent, textDecoration: 'none', borderBottom: `1px dotted ${theme.colors.accent}` }}>
                          {g.treatment.law}
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Dividend withholding notes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {DIVIDEND_NOTES.map((n, i) => (
              <div key={i} style={{ fontSize: 11.5, color: theme.colors.textDim, lineHeight: 1.5 }}>
                💰 <b>{n.label}:</b> {n.note} <span style={{ color: theme.colors.textFaint }}>({n.law})</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ fontSize: 10.5, color: theme.colors.textFaint, lineHeight: 1.5 }}>
        * สรุปจากรายการขายที่บันทึกไว้ (วิธีต้นทุนเฉลี่ย) แปลงเป็นสกุลแสดงผลด้วยอัตราปัจจุบัน — เป็นข้อมูลประกอบการวางแผน
        ไม่ใช่เอกสารยื่นภาษีและไม่ใช่คำแนะนำทางภาษี โปรดตรวจสอบกับกรมสรรพากร
      </div>
    </div>
  );
}
