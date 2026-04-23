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
// Webbed digits + bulbous fingertips match the pond theme. Neon-green
// so the frog reference reads immediately and the swap is visually
// distinct from the cyan cluster ring.
const GRAB_COLOR = '#39ff14';
const GRAB_WEB_COLOR = 'rgba(57, 255, 20, 0.28)';
const GRAB_SHADOW = 14;

function drawGrabHand(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = GRAB_COLOR;
  ctx.fillStyle = GRAB_WEB_COLOR;
  ctx.lineWidth = 2.0;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowBlur = GRAB_SHADOW;
  ctx.shadowColor = GRAB_COLOR;

  // Three digits splayed in a fan above the palm. User feedback
  // 2026-04-23 (2nd round): "bigger + three fingers". Scale is
  // ~1.8× the previous four-digit version so the hand reads clearly
  // at a glance. Each digit is a stem ending in a bulbous toe-pad
  // (frog fingertips) — cartoon frogs are typically drawn with
  // three visible digits, matching the spec.
  const tips: Array<{ x: number; y: number }> = [
    { x: -14, y: -10 },
    { x: 0, y: -18 },
    { x: 14, y: -10 },
  ];
  const palmTop = -2;

  // Webbing: one filled blob whose outline tracks up to each digit
  // tip, then scallops back down between tips. Drawn FIRST so the
  // digit strokes + toe pads sit on top.
  ctx.beginPath();
  ctx.moveTo(-13, palmTop);
  for (let i = 0; i < tips.length; i++) {
    const tip = tips[i]!;
    ctx.lineTo(tip.x, tip.y);
    if (i < tips.length - 1) {
      const next = tips[i + 1]!;
      const midX = (tip.x + next.x) / 2;
      const midY = Math.max(tip.y, next.y) + 6;
      ctx.quadraticCurveTo(midX, midY, next.x, next.y);
    }
  }
  ctx.lineTo(13, palmTop);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Palm: rounded base below the digit roots.
  ctx.beginPath();
  ctx.moveTo(-13, palmTop);
  ctx.quadraticCurveTo(-15, palmTop + 11, -7, palmTop + 15);
  ctx.lineTo(7, palmTop + 15);
  ctx.quadraticCurveTo(15, palmTop + 11, 13, palmTop);
  ctx.stroke();

  // Toe pads — bulbous tips. Filled with solid cyan (vs the faint
  // webbing fill) so they pop as sticky fingertips.
  ctx.fillStyle = GRAB_COLOR;
  for (const tip of tips) {
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

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
  ctx.fillStyle = GRAB_WEB_COLOR;
  ctx.lineWidth = 2.0;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowBlur = GRAB_SHADOW;
  ctx.shadowColor = GRAB_COLOR;

  // Curled three-digit frog hand. Scaled ~1.8× with room for three
  // curled digit ridges instead of four. Wider at the base (palm),
  // tapered at the top where the digits tuck under.
  ctx.beginPath();
  ctx.moveTo(-13, 8);
  ctx.quadraticCurveTo(-17, -4, -8, -12);
  ctx.quadraticCurveTo(0, -15, 8, -12);
  ctx.quadraticCurveTo(17, -4, 13, 8);
  ctx.quadraticCurveTo(6, 13, 0, 13);
  ctx.quadraticCurveTo(-6, 13, -13, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Three curled-digit ridges along the top of the fist.
  for (let i = 0; i < 3; i++) {
    const y = -4 + i * 3.5;
    ctx.beginPath();
    ctx.moveTo(-7, y);
    ctx.quadraticCurveTo(0, y - 2.5, 7, y);
    ctx.stroke();
  }

  // Toe pads peeking out at the curl front — three dots matching
  // the three digits.
  ctx.fillStyle = GRAB_COLOR;
  for (const tx of [-6, 0, 6]) {
    ctx.beginPath();
    ctx.arc(tx, -8, 2.2, 0, Math.PI * 2);
    ctx.fill();
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

    const dpr = window.devicePixelRatio || 1;
    const resize = (): void => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      const c = canvas.getContext('2d');
      if (c) c.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const onMove = (e: MouseEvent): void => {
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

      // 5. Draw the trail. Colour swaps to neon green when in grab /
      //    grabbing mode so the frog hand leaves a green trail
      //    instead of the firefly's yellow (user feedback 2026-04-23).
      const trailColor = mode === 'firefly' ? TRAIL_COLOR : GRAB_COLOR;
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
      //    cluster drag handle is hovered / being dragged.
      if (mode === 'grab') {
        drawGrabHand(ctx, nodes[0]!.x, nodes[0]!.y);
      } else if (mode === 'grabbing') {
        drawGrabbingFist(ctx, nodes[0]!.x, nodes[0]!.y);
      } else {
        drawFirefly(ctx, nodes[0]!.x, nodes[0]!.y, frameRef.current, fireflyColor, heading);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return (): void => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('resize', resize);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="cursor-firefly-canvas" aria-hidden="true" />;
}
