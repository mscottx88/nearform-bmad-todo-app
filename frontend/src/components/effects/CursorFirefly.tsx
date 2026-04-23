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
// Webbed digits + bulbous fingertips match the pond theme; neon-cyan
// so the mode switch reads as "this is a cluster affordance".
const GRAB_COLOR = '#00eeff';
const GRAB_WEB_COLOR = 'rgba(0, 238, 255, 0.28)';
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
  ctx.lineWidth = 1.3;
  ctx.lineJoin = 'round';
  ctx.shadowBlur = GRAB_SHADOW;
  ctx.shadowColor = GRAB_COLOR;

  // Four finger tip positions — splayed fan above the palm. Each
  // finger is a short stem ending in a round toe-pad (frog digits
  // have bulbous tips for sticking). Thumb is absent on a frog's
  // front hand; four digits is correct anatomy.
  const tips: Array<{ x: number; y: number }> = [
    { x: -8, y: -5 },
    { x: -3, y: -10 },
    { x: 3, y: -10 },
    { x: 8, y: -5 },
  ];
  const palmTop = -1;

  // Webbing: one filled blob spanning all four digit roots and
  // rising toward the tips. Drawn FIRST so the digit strokes sit on
  // top. Quadratic curves through tip positions give the webbing its
  // characteristic scalloped edge.
  ctx.beginPath();
  ctx.moveTo(-7, palmTop);
  for (let i = 0; i < tips.length; i++) {
    const tip = tips[i]!;
    ctx.lineTo(tip.x, tip.y);
    if (i < tips.length - 1) {
      const next = tips[i + 1]!;
      // Dip between fingers — web scallop
      const midX = (tip.x + next.x) / 2;
      const midY = Math.max(tip.y, next.y) + 2.5;
      ctx.quadraticCurveTo(midX, midY, next.x, next.y);
    }
  }
  ctx.lineTo(7, palmTop);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Palm: rounded base below the digit roots.
  ctx.beginPath();
  ctx.moveTo(-7, palmTop);
  ctx.quadraticCurveTo(-8, palmTop + 6, -4, palmTop + 8);
  ctx.lineTo(4, palmTop + 8);
  ctx.quadraticCurveTo(8, palmTop + 6, 7, palmTop);
  ctx.stroke();

  // Toe pads — bulbous tips. Filled with solid cyan (vs the faint
  // webbing fill) so they pop as sticky fingertips.
  ctx.fillStyle = GRAB_COLOR;
  for (const tip of tips) {
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 1.5, 0, Math.PI * 2);
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
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  ctx.shadowBlur = GRAB_SHADOW;
  ctx.shadowColor = GRAB_COLOR;

  // Curled frog hand — a leaf-shaped blob with the fingers tucked
  // under. Wider at the base (palm), tapered at the top (curled
  // fingers).
  ctx.beginPath();
  ctx.moveTo(-7, 4);
  ctx.quadraticCurveTo(-9, -2, -4, -6);
  ctx.quadraticCurveTo(0, -8, 4, -6);
  ctx.quadraticCurveTo(9, -2, 7, 4);
  ctx.quadraticCurveTo(3, 7, 0, 7);
  ctx.quadraticCurveTo(-3, 7, -7, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Curled-finger ridges — three arcs along the top of the fist.
  for (let i = 0; i < 3; i++) {
    const y = -2 + i * 2;
    ctx.beginPath();
    ctx.moveTo(-3.5, y);
    ctx.quadraticCurveTo(0, y - 1.5, 3.5, y);
    ctx.stroke();
  }

  // Toe pads peeking out at the curl front — two small dots.
  ctx.fillStyle = GRAB_COLOR;
  ctx.beginPath();
  ctx.arc(-2, -4.5, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(2, -4.5, 1.2, 0, Math.PI * 2);
  ctx.fill();

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
      // drag handle, swap the firefly for a neon grip / fist glyph.
      // Read imperatively (not as a subscription) so the RAF loop
      // doesn't restart on every mode change.
      const mode = usePondStore.getState().cursorMode;
      if (mode !== 'firefly') {
        if (mode === 'grab') {
          drawGrabHand(ctx, mouse.x, mouse.y);
        } else {
          drawGrabbingFist(ctx, mouse.x, mouse.y);
        }
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

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

      // 5. Draw neon yellow glow trail
      for (let i: number = 1; i < TRAIL_LENGTH; i++) {
        const t: number = i / TRAIL_LENGTH;
        const alpha: number = (1 - t) * 0.85;
        const dotSize: number = (1 - t) * 5;
        const dotPulse: number = 0.7 + Math.sin(frameRef.current * 0.1 + i * 0.5) * 0.3;

        ctx.save();
        ctx.globalAlpha = alpha * dotPulse;
        ctx.fillStyle = TRAIL_COLOR;
        ctx.shadowBlur = SHADOW_BLUR * (1 - t);
        ctx.shadowColor = TRAIL_COLOR;
        ctx.beginPath();
        ctx.arc(nodes[i]!.x, nodes[i]!.y, dotSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 6. Draw firefly at head position
      drawFirefly(ctx, nodes[0]!.x, nodes[0]!.y, frameRef.current, fireflyColor, heading);

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
