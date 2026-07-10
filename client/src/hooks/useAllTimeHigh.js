// useAllTimeHigh — tracks the portfolio's all-time-high market value in USD
// (currency-stable: the stored number never jumps when the user flips the
// display currency) and decides when a tasteful celebration is warranted.
//
// Signature note: instead of the ({ valueDisplay, displayCurrency, toUsd })
// shape, the caller hands us the ALREADY-CONVERTED USD total plus a `ready`
// flag. PortfolioSummary already has everything needed to derive USD in one
// line (pure convert() from lib/format.js + the live rate from useFx), so the
// hook stays a pure "ATH ledger + celebration policy" with zero currency
// knowledge — easier to test and impossible to double-convert.
//
// False-positive guards (all enforced here):
//   (a) no-op until `ready` is true AND a 3s internal settle timer after the
//       moment ready flips true has elapsed (quotes trickle in; the total
//       climbs as avgCost fallbacks are replaced by live prices — we must not
//       mistake that climb for a new high),
//   (b) first ever run (no stored ATH) records silently, never celebrates,
//   (c) celebrate only when usd > storedAth * 1.002 (0.2% epsilon),
//   (d) at most ONE celebration per browser session (sessionStorage flag),
//   (e) the stored ATH is ALWAYS advanced when exceeded, celebrating or not,
//   (f) celebration is gated on motionEnabled() — with motion off the ledger
//       still updates, the confetti simply never fires.

import { useCallback, useEffect, useRef, useState } from 'react';
import { motionEnabled } from '../lib/motion.js';

const STORAGE_KEY = 'pt-ath';
const SESSION_KEY = 'pt-ath-celebrated';
const EPSILON = 1.002; // must beat the old high by 0.2% to celebrate
const SETTLE_MS = 3000; // extra quiet period after `ready` flips true

function readStoredAth() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const usd = Number(parsed && parsed.usd);
    if (Number.isFinite(usd) && usd > 0) {
      return {
        usd,
        at:
          parsed && typeof parsed.at === 'string'
            ? parsed.at
            : new Date().toISOString(),
      };
    }
  } catch {
    // corrupt JSON / storage blocked — treat as "no ATH yet"
  }
  return null;
}

function writeStoredAth(rec) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
  } catch {
    // storage full/blocked — the in-memory state still works this session
  }
}

function sessionAlreadyCelebrated() {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function markSessionCelebrated() {
  try {
    window.sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    // if we can't persist the flag, the `celebrating` state still guards
    // against re-fires until a remount — acceptable degradation
  }
}

/**
 * @param {object} params
 * @param {number} params.usdValue  Total portfolio market value in USD.
 * @param {boolean} params.ready    True once EVERY holding has a finite live
 *                                  quote price (caller computes this).
 * @returns {{ celebrating: boolean, ath: {usd:number, at:string}|null, dismiss: () => void }}
 */
export default function useAllTimeHigh({ usdValue, ready }) {
  const [celebrating, setCelebrating] = useState(false);
  const [ath, setAth] = useState(() => readStoredAth());
  const [settled, setSettled] = useState(false);
  // Ref mirror so the evaluation effect never needs `ath` as a dependency
  // (which would re-run it right after every write).
  const athRef = useRef(ath);
  athRef.current = ath;

  // Guard (a): 3s settle timer that starts when `ready` flips true. If quotes
  // regress (symbol added, socket reconnect), the timer resets.
  useEffect(() => {
    if (!ready) {
      setSettled(false);
      return undefined;
    }
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [ready]);

  // Evaluate the current USD total against the stored ATH.
  useEffect(() => {
    if (!settled) return;
    const usd = Number(usdValue);
    if (!Number.isFinite(usd) || usd <= 0) return;

    const stored = athRef.current;

    // Guard (b): first ever run — record silently, never celebrate.
    if (!stored) {
      const rec = { usd, at: new Date().toISOString() };
      writeStoredAth(rec);
      setAth(rec);
      return;
    }

    if (usd <= stored.usd) return;

    // Guard (e): always advance the ledger when exceeded.
    const rec = { usd, at: new Date().toISOString() };
    writeStoredAth(rec);
    setAth(rec);

    // Guards (c) + (d) + (f): epsilon beat, once per session, motion on.
    if (
      usd > stored.usd * EPSILON &&
      !sessionAlreadyCelebrated() &&
      motionEnabled()
    ) {
      markSessionCelebrated();
      setCelebrating(true);
    }
  }, [settled, usdValue]);

  const dismiss = useCallback(() => setCelebrating(false), []);

  return { celebrating, ath, dismiss };
}
