// Story 4.6: pure geometry helpers for cluster/group calculations.
// All functions are stateless and allocation-minimal — callers may
// invoke them from useFrame without concern for per-frame GC pressure
// as long as they avoid capturing the return values in closures that
// prevent GC. Input coords are world-space (x, z).

import type { Camera } from 'three';
import * as THREE from 'three';

export interface WorldPos {
  x: number;
  z: number;
}

// Per-pad halo radius used as the cluster radius expansion factor.
export const PER_PAD_HALO_RADIUS = 2.8;

/** Compute the cluster centroid from member world positions. */
export function computeCentroid(members: WorldPos[]): WorldPos {
  if (members.length === 0) return { x: 0, z: 0 };
  const x = members.reduce((s, m) => s + m.x, 0) / members.length;
  const z = members.reduce((s, m) => s + m.z, 0) / members.length;
  return { x, z };
}

/**
 * Compute the cluster halo radius:
 *   R = max(|centroid − memberPos|) + PER_PAD_HALO_RADIUS
 * Recomputed each frame as positions change.
 */
export function computeHaloRadius(
  members: WorldPos[],
  centroid: WorldPos,
  padHaloRadius = PER_PAD_HALO_RADIUS,
): number {
  if (members.length === 0) return padHaloRadius;
  let maxDist = 0;
  for (const m of members) {
    const dx = m.x - centroid.x;
    const dz = m.z - centroid.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > maxDist) maxDist = d;
  }
  return maxDist + padHaloRadius;
}

/** World-space axis-aligned bounding box of all member halos. */
export interface BBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function computeBbox(
  members: WorldPos[],
  padHaloRadius = PER_PAD_HALO_RADIUS,
): BBox {
  if (members.length === 0) {
    return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  }
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const m of members) {
    if (m.x - padHaloRadius < minX) minX = m.x - padHaloRadius;
    if (m.x + padHaloRadius > maxX) maxX = m.x + padHaloRadius;
    if (m.z - padHaloRadius < minZ) minZ = m.z - padHaloRadius;
    if (m.z + padHaloRadius > maxZ) maxZ = m.z + padHaloRadius;
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * The drag-handle world position: the point on the halo circle
 * directed toward the bbox lower-right corner.
 *
 *   handleWorldPos = centroid + normalize(bboxLowerRight − centroid) * R
 *
 * This keeps the handle on the halo boundary at the southeastern arc.
 */
export function computeHandleWorldPos(
  centroid: WorldPos,
  bbox: BBox,
  R: number,
): WorldPos {
  const bboxLR = { x: bbox.maxX, z: bbox.maxZ };
  const dx = bboxLR.x - centroid.x;
  const dz = bboxLR.z - centroid.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 1e-6) {
    // Degenerate: bbox lower-right is at centroid — default to +x,+z.
    return { x: centroid.x + R * 0.707, z: centroid.z + R * 0.707 };
  }
  return {
    x: centroid.x + (dx / len) * R,
    z: centroid.z + (dz / len) * R,
  };
}

// Scratch vector for projectWorldToScreen — reused each call to avoid
// per-frame allocation. NOT safe to store the return value across async
// boundaries, but fine for immediate read inside useFrame.
const _scratchWorld = new THREE.Vector3();

/**
 * Project a world (x, z) position to screen pixel coordinates.
 * Returns `{ sx, sy }` in CSS pixels relative to the viewport.
 *
 * The y world-coordinate is set to 0.4 (slightly above water) so
 * the label/handle appears above the surface plane.
 */
export function projectWorldToScreen(
  pos: WorldPos,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
): { sx: number; sy: number } {
  _scratchWorld.set(pos.x, 0.4, pos.z);
  _scratchWorld.project(camera);
  const sx = ((_scratchWorld.x + 1) / 2) * viewportWidth;
  const sy = ((-_scratchWorld.y + 1) / 2) * viewportHeight;
  return { sx, sy };
}
