// Cross-device sync engine. Snapshots the three persisted stores (holdings,
// savings, funds) to the server under a private code and applies newer remote
// snapshots back. Last-write-wins by `updatedAt`.
import { usePortfolioStore } from '../store/portfolioStore.js';
import { useSavingsStore } from '../store/savingsStore.js';
import { useFundsStore } from '../store/fundsStore.js';
import { useSyncStore } from '../store/syncStore.js';
import { getSyncBlob, putSyncBlob } from '../api/client.js';

// Unambiguous charset (no 0/O/1/I/L) for a human-copyable code.
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Generate a private sync code like "PT-7Q2M-K9F4". */
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

// Suppress the change-triggered push while we're applying a remote snapshot.
let applying = false;
export function isApplying() {
  return applying;
}

/** Current local data across the synced stores. */
export function snapshot() {
  return {
    holdings: usePortfolioStore.getState().holdings || [],
    savings: useSavingsStore.getState().savings || [],
    funds: useFundsStore.getState().funds || [],
  };
}

/** Replace local store data with a remote snapshot. */
export function applySnapshot(data) {
  if (!data || typeof data !== 'object') return;
  applying = true;
  try {
    if (Array.isArray(data.holdings)) usePortfolioStore.setState({ holdings: data.holdings });
    if (Array.isArray(data.savings)) useSavingsStore.setState({ savings: data.savings });
    if (Array.isArray(data.funds)) useFundsStore.setState({ funds: data.funds });
  } finally {
    setTimeout(() => {
      applying = false;
    }, 60);
  }
}

/** Push local data to the cloud under the current code. */
export async function pushNow() {
  const { code, setSync } = useSyncStore.getState();
  if (!code) return;
  setSync({ status: 'syncing', error: '' });
  const updatedAt = Date.now();
  await putSyncBlob(code, snapshot(), updatedAt);
  useSyncStore.getState().setSync({ updatedAt, lastSyncedAt: Date.now(), status: 'ok', error: '' });
}

/**
 * Pull from the cloud. Applies remote data only if strictly newer than what we
 * last synced (unless `force`). Returns the remote blob (or null).
 */
export async function pullNow({ force = false } = {}) {
  const { code, updatedAt, setSync } = useSyncStore.getState();
  if (!code) return null;
  setSync({ status: 'syncing', error: '' });
  const remote = await getSyncBlob(code);
  if (remote && remote.data && (force || (remote.updatedAt || 0) > (updatedAt || 0))) {
    applySnapshot(remote.data);
    useSyncStore.getState().setSync({ updatedAt: remote.updatedAt || Date.now(), lastSyncedAt: Date.now(), status: 'ok', error: '' });
  } else {
    useSyncStore.getState().setSync({ lastSyncedAt: Date.now(), status: 'ok', error: '' });
  }
  return remote;
}
