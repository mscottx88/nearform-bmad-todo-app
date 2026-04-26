/**
 * Shared lily-pad geometry helpers.
 *
 * Extracted so the regular {@link LilyPad} (todo pads) and the
 * Story 6.7 {@link OracleLilyPad} (the frog's pad) both render the
 * EXACT SAME shape, size, and rim profile — the user's directive on
 * Story 6.7 is "no different than a normal todo in shape size and
 * design, only color".
 *
 * Constants are also re-exported here so the two pad components stay
 * in lockstep on `PAD_RADIUS`, `SEGMENTS`, `NOTCH_ANGLE`, etc. — if
 * we ever tune those, every consumer picks the new values up
 * automatically.
 */

import * as THREE from 'three';

export const PAD_RADIUS = 1.0;
export const RIM_HEIGHT = 0.07;
export const SEGMENTS = 48;
export const NOTCH_ANGLE = 0.08;

/**
 * Builds the lily-pad's 2D outline as a THREE.Shape.
 *
 * The shape is a wobbly notched circle:
 *   - mostly circular, with a small triangular "notch" cut into one
 *     side (the classic lily-pad silhouette);
 *   - per-pad wobble driven by a 3-harmonic sin sum so each pad
 *     reads slightly different (no two pads identical, even though
 *     they share the same radius).
 *
 * The seed value drives the wobble's phase. Each LilyPad mounts
 * once with its own `driftSeed`; the OracleLilyPad uses a fixed
 * seed so its silhouette is stable across reloads.
 */
export function buildPadShape(
  radius: number,
  segments: number,
  seed: number,
): THREE.Shape {
  const shape = new THREE.Shape();
  const notchStart = -NOTCH_ANGLE;
  const notchEnd = NOTCH_ANGLE;

  let first = true;
  for (let i = 0; i <= segments; i++) {
    const angle = notchEnd + (i / segments) * (Math.PI * 2 - (notchEnd - notchStart));
    const wobble =
      1.0 +
      Math.sin(angle * 3 + seed) * 0.06 +
      Math.sin(angle * 7 + seed * 2.3) * 0.03 +
      Math.sin(angle * 13 + seed * 0.7) * 0.015;
    const r = radius * wobble;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (first) {
      shape.moveTo(x, z);
      first = false;
    } else {
      shape.lineTo(x, z);
    }
  }
  const notchDepth = radius * 0.6;
  shape.lineTo(Math.cos(notchStart) * notchDepth, Math.sin(notchStart) * notchDepth);
  shape.closePath();
  return shape;
}

/**
 * Produces the flat pad surface geometry (the top face) given a
 * pad shape. ShapeGeometry creates a 2D mesh in the XY plane, then
 * we rotate the points into XZ so it lies flat on the water.
 */
export function buildFlatPadGeometry(padShape: THREE.Shape): THREE.BufferGeometry {
  const shapeGeo = new THREE.ShapeGeometry(padShape, SEGMENTS);
  const pos = shapeGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setXYZ(i, x, 0, y);
  }
  pos.needsUpdate = true;
  shapeGeo.computeVertexNormals();
  return shapeGeo;
}

/**
 * Produces the raised rim geometry — a thin extruded wall around
 * the pad's silhouette, slightly flared at the top for a curled
 * lip. Reuses the points returned by `padShape.getPoints(SEGMENTS)`
 * so the rim sits exactly on the pad's outline.
 */
export function buildRimGeometry(padShape: THREE.Shape): THREE.BufferGeometry {
  const points = padShape.getPoints(SEGMENTS);
  const geo = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const indices: number[] = [];

  for (const p of points) {
    // Bottom edge
    vertices.push(p.x, 0, p.y);
    // Top edge — flared slightly outward for a curled lip
    const nx = p.x * 1.04;
    const nz = p.y * 1.04;
    vertices.push(nx, RIM_HEIGHT, nz);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Bright neon top-edge points — flat array of [x, y, z, x, y, z, ...]
 * suitable for a `<lineLoop>`'s `position` buffer attribute.
 * Sits at `RIM_HEIGHT` and traces the outline scaled 1.04x to align
 * with the rim's flared top edge.
 */
export function buildTopEdgePositions(padShape: THREE.Shape): Float32Array {
  return new Float32Array(
    padShape
      .getPoints(SEGMENTS)
      .flatMap((p) => [p.x * 1.04, 0.1 + RIM_HEIGHT, p.y * 1.04]),
  );
}
