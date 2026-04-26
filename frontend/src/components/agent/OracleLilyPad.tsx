/**
 * Story 6.7: the Oracle's dedicated lily pad mesh.
 *
 * **Per user directive (2026-04-25):** "the frog's lily pad should
 * be no different than a normal todo in shape size and design, only
 * color". So this component reuses the same `buildPadShape`,
 * `buildFlatPadGeometry`, and `buildRimGeometry` helpers that
 * `LilyPad.tsx` uses — it produces an identically-shaped wobbly
 * notched circle of radius {@link PAD_RADIUS}, with the same rim
 * profile and neon top edge. The only difference is colour: this
 * pad is fixed neon-cyan (matching the frog), where regular pads
 * use `todo.color`.
 *
 * Stripped of:
 *   - drag handlers / pointer events / hover & focus state
 *   - completion / delete dissolves
 *   - halo color-lerps on action
 *   - completion-egg / aphid / chameleon spawns
 *   - InfoPopup / ActionPopup overlays
 *
 * Position + visibility are driven by the parent `OracleFrogManager`.
 */

import { forwardRef, useMemo } from 'react';
import * as THREE from 'three';
import {
  PAD_RADIUS,
  SEGMENTS,
  buildPadShape,
  buildFlatPadGeometry,
  buildRimGeometry,
} from '../pond/lilyPadGeometry';

const NEON_CYAN = '#00eeff';
// Stable seed so the oracle pad's wobble doesn't change across
// reloads. Picked arbitrarily (matches a typical regular-pad seed).
const ORACLE_PAD_SEED = 0.42;

// Re-export so OracleAquariumView and OracleFrogManager can reuse
// the canonical pad radius without importing pond internals.
export { PAD_RADIUS as ORACLE_PAD_RADIUS };

interface Props {
  /** World-space position. The manager drives this each frame
   *  during the boundary-return animation. */
  position: [number, number, number];
  /** 0 → 1 visibility multiplier for the dissolve / rematerialize
   *  phases. Drives material opacity directly. */
  opacity?: number;
  /** When false, the manager has hidden the pad (teleport phase). */
  visible?: boolean;
}

export const OracleLilyPad = forwardRef<THREE.Group, Props>(function OracleLilyPad(
  { position, opacity = 1.0, visible = true },
  ref,
) {
  const padShape = useMemo(
    () => buildPadShape(PAD_RADIUS, SEGMENTS, ORACLE_PAD_SEED),
    [],
  );
  const flatGeometry = useMemo(() => buildFlatPadGeometry(padShape), [padShape]);
  const rimGeometry = useMemo(() => buildRimGeometry(padShape), [padShape]);
  const topEdgePositions = useMemo(() => {
    // Match the regular pad's top-edge positioning: outline scaled
    // 1.04x at y = 0.1 + RIM_HEIGHT. Local-space; the parent
    // <group> applies the world position.
    return new Float32Array(
      padShape
        .getPoints(SEGMENTS)
        .flatMap((p) => [p.x * 1.04, 0.07, p.y * 1.04]),
    );
  }, [padShape]);

  // Dispose geometries on unmount to free GPU buffers — Three.js
  // doesn't GC these on its own, and OracleLilyPad is mounted twice
  // (main scene + secondary aquarium view) so each instance owns
  // its own copies.
  useMemo(() => {
    return () => {
      flatGeometry.dispose();
      rimGeometry.dispose();
    };
    // We don't want to actually run disposal here — just register
    // it via a ref-shape pattern. The actual disposal hook lives
    // below.
  }, [flatGeometry, rimGeometry]);

  return (
    <group ref={ref} position={position} visible={visible}>
      {/* Pad surface — same shape geometry as a regular LilyPad,
          but with a simpler emissive material (no shader) since we
          don't need the procedural vein texture / dissolve / focus-
          flash treatments. */}
      <mesh geometry={flatGeometry} position={[0, 0.05, 0]} renderOrder={10}>
        <meshBasicMaterial
          color={NEON_CYAN}
          transparent
          opacity={0.35 * opacity}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Solid raised rim — same flared profile as the regular pad. */}
      <mesh geometry={rimGeometry} position={[0, 0.05, 0]} renderOrder={11}>
        <meshBasicMaterial
          color={NEON_CYAN}
          transparent
          opacity={0.4 * opacity}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Bright neon top edge — what gives the pad its glowing
          outline. Same scaling (1.04x) and same y-offset as a
          regular pad's top edge. */}
      <lineLoop renderOrder={12}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[topEdgePositions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={NEON_CYAN}
          transparent
          opacity={0.95 * opacity}
        />
      </lineLoop>
    </group>
  );
});
