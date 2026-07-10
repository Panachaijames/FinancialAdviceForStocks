// Central switch for all UI motion/effects.
//
// Why not a raw @media (prefers-reduced-motion) query? Many Windows machines
// (especially enterprise images) ship with OS animations disabled, which makes
// browsers report "reduce" and silently freezes every effect — users then ask
// "where are the animations?". The header now has an FX toggle:
//   auto — follow the OS reduced-motion setting (default, a11y-respecting)
//   on   — force effects even when the OS asks for reduced motion
//   off  — disable all effects
// The resolved state is stamped on <html data-motion="ok|reduce"> so CSS keys
// off ONE source of truth (`:root[data-motion='reduce'] …` rules), and JS
// effects ask motionEnabled() at the moment they animate.

const QUERY = '(prefers-reduced-motion: reduce)';

/** True when the OS/browser asks for reduced motion. Safe in any environment. */
export function osPrefersReduced() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(QUERY).matches;
  } catch {
    return false;
  }
}

/** Resolve an fxMode ('auto'|'on'|'off') to "should things animate?". */
export function resolveMotion(fxMode) {
  if (fxMode === 'on') return true;
  if (fxMode === 'off') return false;
  return !osPrefersReduced();
}

/** Stamp the resolved state on <html data-motion> (the single CSS hook). */
export function applyMotionAttr(fxMode) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.motion = resolveMotion(fxMode) ? 'ok' : 'reduce';
}

/**
 * The one question every JS-driven effect asks: animate right now?
 * Reads the stamped attribute (kept current by main.jsx); falls back to the
 * OS preference before the attribute exists (first paint, tests).
 */
export function motionEnabled() {
  if (typeof document !== 'undefined') {
    const m = document.documentElement.dataset.motion;
    if (m) return m !== 'reduce';
  }
  return !osPrefersReduced();
}
