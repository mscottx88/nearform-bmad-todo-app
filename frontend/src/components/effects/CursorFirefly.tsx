/**
 * CursorFirefly — Neon wireframe firefly that follows the cursor.
 *
 * A glowing wireframe firefly with fluttering wings chases the mouse.
 * The firefly pulsates between neon green and neon yellow.
 * A trail of fading neon yellow glow dots lingers behind it.
 */

import { useEffect, useRef } from 'react';
import { usePondStore } from '../../stores/usePondStore';
import './CursorFirefly.css';

interface Point {
  x: number;
  y: number;
}

// Story 4.6 (user feedback 2026-04-23): frog-hand glyphs drawn in
// place of the firefly when the cursor is over a draggable affordance.
// Iter 4 matches a classic frog-footprint silhouette — four slim
// stick digits radiating from a tiny palm, each ending in a bulbous
// round toe-pad. No webbing (the reference doesn't show any). Neon
// green so the swap reads as a pond creature and stays distinct
// from the cyan cluster ring.
const GRAB_COLOR = '#39ff14';
const GRAB_SHADOW = 14;

// Helper: draw a single frog digit from a root point out to a tip,
// with the stem tapering into a bulbous round toe-pad. The reference
// image (2026-04-23 user feedback iter 4) has slim stick-stems and
// prominent bulb tips — that's the whole silhouette.
function drawFrogDigit(
  ctx: CanvasRenderingContext2D,
  rootX: number,
  rootY: number,
  tipX: number,
  tipY: number,
  tipRadius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(rootX, rootY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(tipX, tipY, tipRadius, 0, Math.PI * 2);
  ctx.fill();
  // Outline the bulb so bloom doesn't wash it out at high exposure.
  ctx.beginPath();
  ctx.arc(tipX, tipY, tipRadius, 0, Math.PI * 2);
  ctx.stroke();
}

function drawGrabHand(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = GRAB_COLOR;
  ctx.fillStyle = GRAB_COLOR;
  ctx.lineWidth = 2.0;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowBlur = GRAB_SHADOW;
  ctx.shadowColor = GRAB_COLOR;

  // Four digits fanning out like a starburst from a tiny palm — per
  // the reference: long slim stems with pronounced bulb toe-pads,
  // NO visible webbing, the palm barely peeks below the digit roots.
  const tips: Array<{ x: number; y: number }> = [
    { x: -22, y: -10 }, // far-left (nearly horizontal)
    { x: -9, y: -24 }, // left-center (tallest)
    { x: 9, y: -24 }, // right-center
    { x: 22, y: -10 }, // far-right
  ];
  const TIP_R = 3.5;

  // Tiny palm — just a small oval at the base. Sized so it reads as
  // a "toe-print" pad rather than a full hand.
  ctx.beginPath();
  ctx.ellipse(0, 3, 6, 4, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Draw each digit from a root on the palm oval's edge out to the
  // tip. Digit roots cluster at y ≈ -2 (palm top) and spread
  // slightly in x.
  const rootXs = [-4, -1.5, 1.5, 4];
  for (let i = 0; i < tips.length; i++) {
    const tip = tips[i]!;
    drawFrogDigit(ctx, rootXs[i]!, -2, tip.x, tip.y, TIP_R);
  }

  ctx.restore();
}

function drawPointingHand(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
): void {
  // Frog hand with the index digit extended — tracks the same neon
  // frog-aesthetic as `drawGrabHand` and `drawGrabbingFist`. Used for
  // hyperlink-style affordances (e.g. agent-message TodoLink) instead
  // of the browser's stock pointing-hand cursor, which would clash
  // with the project's custom-cursor design.
  //
  // CRITICAL: cursor hotspot convention — the index FINGERTIP is at
  // (cx, cy), the actual mouse position. We translate by (cx, cy + 28)
  // so the rest of the hand drops 28px below; the index tip drawn at
  // local (0, -28) lands exactly on the cursor coordinates. Without
  // this offset the user's mouse pointer would sit at the palm with
  // the fingertip floating 28px above their click point.
  ctx.save();
  ctx.translate(cx, cy + 28);
  ctx.strokeStyle = GRAB_COLOR;
  ctx.fillStyle = GRAB_COLOR;
  ctx.lineWidth = 2.0;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowBlur = GRAB_SHADOW;
  ctx.shadowColor = GRAB_COLOR;

  // Curled digits: 3 short stubs clustered toward the palm.
  const curled: Array<{ rx: number; ry: number; tx: number; ty: number }> = [
    { rx: -4, ry: -2, tx: -10, ty: -7 },
    { rx: 1.5, ry: -2, tx: 9, ty: -8 },
    { rx: 4, ry: -2, tx: 14, ty: -3 },
  ];
  const CURLED_TIP_R = 2.8;

  // Palm — same tiny oval as the open hand.
  ctx.beginPath();
  ctx.ellipse(0, 3, 6, 4, 0, 0, Math.PI * 2);
  ctx.stroke();

  for (const c of curled) {
    drawFrogDigit(ctx, c.rx, c.ry, c.tx, c.ty, CURLED_TIP_R);
  }

  // Extended index — long stem straight up from the palm, slightly
  // larger toe-pad so it reads as the "pointer". Tip lands at local
  // (0, -28), which is the cursor's hotspot after the translate
  // offset above.
  drawFrogDigit(ctx, -1.5, -2, 0, -28, 4.0);

  ctx.restore();
}


function drawTextCursor(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
): void {
  // Neon I-beam — vertical stem with short horizontal serifs at the
  // top and bottom. Used for text-input affordances (e.g. the chat
  // composer textarea) so the user gets a "you can type here" hint
  // without falling back to the OS cursor.
  //
  // Hotspot convention: dead-centre vertical, dead-centre horizontal —
  // matches the OS I-beam so click positioning feels native.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = '#00eeff'; /* --neon-cyan */
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.shadowBlur = 6;
  ctx.shadowColor = '#00eeff';
  // Vertical stem (10px each side of centre = 20px total).
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(0, 10);
  ctx.stroke();
  // Top serif.
  ctx.beginPath();
  ctx.moveTo(-4, -10);
  ctx.lineTo(4, -10);
  ctx.stroke();
  // Bottom serif.
  ctx.beginPath();
  ctx.moveTo(-4, 10);
  ctx.lineTo(4, 10);
  ctx.stroke();
  ctx.restore();
}


function drawResizeArrowsH(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
): void {
  // Story 6.9: neon double-arrow shown over the agent panel's resize
  // edge. A thin horizontal cyan rod with arrowhead tips at each end —
  // reads as "drag horizontally" the way the OS col-resize cursor
  // does, but in the project's neon vocabulary.
  //
  // Hotspot convention: dead centre of the rod (matches col-resize).
  const COLOR = '#00eeff'; /* --neon-cyan */
  const HALF_LEN = 11; // each arm extends 11px from centre → ~22px wide
  const HEAD_W = 5; // half-width of the arrowhead (vertical)
  const HEAD_D = 5; // depth of the arrowhead (horizontal inset from tip)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = COLOR;
  ctx.fillStyle = COLOR;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowBlur = 6;
  ctx.shadowColor = COLOR;
  // Horizontal rod between the two arrowhead inner points.
  ctx.beginPath();
  ctx.moveTo(-HALF_LEN + HEAD_D, 0);
  ctx.lineTo(HALF_LEN - HEAD_D, 0);
  ctx.stroke();
  // Left arrowhead — filled triangle with the tip at -HALF_LEN.
  ctx.beginPath();
  ctx.moveTo(-HALF_LEN, 0);
  ctx.lineTo(-HALF_LEN + HEAD_D, -HEAD_W);
  ctx.lineTo(-HALF_LEN + HEAD_D, HEAD_W);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Right arrowhead — filled triangle with the tip at +HALF_LEN.
  ctx.beginPath();
  ctx.moveTo(HALF_LEN, 0);
  ctx.lineTo(HALF_LEN - HEAD_D, -HEAD_W);
  ctx.lineTo(HALF_LEN - HEAD_D, HEAD_W);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}


function drawNoAccessCursor(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
): void {
  // Neon "no entry" glyph — circle with a diagonal slash through it.
  // Used for disabled / forbidden affordances (e.g. a TodoLink whose
  // referenced todo isn't loaded).
  //
  // Hotspot convention: dead centre of the circle. The circle is
  // sized small enough (radius 9) that it doesn't obscure the
  // underlying element while still reading as a clear deny gesture.
  const NO_ACCESS_COLOR = '#ff5050';
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = NO_ACCESS_COLOR;
  ctx.lineWidth = 2.0;
  ctx.lineCap = 'round';
  ctx.shadowBlur = 8;
  ctx.shadowColor = NO_ACCESS_COLOR;
  // Circle.
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.stroke();
  // Diagonal slash (top-left → bottom-right). 45° offset by sqrt(2)/2
  // so the slash terminates at the inside of the circle stroke.
  const r = 9 * 0.707;
  ctx.beginPath();
  ctx.moveTo(-r, -r);
  ctx.lineTo(r, r);
  ctx.stroke();
  ctx.restore();
}


function drawGrabbingFist(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = GRAB_COLOR;
  ctx.fillStyle = GRAB_COLOR;
  ctx.lineWidth = 2.0;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowBlur = GRAB_SHADOW;
  ctx.shadowColor = GRAB_COLOR;

  // Same 4-digit frog hand but CURLED inward — tips clustered near
  // the top, stems shorter and more upright, palm slightly more
  // prominent (fist base). No webbing, matching the open-hand
  // reference.
  const tips: Array<{ x: number; y: number }> = [
    { x: -10, y: -8 },
    { x: -3.5, y: -13 },
    { x: 3.5, y: -13 },
    { x: 10, y: -8 },
  ];
  const TIP_R = 3.0;

  // Fist base — a slightly larger oval than the grab's palm.
  ctx.beginPath();
  ctx.ellipse(0, 4, 7, 5, 0, 0, Math.PI * 2);
  ctx.stroke();

  const rootXs = [-3.5, -1.2, 1.2, 3.5];
  for (let i = 0; i < tips.length; i++) {
    const tip = tips[i]!;
    drawFrogDigit(ctx, rootXs[i]!, 0, tip.x, tip.y, TIP_R);
  }

  ctx.restore();
}

const TRAIL_LENGTH: number = 12;
const HEAD_LERP: number = 0.15;
const NODE_LERP: number = 0.25;
const SHADOW_BLUR: number = 12;

const FIREFLY_GREEN: string = '#39ff14';
const FIREFLY_YELLOW: string = '#eeff00';
const TRAIL_COLOR: string = FIREFLY_YELLOW;

const HEADING_LERP: number = 0.12;
const OFF_SCREEN: number = -2000;

function lerpAngle(from: number, to: number, t: number): number {
  let diff = to - from;
  // Normalize to [-PI, PI] so we always rotate the short way
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
}

function lerpColor(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

function drawFirefly(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  frame: number,
  color: string,
  heading: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(heading);

  const wingFlutter = Math.sin(frame * 0.15) * 0.35;

  // -- Body: elongated oval --
  ctx.beginPath();
  ctx.ellipse(0, 0, 6, 3, 0, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.shadowBlur = SHADOW_BLUR;
  ctx.shadowColor = color;
  ctx.stroke();

  // -- Upper wings --
  ctx.save();
  ctx.rotate(wingFlutter);
  ctx.beginPath();
  ctx.ellipse(-3, -6, 7.5, 4.5, -0.3, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  ctx.shadowBlur = SHADOW_BLUR * 0.8;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-3, 6, 7.5, 4.5, 0.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // -- Lower wings (smaller, flutter offset) --
  ctx.save();
  ctx.rotate(-wingFlutter * 0.7);
  ctx.beginPath();
  ctx.ellipse(0, -4.5, 5, 3, -0.2, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.6;
  ctx.shadowBlur = SHADOW_BLUR * 0.6;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 4.5, 5, 3, 0.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // -- Abdomen glow (the "lightning" part) --
  const glowPulse = 0.6 + Math.sin(frame * 0.08) * 0.4;
  ctx.beginPath();
  ctx.arc(4.5, 0, 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = glowPulse;
  ctx.shadowBlur = SHADOW_BLUR * 2.5;
  ctx.shadowColor = color;
  ctx.fill();

  // Extra glow layer
  ctx.globalAlpha = glowPulse * 0.4;
  ctx.shadowBlur = SHADOW_BLUR * 4;
  ctx.fill();

  ctx.restore();
}

export function CursorFirefly() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mousePosRef = useRef<Point>({ x: OFF_SCREEN, y: OFF_SCREEN });
  const nodesRef = useRef<Point[]>(
    Array.from({ length: TRAIL_LENGTH }, (): Point => ({ x: OFF_SCREEN, y: OFF_SCREEN }))
  );
  const rafRef = useRef<number>(0);
  const frameRef = useRef<number>(0);
  const prevHeadRef = useRef<Point>({ x: OFF_SCREEN, y: OFF_SCREEN });
  const headingRef = useRef<number>(0);
  const mouseSeenRef = useRef<boolean>(false);

  useEffect(() => {
    const canvas: HTMLCanvasElement | null = canvasRef.current;
    if (!canvas) return;

    // Story 6.2 Group C CR P2 + P3: re-read `devicePixelRatio` on every
    // resize (multi-monitor drag, page zoom on Chromium both mutate it
    // mid-session) and reset the transform matrix before re-applying
    // the DPR scale so successive resizes don't compound scale onto
    // an already-scaled context.
    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      const c = canvas.getContext('2d');
      if (c) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.scale(dpr, dpr);
      }
    };
    resize();
    window.addEventListener('resize', resize);

    const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
    if (!ctx) return;
    // No second scale here — `resize()` above already established the
    // DPR transform on the same context. Calling `ctx.scale(dpr, dpr)`
    // a second time at mount used to compound the scale to dpr².

    const onMove = (e: { clientX: number; clientY: number }): void => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };
      if (!mouseSeenRef.current) {
        for (const node of nodesRef.current) {
          node.x = e.clientX;
          node.y = e.clientY;
        }
        prevHeadRef.current = { x: e.clientX, y: e.clientY };
        mouseSeenRef.current = true;
      }
    };

    const onLeave = (): void => {
      mouseSeenRef.current = false;
      mousePosRef.current = { x: OFF_SCREEN, y: OFF_SCREEN };
      for (const node of nodesRef.current) {
        node.x = OFF_SCREEN;
        node.y = OFF_SCREEN;
      }
      prevHeadRef.current = { x: OFF_SCREEN, y: OFF_SCREEN };
    };

    window.addEventListener('mousemove', onMove);
    // Story 6.9: also listen to pointermove. When an element calls
    // `setPointerCapture` (the agent-panel resize handle does this for
    // robust drag tracking), some browsers stop emitting compatibility
    // mousemove events on `window`, which froze the firefly cursor in
    // place during the drag. PointerEvent and MouseEvent share the
    // same `clientX/Y` shape so the same handler works for both, and
    // both feeding the same ref is idempotent for redundant events.
    window.addEventListener('pointermove', onMove);
    document.addEventListener('mouseleave', onLeave);

    const draw = (): void => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      if (!mouseSeenRef.current) { rafRef.current = requestAnimationFrame(draw); return; }

      const mouse: Point = mousePosRef.current;
      const nodes: Point[] = nodesRef.current;

      // Story 4.6 (user feedback 2026-04-23): when over the cluster
      // drag handle, swap the firefly for a neon green frog-hand
      // glyph at the head, AND tint the existing trail green. The
      // node/trail update runs unconditionally so the frog hand has
      // the same lingering trail when moved — user feedback "should
      // leave a trail when moved".
      const mode = usePondStore.getState().cursorMode;

      // 1. Update positions via lerp
      nodes[0]!.x += (mouse.x - nodes[0]!.x) * HEAD_LERP;
      nodes[0]!.y += (mouse.y - nodes[0]!.y) * HEAD_LERP;

      for (let i: number = 1; i < TRAIL_LENGTH; i++) {
        nodes[i]!.x += (nodes[i - 1]!.x - nodes[i]!.x) * NODE_LERP;
        nodes[i]!.y += (nodes[i - 1]!.y - nodes[i]!.y) * NODE_LERP;
      }

      // 2. Track head movement for heading
      const hdx: number = nodes[0]!.x - prevHeadRef.current.x;
      const hdy: number = nodes[0]!.y - prevHeadRef.current.y;
      prevHeadRef.current = { x: nodes[0]!.x, y: nodes[0]!.y };

      frameRef.current += 1;

      // 3. Pulsate firefly color between green and yellow
      const pulse: number = (Math.sin(frameRef.current * 0.06) + 1) * 0.5;
      const fireflyColor: string = lerpColor(FIREFLY_GREEN, FIREFLY_YELLOW, pulse);

      // 4. Smoothly rotate toward movement direction
      const targetHeading: number = Math.atan2(hdy, hdx);
      const headDist: number = Math.sqrt(hdx * hdx + hdy * hdy);
      // Only update target when actually moving (avoid snapping to 0 when idle)
      if (headDist > 0.5) {
        headingRef.current = lerpAngle(headingRef.current, targetHeading, HEADING_LERP);
      }
      const heading: number = headingRef.current;

      // 5. Draw the trail. Colour follows the head-glyph family:
      //    firefly → yellow (default), frog-hand modes → neon green,
      //    text → cyan, no-access → red. Keeping the trail in the
      //    same hue as the head glyph reads as a single coherent
      //    cursor object instead of a hue-mismatched trail.
      let trailColor: string;
      if (mode === 'text' || mode === 'resize-h') {
        // Story 6.9: resize-h is cyan-themed too — same trail hue
        // keeps the cursor object reading as one coherent shape.
        trailColor = '#00eeff';
      } else if (mode === 'no-access') {
        trailColor = '#ff5050';
      } else if (mode === 'firefly') {
        trailColor = TRAIL_COLOR;
      } else {
        trailColor = GRAB_COLOR;
      }
      for (let i: number = 1; i < TRAIL_LENGTH; i++) {
        const t: number = i / TRAIL_LENGTH;
        const alpha: number = (1 - t) * 0.85;
        const dotSize: number = (1 - t) * 5;
        const dotPulse: number = 0.7 + Math.sin(frameRef.current * 0.1 + i * 0.5) * 0.3;

        ctx.save();
        ctx.globalAlpha = alpha * dotPulse;
        ctx.fillStyle = trailColor;
        ctx.shadowBlur = SHADOW_BLUR * (1 - t);
        ctx.shadowColor = trailColor;
        ctx.beginPath();
        ctx.arc(nodes[i]!.x, nodes[i]!.y, dotSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 6. Draw head glyph — firefly by default, frog-hand when the
      //    cluster drag handle is hovered / being dragged, frog
      //    pointing-finger when over a link, neon I-beam over text
      //    inputs, and a "no entry" glyph for disabled affordances.
      if (mode === 'grab') {
        drawGrabHand(ctx, nodes[0]!.x, nodes[0]!.y);
      } else if (mode === 'grabbing') {
        drawGrabbingFist(ctx, nodes[0]!.x, nodes[0]!.y);
      } else if (mode === 'point') {
        drawPointingHand(ctx, nodes[0]!.x, nodes[0]!.y);
      } else if (mode === 'text') {
        drawTextCursor(ctx, nodes[0]!.x, nodes[0]!.y);
      } else if (mode === 'no-access') {
        drawNoAccessCursor(ctx, nodes[0]!.x, nodes[0]!.y);
      } else if (mode === 'resize-h') {
        drawResizeArrowsH(ctx, nodes[0]!.x, nodes[0]!.y);
      } else {
        drawFirefly(ctx, nodes[0]!.x, nodes[0]!.y, frameRef.current, fireflyColor, heading);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return (): void => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', resize);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="cursor-firefly-canvas" aria-hidden="true" />;
}
