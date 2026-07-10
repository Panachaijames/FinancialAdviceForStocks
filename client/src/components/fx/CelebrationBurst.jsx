// CelebrationBurst — one brief, tasteful fountain of ~32 particles from the
// bottom-center of the viewport plus a top-center toast pill announcing the
// new all-time high. Mounted ONLY while useAllTimeHigh says `celebrating`
// (which itself is gated on motionEnabled()), so under reduced motion this
// never renders at all — the :root[data-motion='reduce'] CSS rules are
// belt-and-suspenders.
//
// Perf: particles animate transform/opacity only (composited), the overlay is
// pointer-events:none + aria-hidden, the particle layer unmounts right after
// its 1.4s run so nothing lingers in the DOM, and every timer is cleaned up
// on unmount. All per-particle randomness is DETERMINISTIC from the index
// (hash-style sin fract), so renders are stable and there is no Math.random
// churn between mounts.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { fmtMoney } from '../../lib/format.js';

const PARTICLE_COUNT = 32;
const COLORS = ['var(--up)', 'var(--accent)', 'var(--gold)', 'var(--crypto)'];
const BURST_TOTAL_MS = 1400; // longest delay + duration stays within this
const TOAST_MS = 4000;

// Deterministic pseudo-random in [0,1) from (index, salt).
function prand(i, salt) {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function buildParticles() {
  const out = [];
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    const a = prand(i, 1);
    const b = prand(i, 2);
    const c = prand(i, 3);
    // Fountain arc: angles fan across the upper hemisphere, -155deg..-25deg.
    const angle = ((-90 + (a - 0.5) * 130) * Math.PI) / 180;
    const dist = 150 + b * 170; // 150..320px
    const dur = Math.round(850 + c * 430); // 850..1280ms
    const delay = Math.round(a * 120); // 0..120ms => total <= ~1400ms
    out.push({
      tx: Math.round(Math.cos(angle) * dist),
      ty: Math.round(Math.sin(angle) * dist), // negative => upward
      rot: Math.round((c - 0.5) * 540),
      delay,
      dur,
      size: 6 + Math.round(b * 4), // 6..10px
      color: COLORS[i % COLORS.length],
      round: i % 3 === 0, // mix of circles and squares
    });
  }
  return out;
}

/**
 * @param {object} props
 * @param {number} props.value     New ATH market value in the DISPLAY currency.
 * @param {string} props.currency  Display currency code for formatting.
 * @param {() => void} props.onDone  Called when the toast auto-dismisses (4s)
 *                                   or the user clicks it. Unmounts us.
 */
export default function CelebrationBurst({ value, currency = 'USD', onDone }) {
  const [burstAlive, setBurstAlive] = useState(true);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    // Drop the particle layer from the DOM once its animation has finished.
    const burstTimer = setTimeout(() => setBurstAlive(false), BURST_TOTAL_MS + 100);
    // Auto-dismiss the whole overlay after 4s.
    const toastTimer = setTimeout(() => {
      if (onDoneRef.current) onDoneRef.current();
    }, TOAST_MS);
    return () => {
      clearTimeout(burstTimer);
      clearTimeout(toastTimer);
    };
  }, []);

  const particles = useMemo(buildParticles, []);

  const handleDismiss = () => {
    if (onDoneRef.current) onDoneRef.current();
  };

  return (
    <div className="ath-celebration">
      {burstAlive && (
        <div className="ath-burst" aria-hidden="true">
          {particles.map((p, i) => (
            <span
              key={i}
              className="ath-particle"
              style={{
                '--tx': `${p.tx}px`,
                '--ty': `${p.ty}px`,
                '--rot': `${p.rot}deg`,
                '--delay': `${p.delay}ms`,
                '--dur': `${p.dur}ms`,
                width: p.size,
                height: p.size,
                background: p.color,
                borderRadius: p.round ? '50%' : 2,
              }}
            />
          ))}
        </div>
      )}
      <div
        className="ath-toast"
        role="status"
        onClick={handleDismiss}
        title="Dismiss"
      >
        <TrendingUp size={15} style={{ color: theme.colors.gold, flexShrink: 0 }} />
        <span>New all-time high</span>
        <span className="ath-toast-value" style={{ fontFamily: theme.mono }}>
          {fmtMoney(value, currency)}
        </span>
      </div>
    </div>
  );
}
