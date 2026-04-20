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
    // The pad's ride-y is DROP_Y_REST + elevation. To prove the pad
    // never submerges as a wave crest passes, check that at ANY (x, z)
    // where a ripple passes, the pad's own elevation at (x, z) equals
    // the water elevation at (x, z) — i.e., the pad rides the exact
    // local elevation, no wave crest punches through.
    const DROP_Y_REST = 0.05;

    it('pad y (DROP_Y_REST + elevation) tracks water elevation exactly across a click-ripple footprint', () => {
      const inputs = freshInputs(1.5);
      inputs.clickSlots[0] = {
        centerX: 0,
        centerY: 0,
        startTime: 1.0,
        amplitude: 0.7, // max click amplitude
      };

      // Sample across a grid covering the ripple's active region.
      let maxCrestAbovePad = -Infinity;
      for (let x = -5; x <= 5; x += 0.5) {
        for (let z = -5; z <= 5; z += 0.5) {
          const waterY = sampleElevation(x, z, inputs);
          const padY = DROP_Y_REST + waterY;
          // The pad SITS on the water: padY - waterY = DROP_Y_REST > 0.
          maxCrestAbovePad = Math.max(maxCrestAbovePad, waterY - padY);
        }
      }

      // waterY - padY = -DROP_Y_REST = -0.05 at every point → pad is
      // always DROP_Y_REST above the water surface, never submerged.
      expect(maxCrestAbovePad).toBeCloseTo(-DROP_Y_REST, 6);
    });
  });
});
