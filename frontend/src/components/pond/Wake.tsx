// Story 4.6 AC #16: directional "wake" decal emitted during member drag
// within a group. A crescent-shaped arc lying flat on the water plane,
// oriented perpendicular to the dragged pad's motion so its "belly"
// trails behind the movement vector. Scales up and fades out over its
// lifetime; the parent (PondScene) filters expired entries from the
// store each frame.
//
// Minimal-viable implementation — a shallow ring segment (partial
// RingGeometry) is good enough to read as a curved wake under the
// scene's bloom pass. A textured sprite or shader variant is a polish
// story (see Dev Notes § "Wake vs ripple").
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { usePondStore } from '../../stores/usePondStore';

export const WAKE_LIFETIME_MS = 400;
// Arc span — π/2 (90°) reads as a crescent without being so wide it
// looks like a full circle. Oriented so the arc sits BEHIND the motion
// vector (rotated by π around Y + the angle so midline points opposite
// to motion).
const WAKE_THETA_LENGTH = Math.PI / 2;
// Flat ring lying on the water surface. Inner/outer pair gives the
// arc a slight thickness — thin enough to read as a wake edge, thick
// enough that bloom picks up the line clearly.
const WAKE_INNER = 0.95;
const WAKE_OUTER = 1.05;
const WAKE_SEGMENTS = 24;
// Slightly above water so it doesn't z-fight with the water mesh.
const WAKE_Y = 0.04;
// Start / end world-radius of the wake arc. Grows from ~1 pad-radius
// to ~1.6 as the wake expands.
const WAKE_RADIUS_START = 1.0;
const WAKE_RADIUS_END = 1.6;

interface WakeProps {
  /** World-space X at which the wake was emitted. */
  x: number;
  /** World-space Z at which the wake was emitted. */
  z: number;
  /** Motion angle in radians. Arc opens opposite to this direction. */
  angle: number;
  /** performance.now() at emission. Age is computed against this. */
  bornAt: number;
}

/**
 * Story 4.6 AC #16: container for all active wake decals. Subscribes
 * to the store's `wakes` array, renders one <Wake> per entry, and
 * calls `expireWakes` each frame so stale entries are evicted
 * promptly. Intended to be mounted once inside the Canvas tree.
 */
export function WakeLayer() {
  const wakes = usePondStore((s) => s.wakes);
  useFrame(() => {
    const now = performance.now();
    usePondStore.getState().expireWakes(now, WAKE_LIFETIME_MS);
  });
  return (
    <>
      {wakes.map((w) => (
        <Wake key={w.id} x={w.x} z={w.z} angle={w.angle} bornAt={w.bornAt} />
      ))}
    </>
  );
}

export function Wake({ x, z, angle, bornAt }: WakeProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    if (!meshRef.current || !materialRef.current) return;
    const elapsed = performance.now() - bornAt;
    const t = Math.min(Math.max(elapsed / WAKE_LIFETIME_MS, 0), 1);
    const radius = WAKE_RADIUS_START + (WAKE_RADIUS_END - WAKE_RADIUS_START) * t;
    meshRef.current.scale.set(radius, radius, 1);
    // Opacity eases out linearly to 0 at end-of-life so the expiry in
    // PondScene's expireWakes doesn't create a sudden visual cut.
    materialRef.current.opacity = 0.7 * (1 - t);
  });

  return (
    <mesh
      ref={meshRef}
      // Lay flat on water (rotate around X so ring is horizontal),
      // then rotate around Y by (angle + π) so the arc midpoint sits
      // BEHIND the motion — offset by -π/4 so the arc wraps evenly
      // around the back.
      rotation={[-Math.PI / 2, 0, angle + Math.PI - WAKE_THETA_LENGTH / 2]}
      position={[x, WAKE_Y, z]}
    >
      <ringGeometry args={[WAKE_INNER, WAKE_OUTER, WAKE_SEGMENTS, 1, 0, WAKE_THETA_LENGTH]} />
      <meshBasicMaterial
        ref={materialRef}
        color="#ffffff"
        transparent
        opacity={0.7}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}
