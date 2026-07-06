/**
 * Thai SEC Open Data provider — read-only Thai mutual-fund (RMF/SSF/Thai ESG/…)
 * data via the SEC Open API v2.
 *
 * The legacy api.sec.or.th REST API (FundFactsheet + FundDailyInfo, two keys)
 * was retired 30 Jun 2025; the new API lives on the SAME host under /v2/… and
 * uses ONE subscription key from the new portal (secopendata.sec.or.th → the
 * developer portal). Same auth header, single key.
 *   Env: SEC_API_KEY (falls back to the old SEC_FACTSHEET_KEY / SEC_FUND_DAILY_KEY
 *   vars so an existing var can just be repointed at the new key).
 *
 * Read-only public data (no account/trading access) — safe to bundle/cloud.
 * Defensive: never throws to callers in a way that crashes the server.
 */
import { config } from '../config.js';
import { createLimiter } from '../util/limit.js';

const KEY = config.keys.secApi;
const BASE = 'https://api.sec.or.th/v2/fund';
const limit = createLimiter(4);

export function hasKey() {
  return !!KEY;
}

/** GET a /v2 endpoint and return the `items` array (cursor envelope). */
async function fetchItems(path, params) {
  const qs = new URLSearchParams(params).toString();
  const r = await limit(() =>
    fetch(`${BASE}${path}?${qs}`, { headers: { 'Ocp-Apim-Subscription-Key': KEY } })
  );
  if (r.status === 204) return []; // no content
  if (!r.ok) throw new Error(`SEC ${r.status}`);
  const json = await r.json().catch(() => null);
  return json && Array.isArray(json.items) ? json.items : [];
}

const ymd = (d) => d.toISOString().slice(0, 10);
const DEAD_STATUS = new Set(['Expired', 'Canceled', 'Cancelled', 'Liquidated']);

// ---- Fund search ----------------------------------------------------------
/**
 * Search Thai funds by abbreviation or name (server-side partial match on
 * proj_abbr_name / proj_name_th / proj_name_en, or exact proj_id).
 * Ranked: abbr exact > abbr prefix > abbr contains > name contains.
 * @param {string} q
 * @returns {Promise<Array<{projId,abbr,nameTh,nameEn,amc,taxType}>>}
 */
export async function searchFunds(q) {
  if (!hasKey()) return [];
  const query = String(q || '').trim();
  if (!query) return [];
  const items = await fetchItems('/general-info/profiles', {
    project_info: query,
    page_size: '100',
  });

  const byId = new Map(); // de-dupe multi-class rows to one per proj_id
  for (const f of items) {
    if (!f.proj_id) continue;
    if (f.fund_status && DEAD_STATUS.has(f.fund_status)) continue;
    if (!byId.has(f.proj_id)) {
      byId.set(f.proj_id, {
        projId: f.proj_id,
        abbr: f.proj_abbr_name || '',
        nameTh: f.proj_name_th || '',
        nameEn: f.proj_name_en || '',
        amc: f.comp_name_en || f.comp_name_th || '',
        taxType: f.fund_class_tax_incentive_type || '',
      });
    }
  }

  const up = query.toUpperCase();
  const scored = [];
  for (const f of byId.values()) {
    const abbr = (f.abbr || '').toUpperCase();
    const en = (f.nameEn || '').toUpperCase();
    let score = 0;
    if (abbr === up) score = 100;
    else if (abbr.startsWith(up)) score = 70;
    else if (abbr.includes(up)) score = 45;
    else if (en.includes(up)) score = 25;
    else if ((f.nameTh || '').includes(query)) score = 20;
    else score = 10; // server matched it somehow (e.g. Thai name)
    scored.push({ ...f, _s: score });
  }
  scored.sort((a, b) => b._s - a._s || a.abbr.localeCompare(b.abbr));
  // eslint-disable-next-line no-unused-vars
  return scored.slice(0, 20).map(({ _s, ...r }) => r);
}

// ---- Daily NAV (cached briefly) ------------------------------------------
const navCache = new Map(); // projId -> { val, ts }
const NAV_TTL_MS = 60 * 60 * 1000; // 1h (NAV updates ~once/day)

/**
 * Latest NAV + previous NAV (for day change). One ranged query (~2 weeks) then
 * take the two most recent published NAVs.
 * @param {string} projId
 * @returns {Promise<{projId, navDate, nav, prevNav, changePct, netAsset, class}|null>}
 */
export async function getFundNav(projId) {
  if (!hasKey() || !projId) return null;
  const cached = navCache.get(projId);
  if (cached && Date.now() - cached.ts < NAV_TTL_MS) return cached.val;

  let result = null;
  try {
    const now = new Date();
    const start = new Date(now.getTime() - 16 * 86400000);
    const items = await fetchItems('/daily-info/nav', {
      proj_id: projId,
      start_nav_date: ymd(start),
      end_nav_date: ymd(now),
      page_size: '100',
    });

    // A multi-class fund returns a row per class per day; prefer the 'main'
    // class, else stick to whichever single class we first see.
    const withVal = items.filter((r) => Number.isFinite(Number(r.last_val)));
    const mainRows = withVal.filter((r) => String(r.fund_class_name || '').toLowerCase() === 'main');
    let rows = mainRows.length ? mainRows : withVal;
    if (!mainRows.length && rows.length) {
      const cls = rows[0].fund_class_name;
      rows = rows.filter((r) => r.fund_class_name === cls);
    }
    rows.sort((a, b) => String(b.nav_date).localeCompare(String(a.nav_date)));

    if (rows.length) {
      const latest = rows[0];
      const prev = rows.find((r) => r.nav_date !== latest.nav_date) || null;
      const nav = Number(latest.last_val);
      const prevNav = prev ? Number(prev.last_val) : null;
      const changePct = prevNav ? ((nav - prevNav) / prevNav) * 100 : null;
      result = {
        projId,
        navDate: latest.nav_date,
        nav,
        prevNav,
        changePct,
        netAsset: Number(latest.net_asset) || null,
        class: latest.fund_class_name || 'main',
      };
    }
  } catch {
    result = null; // surfaced to the route as "no NAV"; don't cache failures
    return result;
  }

  navCache.set(projId, { val: result, ts: Date.now() });
  return result;
}

export default { hasKey, searchFunds, getFundNav };
