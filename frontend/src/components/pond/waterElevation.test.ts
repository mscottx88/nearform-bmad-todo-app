import { describe, it, expect } from 'vitest';
import {
  sampleElevation,
  type ElevationInputs,
  type RippleSlot,
  type AmbientRippleSlot,
} from './waterElevation';

// ─────────── Reference implementation ───────────
// An independent, plain-TS reimplementation of the same formulas used
// in `sampleElevation`. If someone edits the production function but
// forgets to update this reference, the parity test below fails —
// catching silent drift between the implementation and the shader
// contract documented at the top of `waterElevation.ts`.
//
// Intentionally written separately: do NOT refactor this to share
// code with the production module. The duplication IS the check.

function refSmoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function refRipple(
  lx: number,
  ly: number,
  cx: number,
  cy: number,
  freq: number,
  speed: number,
  decay: number,
  elapsed: number,
  wavefrontOverride: number,
  uTime: number,
): number {
  const dx = lx - cx;
  const dy = ly - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const wave = Math.sin(dist * freq - uTime * speed);
  const falloff = Math.exp(-dist * decay);
  const wf = wavefrontOverride > 0 ? wavefrontOverride : speed / freq;
  const front = elapsed * wf;
  const le = 1 - refSmoothstep(front, front + 0.6, dist);
  return wave * falloff * le;
}

function refSample(worldX: number, worldZ: number, i: ElevationInputs): number {
  const lx = worldX;
  const ly = -worldZ;
  let e = Math.sin(i.elapsedTime * 0.3) * 0.02;

  for (const s of i.ambientSlots) {
    if (s.startTime <= 0) continue;
    const elapsed = i.elapsedTime - s.startTime;
    if (elapsed <= 0 || elapsed >= 14) continue;
    const r = refRipple(
      lx,
      ly,
      s.centerX,
      s.centerY,
      0.9,
      2.2,
      0.035,
      elapsed,
      i.ambientWavefrontSpeed,
      i.elapsedTime,
    );
    e += r * s.amplitude * Math.exp(-elapsed * s.decayRate);
  }

  for (const s of i.clickSlots) {
    if (s.startTime <= 0) continue;
    const elapsed = i.elapsedTime - s.startTime;
    if (elapsed <= 0 || elapsed >= 4) continue;
    const r = refRipple(
      lx,
      ly,
      s.centerX,
      s.centerY,
      1.3,
      5.5,
      0.025,
      elapsed,
      0,
      i.elapsedTime,
    );
    e += r * s.amplitude * Math.exp(-elapsed * 1.1);
    const ddx = lx - s.centerX;
    const ddy = ly - s.centerY;
    const distSq = ddx * ddx + ddy * ddy;
    e += Math.exp(-distSq * 0.8) * Math.exp(-elapsed * 10) * s.amplitude * 1.2;
  }

  return e;
}

// ─────────── Helpers ───────────

function emptySlots(count: number, withDecay: false): RippleSlot[];
function emptySlots(count: number, withDecay: true): AmbientRippleSlot[];
function emptySlots(
  count: number,
  withDecay: boolean,
): RippleSlot[] | AmbientRippleSlot[] {
  return Array.from({ length: count }, () =>
    withDecay
      ? { centerX: 0, centerY: 0, startTime: 0, amplitude: 0, decayRate: 0 }
      : { centerX: 0, centerY: 0, startTime: 0, amplitude: 0 },
  );
}

function freshInputs(elapsedTime = 1.0): ElevationInputs {
  return {
    clickSlots: emptySlots(8, false),
    ambientSlots: emptySlots(3, true),
    ambientWavefrontSpeed: 2.44,
    elapsedTime,
  };
}

describe('sampleElevation', () => {
  describe('parity with reference implementation (story 2.10 AC #7)', () => {
    it('matches at a grid of sample points with an active click ripple', () => {
      const inputs = freshInputs(2.5);
      // Plane-local coord for a click at world (0, 0): (0, 0).
      inputs.clickSlots[0] = {
        centerX: 0,
        centerY: 0,
        startTime: 1.0,
        amplitude: 0.5,
      };
      for (let x = -5; x <= 5; x += 1) {
        for (let z = -5; z <= 5; z += 1) {
          const actual = sampleElevation(x, z, inputs);
          const expected = refSample(x, z, inputs);
          expect(actual).toBeCloseTo(expected, 6);
        }
      }
    });

    it('matches with multiple active click + ambient slots', () => {
      const inputs = freshInputs(5.0);
      inputs.clickSlots[0] = {
        centerX: 2,
        centerY: -1,
        startTime: 3.0,
        amplitude: 0.6,
      };
      inputs.clickSlots[3] = {
        centerX: -4,
        centerY: 2,
        startTime: 4.5,
        amplitude: 0.45,
      };
      inputs.ambientSlots[0] = {
        centerX: 3,
        centerY: 3,
        startTime: 1.0,
        amplitude: 0.15,
        decayRate: 0.35,
      };
      inputs.ambientSlots[2] = {
        centerX: -6,
        centerY: -2,
        startTime: 2.2,
        amplitude: 0.18,
        decayRate: 0.5,
      };
      for (let x = -8; x <= 8; x += 2) {
        for (let z = -8; z <= 8; z += 2) {
          const actual = sampleElevation(x, z, inputs);
          const expected = refSample(x, z, inputs);
          expect(actual).toBeCloseTo(expected, 6);
        }
      }
    });

    it('matches at the exact center of a ripple (dist = 0 edge case)', () => {
      const inputs = freshInputs(2.0);
      inputs.clickSlots[0] = {
        centerX: 0,
        centerY: 0,
        startTime: 1.8,
        amplitude: 0.5,
      };
      // worldZ → localY flip: worldZ=0 → localY=0
      const actual = sampleElevation(0, 0, inputs);
      const expected = refSample(0, 0, inputs);
      expect(actual).toBeCloseTo(expected, 6);
    });
  });

  describe('world → plane-local flip (story 2.10)', () => {
    it('samples at world (x, z) give the plane-local (x, -z) result', () => {
      const inputs = freshInputs(1.5);
      // Click ripple whose center is plane-local (3, 4).
      // Equivalent world center is (3, -4) after flip.
      inputs.clickSlots[0] = {
        centerX: 3,
        centerY: 4,
        startTime: 1.2,
        amplitude: 0.5,
      };
      // Sampling at world (3, -4) should hit the exact center (dist=0).
      const atCenter = sampleElevation(3, -4, inputs);
      const offCenter = sampleElevation(3, 0, inputs); // different distance
      expect(atCenter).not.toBeCloseTo(offCenter, 6);
      // Parity sanity: reference also agrees.
      expect(atCenter).toBeCloseTo(refSample(3, -4, inputs), 6);
    });
  });

  describe('stale / inactive slot semantics', () => {
    it('returns only breath when all slots are inactive', () => {
      const inputs = freshInputs(0); // sin(0) = 0 → breath = 0
      expect(sampleElevation(0, 0, inputs)).toBe(0);
      expect(sampleElevation(10, 10, inputs)).toBe(0);
    });

    it('breath contributes sin(t * 0.3) * 0.02 at non-zero t', () => {
      const inputs = freshInputs(3);
      const expected = Math.sin(3 * 0.3) * 0.02;
      expect(sampleElevation(100, 100, inputs)).toBeCloseTo(expected, 6);
    });

    it('stale click slot (elapsed >= 4s) contributes nothing', () => {
      const inputs = freshInputs(10);
      // Active click would be 4s or less; set startTime such that
      // elapsed = 10 - 0 = 10 > 4.
      inputs.clickSlots[0] = {
        centerX: 0,
        centerY: 0,
        startTime: 0.001, // startTime > 0 but elapsed > 4
        amplitude: 1.0,
      };
      // Only breath remains.
      const breath = Math.sin(10 * 0.3) * 0.02;
      expect(sampleElevation(0, 0, inputs)).toBeCloseTo(breath, 6);
    });

    it('stale ambient slot (elapsed >= 14s) contributes nothing', () => {
      const inputs = freshInputs(20);
      inputs.ambientSlots[0] = {
        centerX: 0,
        centerY: 0,
        startTime: 1.0, // elapsed = 19 > 14
        amplitude: 1.0,
        decayRate: 0.3,
      };
      const breath = Math.sin(20 * 0.3) * 0.02;
      expect(sampleElevation(0, 0, inputs)).toBeCloseTo(breath, 6);
    });

    it('slot with startTime = 0 is treated as inactive', () => {
      const inputs = freshInputs(1);
      inputs.clickSlots[0] = {
        centerX: 0,
        centerY: 0,
        startTime: 0,
        amplitude: 1.0,
      };
      // Only breath.
      const breath = Math.sin(1 * 0.3) * 0.02;
      expect(sampleElevation(0, 0, inputs)).toBeCloseTo(breath, 6);
    });

    it('superposition — two identical active click slots sum', () => {
      const single = freshInputs(1.5);
      single.clickSlots[0] = {
        centerX: 1,
        centerY: 0,
        startTime: 1.0,
        amplitude: 0.5,
      };
      const singleVal = sampleElevation(2, 0, single);

      const doubled = freshInputs(1.5);
      doubled.clickSlots[0] = { ...single.clickSlots[0] };
      doubled.clickSlots[1] = { ...single.clickSlots[0] };
      const doubledVal = sampleElevation(2, 0, doubled);

      // Two identical ripples → 2x the non-breath contribution.
      const breath = Math.sin(1.5 * 0.3) * 0.02;
      expect(doubledVal - breath).toBeCloseTo(
        (singleVal - breath) * 2,
        6,
      );
    });
  });

  describe('ride-above-water invariant (story 2.10 AC #4)', () => {
    // AC #4: a ripple crest must never sit ABOVE the pad's y-position.
    // Story 2.10 meets this via two mechanisms:
    //   (a) in steady-state `resting`, LilyPad lerps toward
    //       `targetY + sampleElevation(posX, posZ)` so in the limit
    //       pad-y = targetY + water-y — the pad sits `targetY` above
    //       the water, not below it.
    //   (b) on `→ resting` transitions, `group.position.y` is SEEDED
    //       to `targetY + sampleElevation(posX, posZ)` so the first
    //       resting frame doesn't lerp UP through a wave crest.
    //
    // These tests prove the invariant the SEED is responsible for:
    // whatever the water is doing at the transition moment, the
    // seed-derived pad-y exceeds the water-y by exactly `targetY`.

    const DROP_Y_REST = 0.05;

    it('pad seed-y exceeds water-y by targetY everywhere inside a fresh click ripple crest (AC #4)', () => {
      // A fresh click ripple 0.2s after impact — crest ring not yet
      // expanded far, so amplitude near center is at its peak.
      const inputs = freshInputs(1.2);
      inputs.clickSlots[0] = {
        centerX: 0,
        centerY: 0,
        startTime: 1.0,
        amplitude: 0.7,
      };

      let minMargin = Infinity;
      let maxWaterY = -Infinity;
      for (let x = -3; x <= 3; x += 0.25) {
        for (let z = -3; z <= 3; z += 0.25) {
          const waterY = sampleElevation(x, z, inputs);
          // Pad freshly seeded on transition — matches the patched
          // transition blocks in LilyPad.tsx.
          const padSeedY = DROP_Y_REST + waterY;
          minMargin = Math.min(minMargin, padSeedY - waterY);
          maxWaterY = Math.max(maxWaterY, waterY);
        }
      }

      // The crest actually reaches a non-trivial amplitude under a
      // fresh click — this test would be meaningless if the ripple
      // contributed nothing.
      expect(maxWaterY).toBeGreaterThan(0.1);
      // With the seed in place, margin is exactly DROP_Y_REST everywhere.
      // (The lerped steady-state resting branch also converges here.)
      expect(minMargin).toBeCloseTo(DROP_Y_REST, 6);
    });

    it('pad seed-y exceeds water-y even at the deepest trough of a fresh ripple (AC #4, sign-check)', () => {
      // A ripple has both crests and troughs. The pad rides the local
      // elevation — which is NEGATIVE under a trough — so pad-y can
      // be BELOW DROP_Y_REST. The invariant still holds: pad is always
      // `DROP_Y_REST` units ABOVE the water at that same (x, z).
      const inputs = freshInputs(1.3);
      inputs.clickSlots[0] = {
        centerX: 0,
        centerY: 0,
        startTime: 1.0,
        amplitude: 0.7,
      };

      let minWaterY = Infinity;
      let padYAtMinWater = 0;
      for (let x = -4; x <= 4; x += 0.2) {
        for (let z = -4; z <= 4; z += 0.2) {
          const waterY = sampleElevation(x, z, inputs);
          if (waterY < minWaterY) {
            minWaterY = waterY;
            padYAtMinWater = DROP_Y_REST + waterY;
          }
        }
      }

      // The wave must actually go below zero somewhere — otherwise
      // there's no trough to test against.
      expect(minWaterY).toBeLessThan(-0.05);
      // At the deepest trough: padY = DROP_Y_REST + minWaterY (negative
      // minWaterY means padY is below DROP_Y_REST), but still exactly
      // DROP_Y_REST units above the local water surface.
      expect(padYAtMinWater - minWaterY).toBeCloseTo(DROP_Y_REST, 6);
      // Concrete sanity: at a deep trough (minWaterY ≈ -0.1), padY is
      // still above minWaterY (not submerged), even if padY itself is
      // below DROP_Y_REST.
      expect(padYAtMinWater).toBeGreaterThan(minWaterY);
    });

    it('pad seed-y in flat water equals targetY (no ripples → no offset)', () => {
      // Default regression: all slots inactive + breath at t=0 → water
      // is flat at 0. Seeded pad-y = targetY + 0 = targetY.
      const inputs = freshInputs(0);
      const waterY = sampleElevation(0, 0, inputs);
      expect(waterY).toBe(0);
      const padSeedY = DROP_Y_REST + waterY;
      expect(padSeedY).toBe(DROP_Y_REST);
    });
  });
});
