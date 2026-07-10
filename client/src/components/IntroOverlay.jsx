import React, { useEffect, useRef, useState } from 'react';
import { motionEnabled } from '../lib/motion.js';

/**
 * Intro v2 — "Into the Light". Cinematic ~7.2s opening: the brand ignites a
 * point of light at the vanishing point, then the camera accelerates forward
 * into it — warp streaks, a perspective floor grid rushing underneath, the
 * light core growing exponentially until it swallows the viewport (whiteout +
 * shock ring) — then the overlay fades to reveal the dashboard and unmounts.
 *
 * Plays only when motionEnabled() (user FX toggle + OS reduced-motion, resolved
 * in lib/motion.js). Click anywhere — or Escape / Enter / Space — skips with a
 * fast ~250ms fade. Fully unmounts when done (React state timeout), so it
 * costs nothing afterwards.
 */

const TOTAL_MS = 7250; // storyboard ends at 7.2s (fade completes at 6.2s + 1s)
const SKIP_MS = 260; // fast skip fade
// The final reveal fade starts at 6.2s. Skipping after that would replace the
// almost-finished introFade animation with introSkipFade, snapping opacity
// back to 1 for a visible flash — so late skips are ignored and the fade
// simply finishes on its own.
const FADE_START_MS = 6200;

const STREAK_COUNT = 22;

// Deterministic pseudo-random streak params (golden-angle spread — no two
// neighbours share an angle, delay, duration or length, but every render is
// identical, so there is no hydration/re-render jitter).
const STREAKS = Array.from({ length: STREAK_COUNT }, (_, i) => ({
  angle: Math.round(((i * 137.508) % 360) * 100) / 100,
  delay: Math.round((1.6 + ((i * 0.37) % 1.08)) * 100) / 100, // 1.6s – 2.68s
  dur: Math.round((1.02 - (i % 7) * 0.085) * 100) / 100, // 1.02s – 0.51s
  len: 120 + ((i * 53) % 150), // 120px – 269px
  tint: i % 3, // 0 = white, 1 = up-green, 2 = accent-blue
}));

export default function IntroOverlay() {
  // 'play' -> (optional 'skip') -> 'done' (unmounted)
  const [phase, setPhase] = useState(() => (motionEnabled() ? 'play' : 'done'));
  const timerRef = useRef(null);
  const mountedAtRef = useRef(Date.now());

  const skip = () => {
    if (phase !== 'play') return;
    if (Date.now() - mountedAtRef.current >= FADE_START_MS) return;
    setPhase('skip');
  };

  useEffect(() => {
    if (phase === 'play') {
      timerRef.current = setTimeout(() => setPhase('done'), TOTAL_MS);
    } else if (phase === 'skip') {
      timerRef.current = setTimeout(() => setPhase('done'), SKIP_MS);
    }
    return () => clearTimeout(timerRef.current);
  }, [phase]);

  // Keyboard skip — the overlay blocks the whole app for ~7s and the root div
  // is not focusable, so keyboard users need a way out too. Listener is
  // removed when the phase changes and on unmount.
  useEffect(() => {
    if (phase !== 'play') return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        skip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  if (phase === 'done') return null;

  return (
    <div
      className={phase === 'skip' ? 'intro intro-skip' : 'intro'}
      role="presentation"
      aria-hidden="true"
      onClick={skip}
    >
      {/* Perspective floor grid rushing toward the viewer (depth cue) */}
      <div className="intro-grid" />

      {/* Warp streaks — the whole field also zooms via .intro-warp so the
          final second reads dramatically faster than the first */}
      <div className="intro-warp">
        {STREAKS.map((s, i) => (
          <span
            key={i}
            className={`intro-streak intro-streak-t${s.tint}`}
            style={{
              '--angle': `${s.angle}deg`,
              '--delay': `${s.delay}s`,
              '--dur': `${s.dur}s`,
              '--len': `${s.len}px`,
            }}
          />
        ))}
      </div>

      {/* The light: soft halo + hard core, both growing exponentially */}
      <div className="intro-bloom" />
      <div className="intro-core" />

      {/* Brand — fades in during the void, then flies PAST the camera */}
      <div className="intro-brand">
        <div className="intro-logo">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
          </svg>
        </div>
        <div className="intro-title">PT Financial Advisor</div>
      </div>

      <div className="intro-hint">click to skip</div>

      {/* Impact: final shock ring + whiteout that swallows the viewport */}
      <div className="intro-ring" />
      <div className="intro-white" />
    </div>
  );
}
