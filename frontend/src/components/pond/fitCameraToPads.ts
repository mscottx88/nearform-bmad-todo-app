import type { Todo } from '../../types';
import { DEFAULT_CAMERA_POSITION, DEFAULT_CAMERA_TARGET } from './PondCamera';

// 30% margin around the pad cluster so edge pads don't flush with the
// viewport on reset.
export const RESET_BBOX_PADDING = 1.3;

// Single-pad / tiny-cluster case: don't zoom uncomfortably close.
export const RESET_MIN_DISTANCE = 15;

// Upper bound — matches OrbitControls.maxDistance in PondCamera.tsx.
export const RESET_MAX_DISTANCE = 60;

// Polar angle of the default (0,15,20) → origin offset. Preserving it
// on reset means the new camera pose "looks like home" pitch even when
// the cluster is off-origin.
//   atan2(horizontal=20, vertical=15) ≈ 53.13°
export const RESET_POLAR_ANGLE = Math.atan2(20, 15);

export interface CameraFit {
  /** World-space camera position as [x, y, z]. */
  position: [number, number, number];
  /** OrbitControls target as [x, y, z]. */
  target: [number, number, number];
}

/**
 * Compute a camera pose that frames every positioned pad with a margin.
 *
 * Falls back to the hard-coded default framing when the pond is empty
 * or no pad has a resolved position (e.g. initial load, all positions
 * still null).
 *
 * - Schema note: `Todo.positionY` stores world-space Z, not Y. The
 *   water plane is at y=0, so the target always lands on the plane.
 * - Pitch and azimuth are fixed to the default pose; only the
 *   centroid and distance adapt to the pad cluster.
 *
 * Pure function — safe to call every dispatch without side effects.
 * Reinstates the centroid + bbox-diagonal math that was removed from
 * the search-auto-frame path at commit f4088d3; scoped here to the
 * reset path only.
 */
export function fitCameraToPads(todos: readonly Todo[]): CameraFit {
  const positioned: Array<{ x: number; z: number }> = [];
  for (const t of todos) {
    if (t.positionX != null && t.positionY != null) {
      positioned.push({ x: t.positionX, z: t.positionY });
    }
  }
  if (positioned.length === 0) {
    return {
      position: [
        DEFAULT_CAMERA_POSITION.x,
        DEFAULT_CAMERA_POSITION.y,
        DEFAULT_CAMERA_POSITION.z,
      ],
      target: [
        DEFAULT_CAMERA_TARGET.x,
        DEFAULT_CAMERA_TARGET.y,
        DEFAULT_CAMERA_TARGET.z,
      ],
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let sumX = 0;
  let sumZ = 0;
  for (const p of positioned) {
    sumX += p.x;
    sumZ += p.z;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const cx = sumX / positioned.length;
  const cz = sumZ / positioned.length;
  const diagonal = Math.hypot(maxX - minX, maxZ - minZ);
  const distance = Math.max(
    RESET_MIN_DISTANCE,
    Math.min(RESET_MAX_DISTANCE, diagonal * RESET_BBOX_PADDING),
  );
  const cy = distance * Math.cos(RESET_POLAR_ANGLE);
  const offsetZ = distance * Math.sin(RESET_POLAR_ANGLE);
  return {
    position: [cx, cy, cz + offsetZ],
    target: [cx, 0, cz],
  };
}
