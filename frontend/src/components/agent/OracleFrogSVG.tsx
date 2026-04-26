/**
 * Story 6.7: 2D animated Oracle Frog (SVG).
 *
 * Visual reference: a Budgett's frog (Lepidobatrachus laevis) — the
 * "It is Wednesday, my dudes" meme frog. Key anatomical traits the
 * silhouette is built around:
 *
 *   - massive round, slightly-flattened blob body (much wider than
 *     tall, with a soft rounded peak at the top of the back);
 *   - tiny eyes set ON TOP of the body, close together — Budgett's
 *     have NO neck, the face sits directly on top of the body;
 *   - a VERY wide mouth that runs nearly the full width of the
 *     body — the dominant facial feature, slightly downturned to
 *     read as a Budgett's "smirk";
 *   - jowl folds curving from the cheek down to the body sides;
 *   - tiny clawed front feet poking out at the bottom-front, with
 *     splayed toes;
 *   - tucked back haunches with toes visible at the sides.
 *
 * Rendered as a neon-outline drawing — strokes carry the form, fills
 * are mostly transparent. The whole SVG sits inside a CSS drop-
 * shadow filter for the project's signature neon glow.
 *
 * Animation per agentState (driven by `data-state` on the <svg>
 * + a chunk-pulse `key` remount on the throat ellipse):
 *
 *   - idle      → gentle breathing + occasional eye blink
 *   - listening → forward lean + eyes widen
 *   - thinking  → pupils track left/right
 *   - speaking  → throat-sac scale-pulses on each chunk arrival
 *   - success   → single upward hop
 *   - error     → horizontal shake + colour shift to red-orange
 */

import { useEffect, useState } from 'react';
import { useAgentStore } from '../../stores/useAgentStore';
import './OracleFrogSVG.css';

// Body silhouette — a closed cubic Bezier that traces the
// Budgett's-frog blob. Coordinates are tuned in a 200×150 viewBox.
//
// Path walks clockwise starting from the top-left "shoulder":
//   1. cubic up-and-over the rounded back (peak ~y=42, slight
//      asymmetry so the silhouette doesn't read as a perfect oval);
//   2. cubic down the right side, bulging out at the widest point
//      (~y=92);
//   3. quadratic across the bottom of the belly (sits ON the pad);
//   4. cubic back up the left side, mirroring step 2.
const BODY_PATH = [
  'M 52 64',
  'C 60 36, 140 36, 148 64',
  'C 178 76, 184 110, 162 122',
  'Q 132 134, 100 132',
  'Q 68 134, 38 122',
  'C 16 110, 22 76, 52 64',
  'Z',
].join(' ');

// Wide Budgett's mouth — runs almost the full width of the body,
// slightly downturned for the iconic "what" expression.
const MOUTH_PATH = 'M 38 100 Q 100 122 162 100';

// Jowl folds — a soft cheek-line curve on each side that gives the
// face its Budgett's-frog "doughy chin" character.
const JOWL_LEFT = 'M 32 80 Q 28 105 50 118';
const JOWL_RIGHT = 'M 168 80 Q 172 105 150 118';

// Toe strokes for the front feet (3 splayed toes per foot).
function FrontToes({ cx }: { cx: number }) {
  return (
    <g className="oracle-frog-svg__toes">
      <path d={`M ${cx - 5} 134 L ${cx - 7} 142`} />
      <path d={`M ${cx} 135 L ${cx} 144`} />
      <path d={`M ${cx + 5} 134 L ${cx + 7} 142`} />
    </g>
  );
}

// Toe strokes for the side-back feet.
function SideToes({ cx, dir }: { cx: number; dir: -1 | 1 }) {
  return (
    <g className="oracle-frog-svg__toes">
      <path d={`M ${cx} 122 L ${cx + dir * 6} 117`} />
      <path d={`M ${cx} 126 L ${cx + dir * 8} 124`} />
      <path d={`M ${cx} 130 L ${cx + dir * 7} 132`} />
    </g>
  );
}

export function OracleFrogSVG() {
  const agentState = useAgentStore((s) => s.agentState);
  const [throatPulse, setThroatPulse] = useState(0);

  // Each new chunk grows streamingBuffer; bump throatPulse so the
  // throat ellipse re-mounts and the CSS keyframe re-runs.
  useEffect(() => {
    let lastLen = useAgentStore.getState().streamingBuffer.length;
    const unsub = useAgentStore.subscribe((state) => {
      const len = state.streamingBuffer.length;
      if (len > lastLen) {
        setThroatPulse((n) => n + 1);
      }
      lastLen = len;
    });
    return unsub;
  }, []);

  return (
    <svg
      className="oracle-frog-svg"
      data-state={agentState}
      viewBox="0 0 200 165"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {/* ─── Lily pad disc ──────────────────────────────────── */}
      <g className="oracle-frog-svg__pad">
        <ellipse
          cx="100"
          cy="148"
          rx="86"
          ry="11"
          className="oracle-frog-svg__pad-fill"
        />
        <ellipse
          cx="100"
          cy="148"
          rx="86"
          ry="11"
          className="oracle-frog-svg__pad-rim"
        />
      </g>

      {/* ─── Whole-frog group ──────────────────────────────────
          Per user direction (2026-04-25): rotated 30° so the frog
          is "looking away" rather than facing the viewer head-on.
          The rotation is applied INSIDE the data-state animation
          parent via the `__rotate` wrapper so all the per-state
          tweaks (lean, hop, shake) compose on top of the base
          rotation cleanly. */}
      <g className="oracle-frog-svg__frog">
       <g className="oracle-frog-svg__rotate">
        {/* Back-side feet first so they sit BEHIND the body. */}
        <g className="oracle-frog-svg__foot oracle-frog-svg__foot--back-left">
          <ellipse cx="22" cy="124" rx="13" ry="7" />
          <SideToes cx={9} dir={-1} />
        </g>
        <g className="oracle-frog-svg__foot oracle-frog-svg__foot--back-right">
          <ellipse cx="178" cy="124" rx="13" ry="7" />
          <SideToes cx={191} dir={1} />
        </g>

        {/* Body silhouette — single closed path. */}
        <path d={BODY_PATH} className="oracle-frog-svg__body" />

        {/* Belly highlight — a soft inner curve giving the body a
            sense of volume (the lower-belly subtly catches light). */}
        <path
          d="M 50 110 Q 100 130 150 110"
          className="oracle-frog-svg__belly"
        />

        {/* Jowl folds — left + right cheek lines. */}
        <path d={JOWL_LEFT} className="oracle-frog-svg__jowl" />
        <path d={JOWL_RIGHT} className="oracle-frog-svg__jowl" />

        {/* Wide downturned mouth. */}
        <path d={MOUTH_PATH} className="oracle-frog-svg__mouth" />
        {/* Mouth corner emphasis — small flicks at the lip ends.
            Adds the Budgett's "smirk" character that a single
            curve alone can't quite carry. */}
        <path d="M 36 100 L 32 96" className="oracle-frog-svg__mouth-corner" />
        <path d="M 164 100 L 168 96" className="oracle-frog-svg__mouth-corner" />
        {/* Lower-lip line — second softer curve just below the
            mouth, suggests the lip's lower edge / chin shadow. */}
        <path
          d="M 50 105 Q 100 122 150 105"
          className="oracle-frog-svg__lower-lip"
        />
        {/* Tooth notch at the centre — Budgett's frogs have two
            tiny "fang" teeth visible when the mouth opens. Subtle
            here as a small downward tick. */}
        <path d="M 100 117 L 100 120" className="oracle-frog-svg__fang" />

        {/* Neck / chin fold lines — short curves under the jaw
            that emphasise the soft chin/neck transition. There's
            no actual neck on a Budgett's, but the fold lines read
            as the boundary between head and body. */}
        <path
          d="M 65 125 Q 100 132 135 125"
          className="oracle-frog-svg__neck-fold"
        />
        <path
          d="M 75 130 Q 100 135 125 130"
          className="oracle-frog-svg__neck-fold oracle-frog-svg__neck-fold--inner"
        />

        {/* Tiny nostrils above the mouth. */}
        <circle cx="93" cy="86" r="1.6" className="oracle-frog-svg__nostril" />
        <circle cx="107" cy="86" r="1.6" className="oracle-frog-svg__nostril" />

        {/* Throat sac — pulses on each chunk during 'speaking'.
            React `key` re-mount restarts the keyframe per chunk. */}
        <ellipse
          key={`throat-${throatPulse}`}
          cx="100"
          cy="118"
          rx="20"
          ry="6"
          className="oracle-frog-svg__throat"
        />

        {/* Eyes — tiny bulges set ON TOP of the body, close
            together (Budgett's signature "googly eyes peeking off
            the top"). Each eye is a group so the pupil can shift
            inside the eyeball during 'thinking'. */}
        <g className="oracle-frog-svg__eye oracle-frog-svg__eye--left">
          {/* Eyelid bulge — a small rounded dome on the head. */}
          <ellipse cx="82" cy="56" rx="12" ry="10" className="oracle-frog-svg__eye-bulge" />
          {/* Eyeball — small pale circle inside the bulge. */}
          <circle cx="82" cy="56" r="6.5" className="oracle-frog-svg__eye-ball" />
          {/* Pupil — large black centre dot. */}
          <circle cx="82" cy="56" r="3.4" className="oracle-frog-svg__pupil" />
          {/* Reflection highlight — tiny white speck for "alive" feel. */}
          <circle cx="83.5" cy="54" r="0.9" className="oracle-frog-svg__glint" />
        </g>
        <g className="oracle-frog-svg__eye oracle-frog-svg__eye--right">
          <ellipse cx="118" cy="56" rx="12" ry="10" className="oracle-frog-svg__eye-bulge" />
          <circle cx="118" cy="56" r="6.5" className="oracle-frog-svg__eye-ball" />
          <circle cx="118" cy="56" r="3.4" className="oracle-frog-svg__pupil" />
          <circle cx="119.5" cy="54" r="0.9" className="oracle-frog-svg__glint" />
        </g>

        {/* Front feet — tiny clawed peeks at the bottom front. */}
        <g className="oracle-frog-svg__foot oracle-frog-svg__foot--front-left">
          <ellipse cx="78" cy="135" rx="9" ry="5" />
          <FrontToes cx={78} />
        </g>
        <g className="oracle-frog-svg__foot oracle-frog-svg__foot--front-right">
          <ellipse cx="122" cy="135" rx="9" ry="5" />
          <FrontToes cx={122} />
        </g>
       </g>
      </g>
    </svg>
  );
}
