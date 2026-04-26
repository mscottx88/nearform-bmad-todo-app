/**
 * Story 6.7: Oracle Frog as a clean neon-outline SVG.
 *
 * Visual reference: user-supplied "It is Wednesday, my dudes"
 * neon-sign Budgett's frog (2026-04-25). Goal: closely duplicate
 * the silhouette and stroke palette.
 *
 * Reference features explicitly recreated below:
 *   1. Pink/magenta gradient body outline — rounded blob,
 *      asymmetric top with the apex slightly right-of-centre.
 *   2. Wide bright CYAN smile arc — the dominant facial feature,
 *      nearly the full body width, with a slight downward dip
 *      under the chin.
 *   3. Front-left arm: a small pointed triangular "fin" peeking
 *      from the lower-left edge of the body — pink/magenta
 *      stroke matching the body outline.
 *   4. Big back leg curling from the upper-right edge of the
 *      body down to the lower-right with a clear bent-knee
 *      profile, ending in 3 splayed toes.
 *   5. Two pink concentric ringed eyes on top of the body — the
 *      far eye is MORE prominent (bigger / more rings); the near
 *      eye is smaller with a small "@-style" swirl glint inside.
 *   6. Tiny cyan nostrils + a soft cyan belly-fold curve.
 */

import { useEffect, useId, useState } from 'react';
import { useAgentStore } from '../../stores/useAgentStore';
import './OracleFrogSVG.css';

// ─── Body silhouette ──────────────────────────────────────────
//
// The reference's body has these tells:
//   - top peak slightly right of centre (apex around x=120)
//   - right side bulges full and rounded
//   - bottom slopes UP toward the back leg on the right
//   - bottom slopes DOWN smoothly on the left
// Path walks clockwise from the top-left "shoulder".
const BODY_PATH = [
  'M 64 56',
  'C 50 24, 130 14, 158 28', // up over the back, peak right of centre
  'C 188 42, 192 96, 174 124', // down the right side, full bulge
  'Q 150 142, 122 142', // across the lower right
  'Q 92 142, 70 138', // bottom centre
  'Q 50 134, 36 122', // sweep up to the front-left arm join
  'C 16 102, 18 56, 64 56', // back up the near side
  'Z',
].join(' ');

// ─── Cyan smile ──────────────────────────────────────────────
//
// Long arc that dominates the lower-front of the body. In the
// reference the smile starts well into the left third of the
// body, dips down slightly, peaks back up around 60-65% across,
// then drops down and meets the right side of the body.
const SMILE_PATH = 'M 36 96 Q 100 140 168 92';

// Soft cyan inner-belly fold below the smile.
const BELLY_FOLD = 'M 60 124 Q 100 138 152 118';

// ─── Front-left arm / fin ────────────────────────────────────
//
// In the reference, the front-left "leg" is essentially a small
// pointed triangular fin — two strokes that meet at a point off
// the lower-left edge of the body. Drawn as a single closed path
// with the same pink/purple gradient as the body.
const FRONT_FIN_PATH = [
  'M 36 122',
  'C 24 130, 8 132, 2 138',
  'L 14 144',
  'C 22 144, 32 138, 36 132',
  'Z',
].join(' ');

// ─── Back leg ────────────────────────────────────────────────
//
// Bent-knee leg curling down from the upper-right of the body.
// Drawn as ONE closed path. The path traces:
//   - up from the body at the hip,
//   - arcs out to the right and down (femur),
//   - bends sharply (the knee),
//   - sweeps back inward (calf),
//   - ends at the foot.
// Inner curve (the leg's "underside") closes the path back to the
// hip — gives the leg internal volume rather than reading as a
// flat noodle.
const BACK_LEG_PATH = [
  'M 168 60',
  'C 200 70, 210 116, 196 144', // outer side of femur + knee
  'Q 188 158, 168 162', // calf coming back inward
  'Q 158 158, 154 148', // foot socket
  'C 168 142, 178 124, 178 102', // inner side closing back up
  'Q 174 80, 168 60',
  'Z',
].join(' ');

// Back-foot toes — three splayed curves emerging from the bottom
// of the back leg, pointing away (down + forward).
const BACK_TOES = [
  'M 154 148 Q 142 158 130 162',
  'M 162 156 Q 152 168 138 174',
  'M 172 160 Q 168 174 158 178',
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
      viewBox="0 0 215 200"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs>
        {/* Body outline gradient — pink at the top fading to a
            soft purple at the bottom. Matches the reference's
            outer outline tone. */}
        <linearGradient id={bodyGradId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ff10f0" />
          <stop offset="60%" stopColor="#9050ff" />
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
          cx="107"
          cy="186"
          rx="92"
          ry="9"
          className="oracle-frog-svg__pad-fill"
        />
        <ellipse
          cx="107"
          cy="186"
          rx="92"
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
        {/* Back leg drawn FIRST so the body sits on top of it
            where they overlap. */}
        <path d={BACK_LEG_PATH} className="oracle-frog-svg__back-leg" />
        {BACK_TOES.map((d, i) => (
          <path
            key={`back-toe-${i}`}
            d={d}
            className="oracle-frog-svg__back-toe"
          />
        ))}

        {/* Front-left fin / arm — same gradient family as the
            body outline. Drawn before the body so its base joins
            the body's outline cleanly. */}
        <path d={FRONT_FIN_PATH} className="oracle-frog-svg__fin" />

        {/* Body outline. */}
        <path d={BODY_PATH} className="oracle-frog-svg__body" />

        {/* Soft cyan belly fold curve. */}
        <path d={BELLY_FOLD} className="oracle-frog-svg__belly-fold" />

        {/* Tiny cyan nostrils above the mouth. */}
        <circle cx="86" cy="78" r="2.0" className="oracle-frog-svg__nostril" />
        <circle cx="98" cy="74" r="2.0" className="oracle-frog-svg__nostril" />

        {/* Throat sac — chunk-pulse target. Sits above the smile
            so during 'speaking' the pulse pushes UP into the
            mouth area. */}
        <ellipse
          key={`throat-${throatPulse}`}
          cx="100"
          cy="118"
          rx="22"
          ry="5"
          className="oracle-frog-svg__throat"
        />

        {/* Cyan smile — DOMINANT facial feature. Drawn after the
            body + belly fold so it sits on top. */}
        <path d={SMILE_PATH} className="oracle-frog-svg__smile" />

        {/* Eyes: two pink concentric ringed eyes on top of the
            body. The far eye (right in SVG) is bigger and more
            prominent — outer ring + middle ring + bright dot.
            The near eye (left in SVG) is smaller with an
            "@"-style swirl glint inside instead of a solid dot. */}
        <g className="oracle-frog-svg__eye oracle-frog-svg__eye--near">
          <circle cx="62" cy="56" r="13" className="oracle-frog-svg__eye-outer" />
          <circle cx="62" cy="56" r="7" className="oracle-frog-svg__eye-inner" />
          {/* Swirl glint — small ring slightly off-centre. */}
          <circle cx="64" cy="54" r="3" className="oracle-frog-svg__eye-glint" />
        </g>
        <g className="oracle-frog-svg__eye oracle-frog-svg__eye--far">
          <circle cx="120" cy="62" r="15" className="oracle-frog-svg__eye-outer" />
          <circle cx="120" cy="62" r="8" className="oracle-frog-svg__eye-inner" />
          <circle cx="120" cy="62" r="2.4" className="oracle-frog-svg__pupil" />
        </g>
      </g>
    </svg>
  );
}
