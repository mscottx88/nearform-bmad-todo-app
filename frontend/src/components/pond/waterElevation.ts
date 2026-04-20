// Story 2.10: pure TS mirror of the water-surface vertex shader's
// elevation math. Called by LilyPad.useFrame to make pads ride the
// water at their (x, z) position.
//
// ============================================================
// PARITY INVARIANT — READ BEFORE EDITING
// ============================================================
// This file and the vertex shader in `WaterSurface.tsx` MUST
// compute the same elevation for a given (worldX, worldZ, t, slot-state)
// tuple. If you tune one, tune the other in the same commit. The
// parity unit test at `waterElevation.test.ts` runs a grid of sample
// points and catches divergence — run it after ANY ripple-math edit.
// ============================================================
//
// COORDINATE NOTE
// ---------------
// The WaterSurface mesh is rotated -90° about X, so world-Z maps to
// plane-local -Y. Ripple slot `centerX`/`centerY` values are stored
// in PLANE-LOCAL coords (WaterSurface.useFrame does the flip when it
// writes the uniforms: `centers[slot].set(worldX, -worldZ)`). This
// module accepts WORLD coords for the caller's convenience and does
// the world→local flip internally — callers pass `(worldX, worldZ)`.
//
// Shader reference: see `vertexShader` in `WaterSurface.tsx`, the
// `ripple()` function and the `void main()` elevation accumulation.

export interface RippleSlot {
  /** Plane-local X (matches uDropCenter[i].x / uAmbientCenter[i].x). */
  centerX: number;
  /** Plane-local Y (matches uDropCenter[i].y / uAmbientCenter[i].y). */
  centerY: number;
  /** R3F-clock start time (matches uDropTime[i] / uAmbientTime[i]). */
  startTime: number;
  /** Per-ripple amplitude (matches uDropAmplitude[i] / uAmbientAmplitude[i]). */
  amplitude: number;
}

export interface AmbientRippleSlot extends RippleSlot {
  /** Per-ripple decay rate (matches uAmbientDecayRate[i]). */
  decayRate: number;
}

export interface ElevationInputs {
  clickSlots: RippleSlot[];
  ambientSlots: AmbientRippleSlot[];
  /** Matches `uAmbientWavefrontSpeed` uniform. */
  ambientWavefrontSpeed: number;
  /** Matches `uTime` uniform — R3F clock elapsedTime. */
  elapsedTime: number;
}

// ─────────── Math helpers ───────────

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Mirror of GLSL `ripple()` in WaterSurface.tsx. Returns the per-slot
// elevation contribution before fade/amplitude modulation.
function ripple(
  localX: number,
  localY: number,
  centerX: number,
  centerY: number,
  freq: number,
  speed: number,
  decay: number,
  elapsed: number,
  wavefrontOverride: number,
  uTime: number,
): number {
  const dx = localX - centerX;
  const dy = localY - centerY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const wave = Math.sin(dist * freq - uTime * speed);
  const falloff = Math.exp(-dist * decay);
  const wavefrontSpeed =
    wavefrontOverride > 0.0 ? wavefrontOverride : speed / freq;
  const front = elapsed * wavefrontSpeed;
  const leadingEdge = 1.0 - smoothstep(front, front + 0.6, dist);
  return wave * falloff * leadingEdge;
}

// ─────────── Public API ───────────

/**
 * Sample the water surface elevation at a world-space (x, z) point.
 * Mirrors the vertex shader's elevation accumulation in WaterSurface.tsx.
 *
 * @param worldX  World-space X.
 * @param worldZ  World-space Z — converted to plane-local -Y internally.
 * @param inputs  Current ripple-slot state + R3F elapsedTime.
 * @returns       Elevation in world units. Positive = crest, negative = trough.
 */
export function sampleElevation(
  worldX: number,
  worldZ: number,
  inputs: ElevationInputs,
): number {
  // World (x, z) → plane-local (x, y). See COORDINATE NOTE above.
  const localX = worldX;
  const localY = -worldZ;
  const { elapsedTime, ambientWavefrontSpeed } = inputs;

  // Breath: always-on background oscillation. Matches `float breath =
  // sin(uTime * 0.3) * 0.02` in the shader.
  let elevation = Math.sin(elapsedTime * 0.3) * 0.02;

  // Ambient ripples — slower, languid, with an explicit wavefront
  // speed override (deliberately-slower-than-the-wave). Matches the
  // shader's ambient loop.
  const ambientSlots = inputs.ambientSlots;
  for (let i = 0; i < ambientSlots.length; i++) {
    const slot = ambientSlots[i];
    const t0 = slot.startTime;
    if (t0 <= 0.0) continue;
    const elapsed = elapsedTime - t0;
    if (elapsed <= 0.0 || elapsed >= 14.0) continue;
    const r = ripple(
      localX,
      localY,
      slot.centerX,
      slot.centerY,
      0.9, // freq — mirrors shader ambient call
      2.2, // speed
      0.035, // decay
      elapsed,
      ambientWavefrontSpeed,
      elapsedTime,
    );
    const fade = Math.exp(-elapsed * slot.decayRate);
    elevation += r * slot.amplitude * fade;
  }

  // Click ripples — fast expanding wavefront (derived from speed/freq
  // via wavefrontOverride=0.0) plus a central splash pulse. Matches
  // the shader's click loop.
  const clickSlots = inputs.clickSlots;
  for (let i = 0; i < clickSlots.length; i++) {
    const slot = clickSlots[i];
    const dropT0 = slot.startTime;
    if (dropT0 <= 0.0) continue;
    const dropElapsed = elapsedTime - dropT0;
    if (dropElapsed <= 0.0 || dropElapsed >= 4.0) continue;

    const centerX = slot.centerX;
    const centerY = slot.centerY;
    const amp = slot.amplitude;

    const dropRippleVal = ripple(
      localX,
      localY,
      centerX,
      centerY,
      1.3,
      5.5,
      0.025,
      dropElapsed,
      0.0,
      elapsedTime,
    );
    const dropFade = Math.exp(-dropElapsed * 1.1);
    elevation += dropRippleVal * amp * dropFade;

    // Central splash punch — tight Gaussian × fast exponential decay.
    // Matches the shader's `splash = exp(-dropDist² * 0.8) * exp(-dropElapsed * 10)`.
    const ddx = localX - centerX;
    const ddy = localY - centerY;
    const dropDistSq = ddx * ddx + ddy * ddy;
    const splash =
      Math.exp(-dropDistSq * 0.8) * Math.exp(-dropElapsed * 10.0);
    elevation += splash * amp * 1.2;
  }

  return elevation;
}
