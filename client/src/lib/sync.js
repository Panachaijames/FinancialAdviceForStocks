// One-time cross-device data transfer. The sender uploads a snapshot of the
// persisted stores (holdings, savings, funds, retirement plan) under a private
// code; the receiver downloads it, replaces its local data, then deletes the
// cloud entry. No ongoing link and nothing left in the cloud — each device
// keeps its own copy.
import { usePortfolioStore } from '../store/portfolioStore.js';
import { useSavingsStore } from '../store/savingsStore.js';
import { useFundsStore } from '../store/fundsStore.js';
import { usePlanStore, PLAN_DEFAULTS } from '../store/planStore.js';
import { getSyncBlob, putSyncBlob, deleteSyncBlob } from '../api/client.js';

// Unambiguous charset (no 0/O/1/I/L) for a human-copyable code.
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Generate a private transfer code like "PT-7Q2M-K9F4". */
export function generateCode() {
  const buf = new Uint8Array(8);
  try {
    (window.crypto || window.msCrypto).getRandomValues(buf);
  } catch {
    for (let i = 0; i < 8; i += 1) buf[i] = Math.floor(Math.random() * 256);
  }
  let s = '';
  for (let i = 0; i < 8; i += 1) s += CHARS[buf[i] % CHARS.length];
  return `PT-${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

/** Current local data across the transferred stores. */
export function snapshot() {
  // Only the plan's data fields — the store also holds setter functions.
  const planState = usePlanStore.getState();
  const plan = {};
  for (const key of Object.keys(PLAN_DEFAULTS)) plan[key] = planState[key];
  return {
    holdings: usePortfolioStore.getState().holdings || [],
    transactions: usePortfolioStore.getState().transactions || [],
    savings: useSavingsStore.getState().savings || [],
    funds: useFundsStore.getState().funds || [],
    plan,
  };
}

/** Replace local store data with a received snapshot. */
export function applySnapshot(data) {
  if (!data || typeof data !== 'object') return;
  if (Array.isArray(data.holdings)) usePortfolioStore.setState({ holdings: data.holdings });
  // Older snapshots have no trade ledger — keep the local one then.
  if (Array.isArray(data.transactions)) usePortfolioStore.setState({ transactions: data.transactions });
  if (Array.isArray(data.savings)) useSavingsStore.setState({ savings: data.savings });
  if (Array.isArray(data.funds)) useFundsStore.setState({ funds: data.funds });
  // Older snapshots have no plan — leave the local plan untouched then.
  if (data.plan && typeof data.plan === 'object') {
    const clean = {};
    for (const key of Object.keys(PLAN_DEFAULTS)) {
      if (key in data.plan) clean[key] = data.plan[key];
    }
    usePlanStore.setState(clean);
  }
}

/** Count items in a snapshot, for a friendly confirmation message. */
export function counts(data) {
  return {
    holdings: (data && data.holdings ? data.holdings.length : 0),
    savings: (data && data.savings ? data.savings.length : 0),
    funds: (data && data.funds ? data.funds.length : 0),
  };
}

/**
 * Send: upload this device's data under a fresh code. Returns the code to show.
 */
export async function sendTransfer() {
  const code = generateCode();
  await putSyncBlob(code, snapshot(), Date.now());
  return code;
}

/**
 * Receive: download the blob for `code`, replace local data, then delete the
 * cloud copy so nothing lingers. Returns { counts } or throws.
 */
export async function receiveTransfer(code) {
  const c = (code || '').trim().toUpperCase();
  if (!c) throw new Error('Enter a transfer code');
  const remote = await getSyncBlob(c);
  if (!remote || !remote.data) {
    const err = new Error('No data found for that code (it may have expired or already been received).');
    err.code = 'not_found';
    throw err;
  }
  applySnapshot(remote.data);
  try {
    await deleteSyncBlob(c); // one-time: remove it from the cloud after receiving
  } catch {
    /* best-effort cleanup; it also auto-expires */
  }
  return { counts: counts(remote.data) };
}
