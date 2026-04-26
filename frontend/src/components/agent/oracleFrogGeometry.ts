/**
 * Story 6.7: shared geometry helpers for the Oracle Frog mesh.
 *
 * Pulled out of `OracleFrog.tsx` so tests can call the constructors
 * directly (no need to render through React Three Fiber to assert
 * `instanceof CatmullRomCurve3` / `instanceof TubeGeometry`).
 *
 * Each helper allocates fresh Three.js objects per call; OracleFrog
 * memoises the result with `useMemo` and never re-creates it during
 * a frame.
 */

import * as THREE from 'three';

/**
 * Roughly hand-tuned silhouette control points for the frog outline.
 *
 * Coordinates are in the frog's local space (x = side, y = up,
 * z = front-back). The curve is closed, so the path returns to the
 * starting point — points are ordered clockwise starting at the top
 * of the head.
 *
 * 14 points hits the ~12-20 target in the AC and gives the
 * Catmull-Rom interpolation enough hints to read as a recognisable
 * frog silhouette without becoming noisy.
 */
export const FROG_OUTLINE_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [0.0, 0.32, 0.42], // top of head, front
  [0.18, 0.30, 0.30], // right cheek
  [0.32, 0.20, 0.10], // right shoulder
  [0.40, 0.10, -0.10], // right hip / haunch
  [0.30, 0.05, -0.30], // right knee bulge
  [0.12, 0.04, -0.42], // right rear toe
  [0.0, 0.04, -0.45], // tail (back centre)
  [-0.12, 0.04, -0.42], // left rear toe
  [-0.30, 0.05, -0.30], // left knee bulge
  [-0.40, 0.10, -0.10], // left hip
  [-0.32, 0.20, 0.10], // left shoulder
  [-0.18, 0.30, 0.30], // left cheek
  [0.0, 0.34, 0.40], // chin / front-of-head sweep
];

export interface FrogOutlineGeometry {
  curve: THREE.CatmullRomCurve3;
  tube: THREE.TubeGeometry;
}

/**
 * Builds the closed outline curve + tube geometry per AC 1.
 *
 * Defaults match the AC values: 64 tubular segments, 0.012 radius,
 * 6 radial segments, closed.
 */
export function createFrogOutlineGeometry(
  options: {
    tubularSegments?: number;
    radius?: number;
    radialSegments?: number;
  } = {},
): FrogOutlineGeometry {
  const tubularSegments = options.tubularSegments ?? 64;
  const radius = options.radius ?? 0.012;
  const radialSegments = options.radialSegments ?? 6;
  const points = FROG_OUTLINE_POINTS.map(
    ([x, y, z]) => new THREE.Vector3(x, y, z),
  );
  const curve = new THREE.CatmullRomCurve3(points, /*closed*/ true);
  const tube = new THREE.TubeGeometry(
    curve,
    tubularSegments,
    radius,
    radialSegments,
    /*closed*/ true,
  );
  return { curve, tube };
}

/**
 * Per-state emissive intensity values for the frog body.
 *
 * Centralised here so tests can assert without duplicating the
 * AC-defined numbers, and so the OracleFrog component reads them
 * from a single named constant rather than scattering numeric
 * literals across the useFrame body.
 */
export const FROG_EMISSIVE_INTENSITY = {
  idle: 0.4,
  listening: 0.55,
  thinking: 0.7,
  speaking: 0.85,
  // 'success' briefly flashes to 1.2 then decays to 0.4 — see
  // OracleFrog.tsx for the per-frame ramp; the table value is the
  // target during the 200ms decay tail (matches idle).
  success: 1.2,
  // 'error' shifts the emissive *colour* toward red-orange at this
  // intensity for ~1500ms, then reverts to cyan.
  error: 0.85,
} as const;
