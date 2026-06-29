/**
 * Thai SEC OpenAPI provider — read-only Thai mutual-fund (RMF/LTF/SSF/etc.) data.
 *
 * Two free subscription keys (api-portal.sec.or.th):
 *   - FundFactsheet  -> AMC list + fund list (the searchable directory)
 *   - FundDailyInfo  -> per-fund daily NAV
 *
 * Read-only public data (no account/trading access) — safe to bundle/cloud.
 * Defensive: never throws to callers in a way that crashes the server.
 */
import { config } from '../config.js';
import { createLimiter } from '../util/limit.js';

const FACT = config.keys.secFactsheet;
const DAILY = config.keys.secFundDaily;
const BASE = 'https://api.sec.or.th';
const limit = createLimiter(4);

export function hasKey() {
  return !!(FACT && DAILY);
}

async function fetchJson(url, key) {
  const r = await limit(() => fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': key } }));
  if (r.status === 204) return null; // no content (e.g. no NAV that day)
  if (!r.ok) throw new Error(`SEC ${r.status}`);
  return r.json();
}

// ---- Fund directory (cached) ---------------------------------------------
let directory = null; // [{ projId, abbr, nameTh, nameEn, amc }]
let directoryAt = 0;
const DIRECTORY_TTL_MS = 24 * 60 * 60 * 1000;
let buildingDir = null;

async function buildDirectory() {
  const amcs = await fetchJson(`${BASE}/FundFactsheet/fund/amc`, FACT);
  const out = [];
  await Promise.all(
    (amcs || []).map(async (amc) => {
      try {
        const funds = await fetchJson(`${BASE}/FundFactsheet/fund/amc/${amc.unique_id}`, FACT);
        for (const f of funds || []) {
          if (f.fund_status && f.fund_status !== 'RG') continue; // active only
          out.push({
            projId: f.proj_id,
            abbr: f.proj_abbr_name || '',
            nameTh: f.proj_name_th || '',
            nameEn: f.proj_name_en || '',
            amc: amc.name_en || amc.name_th || '',
          });
        }
      } catch {
        /* skip an AMC that errors */
      }
    })
  );
  return out;
}

async function getDirectory() {
  if (directory && Date.now() - directoryAt < DIRECTORY_TTL_MS) return directory;
  if (buildingDir) return buildingDir;
  buildingDir = buildDirectory()
    .then((dir) => {
      directory = dir;
      directoryAt = Date.now();
      return dir;
    })
    .finally(() => {
      buildingDir = null;
    });
  return buildingDir;
}

/**
 * Search Thai funds by abbreviation or name. Ranked: abbr prefix > abbr/name contains.
 * @param {string} q
 * @returns {Promise<Array<{projId,abbr,nameTh,nameEn,amc}>>}
 */
export async function searchFunds(q) {
  if (!hasKey()) return [];
  const query = String(q || '').trim().toUpperCase();
  if (!query) return [];
  const dir = await getDirectory();
  const scored = [];
  for (const f of dir) {
    const abbr = (f.abbr || '').toUpperCase();
    const en = (f.nameEn || '').toUpperCase();
    const th = f.nameTh || '';
    let score = 0;
    if (abbr === query) score = 100;
    else if (abbr.startsWith(query)) score = 70;
    else if (abbr.includes(query)) score = 45;
    else if (en.includes(query)) score = 25;
    else if (th.includes(q.trim())) score = 20;
    if (score > 0) scored.push({ ...f, _s: score });
  }
  scored.sort((a, b) => b._s - a._s || a.abbr.localeCompare(b.abbr));
  // eslint-disable-next-line no-unused-vars
  return scored.slice(0, 20).map(({ _s, ...r }) => r);
}

// ---- Daily NAV (cached briefly) ------------------------------------------
const navCache = new Map(); // projId -> { val, ts }
const NAV_TTL_MS = 60 * 60 * 1000; // 1h (NAV updates ~once/day)

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Latest NAV + previous NAV (for day change). Walks back up to ~10 days to find
 * the two most recent published NAVs (funds skip weekends/holidays/lag).
 * @param {string} projId
 * @returns {Promise<{projId, navDate, nav, prevNav, changePct, netAsset, class}|null>}
 */
export async function getFundNav(projId) {
  if (!hasKey() || !projId) return null;
  const cached = navCache.get(projId);
  if (cached && Date.now() - cached.ts < NAV_TTL_MS) return cached.val;

  const points = [];
  const now = new Date();
  for (let i = 0; i <= 10 && points.length < 2; i += 1) {
    const d = new Date(now.getTime() - i * 86400000);
    try {
      const rows = await fetchJson(`${BASE}/FundDailyInfo/${projId}/dailynav/${ymd(d)}`, DAILY);
      if (Array.isArray(rows) && rows.length) {
        const main = rows.find((r) => (r.class_abbr_name || '').toLowerCase() === 'main') || rows[0];
        const val = Number(main.last_val);
        if (Number.isFinite(val)) {
          points.push({ navDate: main.nav_date || ymd(d), nav: val, netAsset: Number(main.net_asset) || null, cls: main.class_abbr_name || 'main' });
        }
      }
    } catch {
      /* skip this date */
    }
  }
  let result = null;
  if (points.length) {
    const latest = points[0];
    const prev = points[1] || null;
    const changePct = prev && prev.nav ? ((latest.nav - prev.nav) / prev.nav) * 100 : null;
    result = {
      projId,
      navDate: latest.navDate,
      nav: latest.nav,
      prevNav: prev ? prev.nav : null,
      changePct,
      netAsset: latest.netAsset,
      class: latest.cls,
    };
  }
  navCache.set(projId, { val: result, ts: Date.now() });
  return result;
}

export default { hasKey, searchFunds, getFundNav };
