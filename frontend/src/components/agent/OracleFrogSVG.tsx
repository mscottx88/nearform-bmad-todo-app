/**
 * Story 6.7: Oracle Frog as a clean neon-outline SVG.
 *
 * Visual reference: user-supplied "It is Wednesday, my dudes"
 * neon-sign Budgett's frog (2026-04-25). Goal: closely duplicate
 * the silhouette and stroke palette.
 */

import { useEffect, useId, useState } from 'react';
import { useAgentStore } from '../../stores/useAgentStore';
import './OracleFrogSVG.css';

// ─── Body silhouette ──────────────────────────────────────────
//
// In the reference the body is a near-circular BLOB filling most
// of the frame — wider than tall (about 1.4:1), with a soft
// rounded peak top, a wide bulging right side, and a long flat
// underside. Drawn here at viewBox-centre coords (110, 95) with
// half-width 90 + half-height 65.
//
// Path walks clockwise from the upper-left "shoulder".
const BODY_PATH = [
  // Top-left shoulder, curve up over the rounded back to the
  // top-right shoulder. The apex is slightly right-of-centre.
  'M 38 80',
  'C 30 28, 130 12, 175 30',
  // Right side bulge — curves out to about x=200 at the equator,
  // then back inward as the body bottoms out.
  'C 210 50, 208 110, 188 140',
  // Long lower belly — gentle wave from right to left.
  'Q 160 162, 110 162',
  'Q 60 162, 32 144',
  // Left side closes the silhouette back up to the start.
  'C 8 122, 8 100, 38 80',
  'Z',
].join(' ');

// ─── Cyan smile ──────────────────────────────────────────────
//
// Long wide arc across the lower-front of the body. Shape: starts
// well into the left side at y=110, dips down to a low point
// around the centre, then curves back up to the right side. This
// is the DOMINANT facial feature in the reference.
const SMILE_PATH = 'M 30 110 Q 110 158 188 110';

// Soft cyan inner-belly fold below the smile.
const BELLY_FOLD = 'M 50 142 Q 110 158 170 138';

// ─── Front-left arm / fin ────────────────────────────────────
//
// Small pointed triangular fin sticking out from the lower-left
// edge of the body. In the reference this is a clear "leg" shape
// pointing down-and-left. Pink/magenta gradient stroke.
const FRONT_FIN_PATH = [
  'M 32 144',
  'C 18 152, 4 158, -4 168',
  'L 12 174',
  'C 22 172, 32 162, 36 152',
  'Z',
].join(' ');

// ─── Back leg ────────────────────────────────────────────────
//
// Big bent-knee leg curling from the upper-right edge of the body
// down to the lower-right, ending in a foot. The leg has clear
// volume — outer side bulges away from the body, inner side
// (closer to body) curves back in.
const BACK_LEG_PATH = [
  // Top of the femur — emerges from the upper-right of the body.
  'M 188 50',
  // Outer side of the femur — sweeps RIGHT and DOWN past the
  // body's far edge.
  'C 230 70, 240 130, 220 165',
  // Knee bend at the bottom-right.
  'Q 210 178, 192 178',
  // Inner calf — sweeps BACK toward the body.
  'Q 180 174, 178 162',
  // Inner side closing back up to the hip.
  'C 198 150, 208 110, 200 80',
  'Q 194 60, 188 50',
  'Z',
].join(' ');

// Back-foot toes — three splayed curves at the bottom of the leg.
const BACK_TOES = [
  'M 192 178 Q 178 188 162 192',
  'M 200 180 Q 192 196 174 200',
  'M 212 178 Q 212 196 198 200',
];

export function OracleFrogSVG() {
  const agentState = useAgentStore((s) => s.agentState);
  const [throatPulse, setThroatPulse] = useState(0);
  const idBase = useId().replace(/[^a-zA-Z0-9]/g, '');
  const bodyGradId = `oracle-frog-body-${idBase}`;
  const errGradId = `oracle-frog-err-${idBase}`;

  useEffect(() => {
    let lastLen = useAgentStore.getState().streamingBuffer.length;
    const unsub = useAgentStore.subscribe((state) => {
      const len = state.streamingBuffer.length;
      if (len > lastLen) setThroatPulse((n) => n + 1);
      lastLen = len;
    });
    return unsub;
  }, []);

  return (
    <svg
      className="oracle-frog-svg"
      data-state={agentState}
      viewBox="-10 0 260 220"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs>
        {/* Body outline gradient — pink/magenta at top fading to
            soft purple at bottom. Matches the reference's
            palette. */}
        <linearGradient id={bodyGradId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ff10f0" />
          <stop offset="55%" stopColor="#a050ff" />
          <stop offset="100%" stopColor="#5040ff" />
        </linearGradient>
        <linearGradient id={errGradId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ff2200" />
          <stop offset="100%" stopColor="#ff8800" />
        </linearGradient>
      </defs>

      {/* ─── Lily pad disc ──────────────────────────────────── */}
      <g className="oracle-frog-svg__pad">
        <ellipse
          cx="125"
          cy="208"
          rx="110"
          ry="9"
          className="oracle-frog-svg__pad-fill"
        />
        <ellipse
          cx="125"
          cy="208"
          rx="110"
          ry="9"
          className="oracle-frog-svg__pad-rim"
        />
      </g>

      {/* ─── Whole-frog group ───────────────────────────────── */}
      <g
        className="oracle-frog-svg__frog"
        style={{
          ['--frog-body-grad' as string]: `url(#${bodyGradId})`,
          ['--frog-err-grad' as string]: `url(#${errGradId})`,
        }}
      >
        {/* Back leg drawn FIRST so the body sits on top of the
            section that overlaps. */}
        <path d={BACK_LEG_PATH} className="oracle-frog-svg__back-leg" />
        {BACK_TOES.map((d, i) => (
          <path
            key={`back-toe-${i}`}
            d={d}
            className="oracle-frog-svg__back-toe"
          />
        ))}

        {/* Front-left fin / arm. */}
        <path d={FRONT_FIN_PATH} className="oracle-frog-svg__fin" />

        {/* Body outline. */}
        <path d={BODY_PATH} className="oracle-frog-svg__body" />

        {/* Soft cyan belly fold below the smile. */}
        <path d={BELLY_FOLD} className="oracle-frog-svg__belly-fold" />

        {/* Cyan smile — DOMINANT facial feature. */}
        <path d={SMILE_PATH} className="oracle-frog-svg__smile" />

        {/* Tiny cyan nostrils — between the eyes, slightly left. */}
        <circle cx="92" cy="78" r="2.4" className="oracle-frog-svg__nostril" />
        <circle cx="105" cy="74" r="2.4" className="oracle-frog-svg__nostril" />

        {/* Throat sac — chunk-pulse target, sits inside the smile. */}
        <ellipse
          key={`throat-${throatPulse}`}
          cx="110"
          cy="130"
          rx="26"
          ry="6"
          className="oracle-frog-svg__throat"
        />

        {/* ─── Eyes — two PROMINENT pink concentric ringed eyes
             on top of the body. The far eye (right in SVG) is
             bigger; the near eye is smaller with a swirl glint
             instead of a solid centre dot. ──────────────────── */}
        <g className="oracle-frog-svg__eye oracle-frog-svg__eye--near">
          <circle cx="68" cy="56" r="20" className="oracle-frog-svg__eye-outer" />
          <circle cx="68" cy="56" r="12" className="oracle-frog-svg__eye-inner" />
          {/* "@-style" swirl glint slightly off-centre. */}
          <circle cx="71" cy="53" r="5" className="oracle-frog-svg__eye-glint" />
        </g>
        <g className="oracle-frog-svg__eye oracle-frog-svg__eye--far">
          <circle cx="138" cy="60" r="22" className="oracle-frog-svg__eye-outer" />
          <circle cx="138" cy="60" r="13" className="oracle-frog-svg__eye-inner" />
          <circle cx="138" cy="60" r="3.5" className="oracle-frog-svg__pupil" />
        </g>
      </g>
    </svg>
  );
}
