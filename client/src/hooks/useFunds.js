// useFunds: tracked Thai funds enriched with live NAV (THB). A module-level NAV
// cache is shared across all callers (FundsPanel + useNetWorth) so each fund's
// NAV is fetched once. NAV updates ~once/day, so a 1h cache is plenty.
import { useEffect, useReducer } from 'react';
import { getFundNav } from '../api/client.js';
import { useFundsStore } from '../store/fundsStore.js';

const navCache = new Map(); // projId -> nav object | null
const stampAt = new Map(); // projId -> ts
const inflight = new Set();
const listeners = new Set();
const TTL_MS = 60 * 60 * 1000;

function emit() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

function ensureNav(projId) {
  if (!projId) return;
  const fresh = navCache.has(projId) && Date.now() - (stampAt.get(projId) || 0) < TTL_MS;
  if (fresh || inflight.has(projId)) return;
  inflight.add(projId);
  getFundNav(projId)
    .then((n) => navCache.set(projId, n))
    .catch(() => navCache.set(projId, null))
    .finally(() => {
      stampAt.set(projId, Date.now());
      inflight.delete(projId);
      emit();
    });
}

export function useFunds() {
  const funds = useFundsStore((s) => s.funds);
  const [, bump] = useReducer((c) => c + 1, 0);

  useEffect(() => {
    listeners.add(bump);
    return () => listeners.delete(bump);
  }, []);

  useEffect(() => {
    funds.forEach((f) => ensureNav(f.projId));
  }, [funds]);

  const enriched = funds.map((f) => {
    const n = navCache.get(f.projId);
    const nav = n && Number.isFinite(Number(n.nav)) ? Number(n.nav) : null;
    const units = Number(f.units) || 0;
    const valueThb = nav != null ? units * nav : null;
    const costThb = units * (Number(f.avgCost) || 0);
    const plPct = costThb > 0 && valueThb != null ? ((valueThb - costThb) / costThb) * 100 : null;
    return {
      ...f,
      nav,
      navDate: n ? n.navDate : null,
      changePct: n && n.changePct != null ? Number(n.changePct) : null,
      valueThb,
      costThb,
      plPct,
    };
  });

  // Total in THB (fall back to cost basis while a NAV is still loading).
  const totalThb = enriched.reduce(
    (s, f) => s + (f.valueThb != null ? f.valueThb : f.costThb),
    0
  );

  return { funds: enriched, totalThb };
}

export default useFunds;
