import React, { useEffect, useMemo, useState } from 'react';
import theme from '../lib/theme.js';
import { getDividend } from '../api/client.js';
import { usePortfolioStore } from '../store/portfolioStore.js';
import { useSettingsStore } from '../store/settingsStore.js';
import useFx from '../hooks/useFx.js';
import useQuotes from '../hooks/useQuotes.js';
import { assetMeta } from '../lib/assetType.js';
import { computeDividendIncome } from '../lib/dividends.js';
import { dividendsByCurrency, dividendsBySymbol } from '../lib/trades.js';
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
  const transactions = usePortfolioStore((s) => s.transactions);
  const recordDividend = usePortfolioStore((s) => s.recordDividend);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const { convert } = useFx();

  const [period, setPeriod] = useState('annual');
  const [divs, setDivs] = useState({}); // symbol -> Dividend | null
  const [loading, setLoading] = useState(false);
  const [logging, setLogging] = useState(false); // dividend-logging form open?

  // Net dividends actually RECEIVED (from the ledger), per symbol and in total.
  const receivedBySym = useMemo(() => dividendsBySymbol(transactions), [transactions]);
  const receivedTotal = useMemo(() => {
    const byCur = dividendsByCurrency(transactions);
    return Object.entries(byCur).reduce((s, [c, v]) => s + convert(v, c), 0);
  }, [transactions, convert]);

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

        {/* Log a received dividend into the ledger */}
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setLogging((v) => !v)}
          disabled={payerHoldings.length === 0}
          aria-expanded={logging}
          title="Record a dividend you actually received"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 12,
            fontWeight: 600,
            color: payerHoldings.length === 0 ? theme.colors.textFaint : theme.colors.accent,
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>＋</span> Log dividend
        </button>

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

      {/* Log-a-dividend form */}
      {logging && payerHoldings.length > 0 && (
        <LogDividendForm
          holdings={payerHoldings}
          onCancel={() => setLogging(false)}
          onSave={({ holdingId, amount, wht, at }) => {
            const tx = recordDividend(holdingId, { amount, wht, at });
            if (tx) setLogging(false);
            return !!tx;
          }}
        />
      )}

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
                    received={receivedBySym[r.holding.symbol]}
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
            {receivedTotal > 0 && (
              <>
                {' '}Received to date (logged, net of withholding):{' '}
                <b style={{ color: theme.colors.up }}>{fmtMoney(receivedTotal, displayCurrency)}</b>.
              </>
            )}
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

function Row({ row, period, displayCurrency, received }) {
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
        <div>{fmtMoney(income[period] || 0, displayCurrency)}</div>
        {received && received.net > 0 && (
          <div
            style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textFaint }}
            title="Dividends you've logged as received for this holding (net of withholding)"
          >
            logged {fmtMoney(received.net, received.currency)}
          </div>
        )}
      </Td>
    </tr>
  );
}

/**
 * Compact form to record a dividend actually received for one holding. Amounts
 * are in the selected holding's native currency; withholding is optional.
 */
function LogDividendForm({ holdings, onCancel, onSave }) {
  const [holdingId, setHoldingId] = useState(holdings[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [wht, setWht] = useState('');
  const [at, setAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState('');

  const selected = holdings.find((h) => h.id === holdingId) || holdings[0];
  const currency = selected?.currency || 'USD';

  const inputStyle = {
    background: theme.colors.bg,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radius.sm,
    color: theme.colors.text,
    padding: `${theme.space(1)}px ${theme.space(2)}px`,
    fontSize: 13,
    fontFamily: theme.mono,
    width: '100%',
  };
  const labelStyle = {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: theme.colors.textDim,
    fontWeight: 600,
    marginBottom: 3,
    display: 'block',
  };

  function submit(e) {
    e.preventDefault();
    const amt = Number(amount);
    const tax = wht === '' ? 0 : Number(wht);
    if (!holdingId) return setError('Pick a holding.');
    if (!Number.isFinite(amt) || amt <= 0) return setError('Enter a dividend amount greater than 0.');
    if (!Number.isFinite(tax) || tax < 0) return setError('Withholding tax cannot be negative.');
    if (tax > amt) return setError('Withholding tax cannot exceed the dividend amount.');
    // Store an ISO instant at local noon so the calendar day is stable across time zones.
    const iso = `${at}T12:00:00.000Z`;
    const ok = onSave({ holdingId, amount: amt, wht: tax, at: iso });
    if (!ok) setError('Could not record that dividend.');
  }

  return (
    <form
      onSubmit={submit}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        gap: theme.space(2),
        padding: theme.space(3),
        marginBottom: theme.space(3),
        background: theme.colors.bgElev,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radius.md,
      }}
    >
      <label style={{ flex: '2 1 160px' }}>
        <span style={labelStyle}>Holding</span>
        <select
          value={holdingId}
          onChange={(e) => setHoldingId(e.target.value)}
          style={{ ...inputStyle, fontFamily: theme.font }}
        >
          {holdings.map((h) => (
            <option key={h.id} value={h.id}>
              {h.symbol} — {h.name}
            </option>
          ))}
        </select>
      </label>
      <label style={{ flex: '1 1 100px' }}>
        <span style={labelStyle}>Amount ({currency})</span>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          style={inputStyle}
          autoFocus
        />
      </label>
      <label style={{ flex: '1 1 100px' }}>
        <span style={labelStyle}>Withholding ({currency})</span>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={wht}
          onChange={(e) => setWht(e.target.value)}
          placeholder="0.00"
          style={inputStyle}
        />
      </label>
      <label style={{ flex: '1 1 130px' }}>
        <span style={labelStyle}>Date</span>
        <input
          type="date"
          value={at}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setAt(e.target.value)}
          style={inputStyle}
        />
      </label>
      <div style={{ display: 'flex', gap: theme.space(1) }}>
        <button
          type="submit"
          className="btn"
          style={{
            background: theme.colors.accent,
            color: '#fff',
            border: 'none',
            borderRadius: theme.radius.sm,
            padding: `${theme.space(2)}px ${theme.space(3)}px`,
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Save
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={onCancel}
          style={{
            color: theme.colors.textDim,
            padding: `${theme.space(2)}px ${theme.space(2)}px`,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <div style={{ flexBasis: '100%', color: theme.colors.down, fontSize: 12 }}>{error}</div>
      )}
    </form>
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
