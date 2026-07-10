import React from 'react';

/**
 * Aurora — ambient, full-viewport animated-gradient background.
 *
 * A fixed, z-index:-1, pointer-events:none, aria-hidden atmosphere layer that
 * sits BEHIND the entire app. Two-to-three heavily-blurred radial "blobs" in
 * accent-blue, up-green and a hint of crypto-purple drift very slowly over the
 * #0b0e14 base. Deliberately low opacity so numbers/text stay crisp — this is
 * atmosphere, not a light show.
 *
 * All motion is expressed in pure CSS (see .aurora* rules + @keyframes in
 * index.css) and animates only transform/opacity — GPU-friendly, no reflow.
 * Under prefers-reduced-motion: reduce the blobs freeze in their resting
 * position (handled entirely in CSS).
 */
export default function Aurora() {
  return (
    <div className="aurora" aria-hidden="true">
      <span className="aurora-blob aurora-blob-1" />
      <span className="aurora-blob aurora-blob-2" />
      <span className="aurora-blob aurora-blob-3" />
    </div>
  );
}
