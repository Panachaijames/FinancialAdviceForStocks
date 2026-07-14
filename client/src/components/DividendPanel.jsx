import React, { useEffect, useMemo, useState } from 'react';
import theme from '../lib/theme.js';
import { getDividend } from '../api/client.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import { useSettingsStore } from '../store/settingsStore.js';
import useFx from '../hooks/useFx.js';
import useQuotes from '../hooks/useQuotes.js';
import { assetMeta } from '../lib/assetType.js';
import { computeDividendIncome } from '../lib/dividends.js';
import { fmtMoney, fmtNumber, fmtPct } from '../lib/format.js';

// Asset types that can pay dividends. Crypto & gold are excluded by design.
const DIVIDEND_TYPES = new Set(['us_stock', 'etf', 'th_stock']);

// Segmented period views and how they map onto the income fields.
const PERIODS = [
  { id: 'weekly', label: 'Week' },
  { id: 'monthly', label: 'Month' },
  { id: 'quarterly', label: 'Quarter' },
  { id: 'annual', label: 'Year' },
];

// Module-level cache so re-mounts / period switches don't refetch dividends.
const dividendCache = new Map(); // symbol -> Dividend | null

/**
 * DividendPanel
 * Lists dividend-paying holdings, computes income via computeDividendIncome with
 * live FX conversion, and lets the user switch the displayed period
 * (Week | Month | Quarter | Year). Footer shows the TOTAL income for the
 * selected period in the active display currency.
 */
export default function DividendPanel() {
  const holdings = usePortfolioStore((s) => s.holdings);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const { convert } = useFx();

  const [period, setPeriod] = useState('annual');
  const [divs, setDivs] = useState({}); // symbol -> Dividend | null
  const [loading, setLoading] = useState(false);

  // Only consider dividend-capable holdings.
  const payerHoldings = useMemo(
    () => holdings.filter((h) => DIVIDEND_TYPES.has(h.type)),
    [holdings],
  );

  // Distinct symbols among dividend-capable holdings.
  const symbols = useMemo(
    () => Array.from(new Set(payerHoldings.map((h) => h.symbol))),
    [payerHoldings],
  );
  const symbolsKey = symbols.slice().sort().join(',');

  // Live prices for yield-on-current-price (best effort; falls back to dividend.yieldPct).
  const { quotes } = useQuotes(symbols);

  // Fetch dividend data for each payer symbol (cached at module level).
  useEffect(() => {
    const list = symbolsKey ? symbolsKey.split(',') : [];
    if (list.length === 0) {
      setDivs({});
      setLoading(false);
      return undefined;
    }

    let active = true;
    const missing = list.filter((s) => !dividendCache.has(s));

    // Seed state from anything already cached.
    const seed = {};
    for (const s of list) {
      if (dividendCache.has(s)) seed[s] = dividendCache.get(s);
    }
    setDivs(seed);

    if (missing.length === 0) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    Promise.all(
      missing.map((sym) =>
        getDividend(sym)
          .then((d) => {
            dividendCache.set(sym, d || null);
            return [sym, d || null];
          })
          .catch(() => {
            dividendCache.set(sym, null);
            return [sym, null];
          }),
      ),
    )
      .then((pairs) => {
        if (!active) return;
        setDivs((prev) => {
          const next = { ...prev };
          for (const [sym, d] of pairs) next[sym] = d;
          return next;
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [symbolsKey]);

  // Build one row per dividend-capable holding, computing income figures.
  const rows = useMemo(() => {
    const out = [];
    for (const h of payerHoldings) {
      const dividend = divs[h.symbol];
      if (dividend === undefined) {
        // Still loading this symbol.
        out.push({ holding: h, pending: true });
        continue;
      }
      const quote = quotes[h.symbol];
      const price = quote && Number(quote.price) > 0 ? quote.price : null;
      const income = computeDividendIncome({
        shares: h.shares,
        dividend,
        price,
        fxConvert: (amountNative, fromCurrency) => convert(amountNative, fromCurrency),
      });
      const isPayer = income.perShareAnnual !== null && income.perShareAnnual > 0;
      out.push({ holding: h, dividend, income, isPayer, pending: false });
    }
    // Payers first, then by selected-period income desc.
    return out.sort((a, b) => {
      if (a.pending !== b.pending) return a.pending ? 1 : -1;
      if (a.isPayer !== b.isPayer) return a.isPayer ? -1 : 1;
      const av = a.income ? a.income[period] || 0 : 0;
      const bv = b.income ? b.income[period] || 0 : 0;
      return bv - av;
    });
  }, [payerHoldings, divs, quotes, convert, period]);

  const payerRows = rows.filter((r) => r.isPayer);
  const totalForPeriod = payerRows.reduce(
    (acc, r) => acc + (r.income ? r.income[period] || 0 : 0),
    0,
  );
  const totalAnnual = payerRows.reduce(
    (acc, r) => acc + (r.income ? r.income.annual || 0 : 0),
    0,
  );

  const periodLabel = PERIODS.find((p) => p.id === period)?.label || 'Year';

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.space(2),
          marginBottom: theme.space(3),
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 18 }}>💸</span>
        <div style={{ fontSize: 15, fontWeight: 700, color: theme.colors.text }}>
          Dividend Income
        </div>
        {loading ? (
          <span style={{ fontSize: 11, color: theme.colors.textFaint }}>updating…</span>
        ) : null}

        <div style={{ flex: 1 }} />

        {/* Period selector */}
        <div className="segmented" role="group" aria-label="Income period">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`segmented-item${p.id === period ? ' active' : ''}`}
              data-active={p.id === period ? 'true' : undefined}
              aria-pressed={p.id === period}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      {payerHoldings.length === 0 ? (
        <EmptyState
          title="No dividend-paying assets"
          body="Add US stocks, ETFs, or Thai stocks to your portfolio to project dividend income. Crypto and gold do not pay dividends."
        />
      ) : !loading && payerRows.length === 0 ? (
        <EmptyState
          title="No dividends found"
          body="None of your eligible holdings currently report a dividend. They may not pay one, or data is unavailable."
        />
      ) : (
        <>
          <div className="scroll-area" style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 13,
                whiteSpace: 'nowrap',
              }}
            >
              <thead>
                <tr style={{ color: theme.colors.textFaint, textAlign: 'right' }}>
                  <Th style={{ textAlign: 'left' }}>Asset</Th>
                  <Th>Shares</Th>
                  <Th>Yield</Th>
                  <Th>Per Share / yr</Th>
                  <Th>{periodLabel} Income</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Row
                    key={r.holding.id}
                    row={r}
                    period={period}
                    displayCurrency={displayCurrency}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr
                  style={{
                    borderTop: `2px solid ${theme.colors.border}`,
                    color: theme.colors.text,
                    fontWeight: 700,
                  }}
                >
                  <td style={{ padding: `${theme.space(2)}px ${theme.space(2)}px`, textAlign: 'left' }}>
                    Total
                  </td>
                  <td />
                  <td />
                  <td
                    style={{
                      padding: `${theme.space(2)}px ${theme.space(2)}px`,
                      textAlign: 'right',
                      color: theme.colors.textFaint,
                      fontWeight: 500,
                      fontSize: 11,
                    }}
                  >
                    {fmtMoney(totalAnnual, displayCurrency)}/yr
                  </td>
                  <td
                    style={{
                      padding: `${theme.space(2)}px ${theme.space(2)}px`,
                      textAlign: 'right',
                      fontFamily: theme.mono,
                      color: theme.colors.up,
                    }}
                  >
                    {fmtMoney(totalForPeriod, displayCurrency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div
            style={{
              marginTop: theme.space(2),
              fontSize: 11,
              color: theme.colors.textFaint,
            }}
          >
            Projected {periodLabel.toLowerCase()} income across {payerRows.length}{' '}
            dividend-paying {payerRows.length === 1 ? 'holding' : 'holdings'}, shown in{' '}
            {displayCurrency}.
          </div>
        </>
      )}
    </div>
  );
}

function Th({ children, style }) {
  return (
    <th
      style={{
        padding: `${theme.space(1)}px ${theme.space(2)}px`,
        fontWeight: 600,
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        borderBottom: `1px solid ${theme.colors.border}`,
        textAlign: 'right',
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, style }) {
  return (
    <td
      style={{
        padding: `${theme.space(2)}px ${theme.space(2)}px`,
        textAlign: 'right',
        verticalAlign: 'middle',
        ...style,
      }}
    >
      {children}
    </td>
  );
}

function Row({ row, period, displayCurrency }) {
  const { holding, income, isPayer, pending } = row;
  const meta = assetMeta(holding.type);

  const assetCell = (
    <Td style={{ textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(2), minWidth: 0 }}>
        <span style={{ fontSize: 14, flex: '0 0 auto' }}>{meta.emoji}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: theme.colors.text }}>{holding.symbol}</div>
          <div
            style={{
              fontSize: 11,
              color: theme.colors.textDim,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 160,
            }}
            title={holding.name}
          >
            {holding.name}
          </div>
        </div>
      </div>
    </Td>
  );

  if (pending) {
    return (
      <tr style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
        {assetCell}
        <Td colSpan={4}>
          <div
            className="skeleton"
            style={{ height: 14, width: 120, marginLeft: 'auto', borderRadius: theme.radius.sm }}
          />
        </Td>
      </tr>
    );
  }

  if (!isPayer) {
    return (
      <tr style={{ borderBottom: `1px solid ${theme.colors.border}`, color: theme.colors.textFaint }}>
        {assetCell}
        <Td style={{ color: theme.colors.textDim, fontFamily: theme.mono }}>
          {fmtNumber(holding.shares, holding.shares % 1 === 0 ? 0 : 4)}
        </Td>
        <Td colSpan={3} style={{ fontStyle: 'italic', fontSize: 12 }}>
          No dividend
        </Td>
      </tr>
    );
  }

  return (
    <tr style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
      {assetCell}
      <Td style={{ color: theme.colors.textDim, fontFamily: theme.mono }}>
        {fmtNumber(holding.shares, holding.shares % 1 === 0 ? 0 : 4)}
      </Td>
      <Td style={{ color: theme.colors.gold, fontFamily: theme.mono }}>
        {income.yieldOnCostPct != null ? fmtPct(income.yieldOnCostPct) : '—'}
      </Td>
      <Td style={{ color: theme.colors.textDim, fontFamily: theme.mono }}>
        {income.perShareAnnual != null
          ? fmtMoney(income.perShareAnnual, income.currency)
          : '—'}
      </Td>
      <Td style={{ color: theme.colors.up, fontFamily: theme.mono, fontWeight: 600 }}>
        {fmtMoney(income[period] || 0, displayCurrency)}
      </Td>
    </tr>
  );
}

function EmptyState({ title, body }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: `${theme.space(8)}px ${theme.space(4)}px`,
        color: theme.colors.textDim,
        gap: theme.space(2),
      }}
    >
      <span style={{ fontSize: 28, opacity: 0.6 }}>💤</span>
      <div style={{ fontSize: 14, fontWeight: 600, color: theme.colors.text }}>{title}</div>
      <div style={{ fontSize: 12, maxWidth: 360, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}
