import React, { useEffect, useState } from 'react';

/**
 * Cinematic opening animation (CSS-driven). Plays once per app session:
 * a progress line fills → the camera zooms onto it → tilts so the line leads
 * forward → bursts into the app with a flash + shockwave, then fades to reveal
 * the dashboard. Respects prefers-reduced-motion (skipped) and only plays once
 * per session (so web refreshes don't replay it; a fresh launch does).
 */
export default function IntroOverlay() {
  const [show, setShow] = useState(() => {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      if (sessionStorage.getItem('pt-intro-shown')) return false;
    } catch {
      /* ignore */
    }
    return true;
  });

  useEffect(() => {
    if (!show) return undefined;
    try {
      sessionStorage.setItem('pt-intro-shown', '1');
    } catch {
      /* ignore */
    }
    const t = setTimeout(() => setShow(false), 2400);
    return () => clearTimeout(t);
  }, [show]);

  if (!show) return null;

  return (
    <div className="intro" role="presentation" aria-hidden="true">
      <div className="intro-flash" />
      <div className="intro-shock" />
      <div className="intro-stage">
        <div className="intro-logo">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
          </svg>
        </div>
        <div className="intro-title">PT Financial Advisor</div>
        <div className="intro-line">
          <span className="intro-line-fill" />
        </div>
      </div>
    </div>
  );
}
