// Local backup file helpers (pure + a DOM download util; no store imports, so
// the pure parts unit-test under plain node). The store glue (snapshot() /
// applySnapshot()) lives in lib/sync.js and is wired up by the components.

const BACKUP_APP = 'pt-financial-advisor';
const BACKUP_VERSION = 1;

const pad2 = (n) => String(n).padStart(2, '0');

/** e.g. "pt-backup-2026-07-14.json" */
export function backupFilename(date) {
  const d = date instanceof Date ? date : new Date();
  return `pt-backup-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.json`;
}

/**
 * Wrap a snapshot in a self-describing envelope and pretty-print it.
 * @param {object} snap  result of sync.snapshot()
 * @param {string} isoDate  ISO timestamp string (passed in for testability)
 */
export function serializeBackup(snap, isoDate) {
  return JSON.stringify(
    { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: isoDate, snapshot: snap },
    null,
    2
  );
}

/**
 * Parse a backup file's text into a snapshot object. Accepts both our envelope
 * ({ snapshot: {...} }) and a bare snapshot object (older/hand-made exports).
 * Throws a friendly Error if the text isn't a usable backup.
 * @param {string} text
 * @returns {object} snapshot
 */
export function parseBackup(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON — pick a .json backup exported from this app.");
  }
  const snap = obj && typeof obj.snapshot === 'object' && obj.snapshot ? obj.snapshot : obj;
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) {
    throw new Error("That file doesn't look like a PT backup.");
  }
  // A real snapshot has at least one of the known collections.
  const known = ['holdings', 'transactions', 'savings', 'funds', 'plan', 'targets', 'alerts'];
  if (!known.some((k) => k in snap)) {
    throw new Error("That file doesn't look like a PT backup (no recognizable data).");
  }
  return snap;
}

/** Trigger a browser download of a text blob. DOM-only; not called at import. */
export function downloadTextFile(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default { backupFilename, serializeBackup, parseBackup, downloadTextFile };
