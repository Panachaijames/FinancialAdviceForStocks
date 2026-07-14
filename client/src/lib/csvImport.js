// Broker CSV import — tolerant parser for trade-history exports.
//
// Brokers name columns differently, so the header row is mapped with synonym
// lists (case-insensitive). Required: date, side, symbol, quantity, price.
// Optional: fee/commission. Rows that fail validation are reported with their
// line number instead of silently dropped.

/** RFC-4180-ish CSV split (handles quoted fields with commas and "" escapes). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

const HEADER_SYNONYMS = {
  date: ['date', 'trade date', 'tradedate', 'datetime', 'time', 'transaction date', 'วันที่'],
  side: ['side', 'type', 'action', 'buy/sell', 'b/s', 'transaction type', 'order type', 'ประเภท'],
  symbol: ['symbol', 'ticker', 'stock', 'asset', 'instrument', 'security', 'หุ้น', 'สัญลักษณ์'],
  qty: ['qty', 'quantity', 'shares', 'units', 'volume', 'จำนวน', 'จำนวนหุ้น'],
  price: ['price', 'unit price', 'price/share', 'avg price', 'average price', 'ราคา'],
  fee: ['fee', 'fees', 'commission', 'comm', 'commission+vat', 'ค่าธรรมเนียม'],
};

function mapHeader(headerRow) {
  const idx = {};
  const cells = headerRow.map((h) => String(h || '').trim().toLowerCase());
  for (const [field, names] of Object.entries(HEADER_SYNONYMS)) {
    const i = cells.findIndex((c) => names.includes(c));
    if (i >= 0) idx[field] = i;
  }
  return idx;
}

function normalizeSide(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (['buy', 'b', 'bought', 'purchase', 'long', 'ซื้อ'].includes(s)) return 'buy';
  if (['sell', 's', 'sold', 'sale', 'ขาย'].includes(s)) return 'sell';
  return null;
}

const cleanNum = (raw) => Number(String(raw ?? '').replace(/[,\s]/g, ''));

/**
 * Parse a broker CSV of trades.
 * @param {string} text
 * @returns {{ trades: {date:string, side:'buy'|'sell', symbol:string, qty:number, price:number, fee:number}[],
 *             errors: string[], mapped: Record<string, number> }}
 *   trades come back sorted oldest-first (the order they must be applied in).
 */
export function parseTradesCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { trades: [], errors: ['Need a header row plus at least one data row.'], mapped: {} };
  }
  const mapped = mapHeader(rows[0]);
  const missing = ['date', 'side', 'symbol', 'qty', 'price'].filter((f) => mapped[f] == null);
  if (missing.length) {
    return {
      trades: [],
      errors: [`Missing column(s): ${missing.join(', ')}. Found headers: ${rows[0].join(', ')}`],
      mapped,
    };
  }

  const trades = [];
  const errors = [];
  for (let r = 1; r < rows.length; r += 1) {
    const line = r + 1; // human line number incl. header
    const cells = rows[r];
    if (cells.every((c) => String(c || '').trim() === '')) continue;

    const side = normalizeSide(cells[mapped.side]);
    const symbol = String(cells[mapped.symbol] || '').trim().toUpperCase();
    const qty = cleanNum(cells[mapped.qty]);
    const price = cleanNum(cells[mapped.price]);
    const fee = mapped.fee != null ? cleanNum(cells[mapped.fee]) || 0 : 0;
    const dateMs = Date.parse(String(cells[mapped.date] || '').trim());

    if (!side) {
      errors.push(`Line ${line}: unrecognized side "${cells[mapped.side]}"`);
      continue;
    }
    if (!symbol) {
      errors.push(`Line ${line}: missing symbol`);
      continue;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(`Line ${line}: bad quantity "${cells[mapped.qty]}"`);
      continue;
    }
    if (!Number.isFinite(price) || price <= 0) {
      errors.push(`Line ${line}: bad price "${cells[mapped.price]}"`);
      continue;
    }
    if (!Number.isFinite(dateMs)) {
      errors.push(`Line ${line}: unparseable date "${cells[mapped.date]}"`);
      continue;
    }
    if (fee < 0) {
      errors.push(`Line ${line}: negative fee`);
      continue;
    }
    trades.push({ date: new Date(dateMs).toISOString(), side, symbol, qty, price, fee });
  }
  // Oldest first — average-cost math must replay in order.
  trades.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { trades, errors, mapped };
}

/** Escape one CSV field — quote it if it contains a comma, quote, or newline. */
function csvField(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const EXPORT_HEADERS = ['date', 'side', 'symbol', 'qty', 'price', 'fee'];

/**
 * Serialize recorded transactions to a broker-style CSV that parseTradesCsv can
 * re-import — round-trips date/side/symbol/qty/price/fee, oldest first. This is
 * the inverse of parseTradesCsv (the pair is covered by a round-trip test).
 * @param {{at?:string, date?:string, side:string, symbol:string, qty:number, price:number, fee?:number}[]} transactions
 * @returns {string}
 */
export function tradesToCsv(transactions) {
  const rows = (Array.isArray(transactions) ? transactions : [])
    .filter((t) => t && t.symbol && (t.side === 'buy' || t.side === 'sell'))
    .slice()
    .sort((a, b) => (String(a.at || a.date) < String(b.at || b.date) ? -1 : 1));
  const lines = [EXPORT_HEADERS.join(',')];
  for (const t of rows) {
    lines.push(
      [
        csvField(t.at || t.date || ''),
        csvField(t.side),
        csvField(t.symbol),
        csvField(Number(t.qty) || 0),
        csvField(Number(t.price) || 0),
        csvField(Number(t.fee) || 0),
      ].join(',')
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export default { parseCsv, parseTradesCsv, tradesToCsv };
