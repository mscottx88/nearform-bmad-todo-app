/**
 * Story 6.7: the Oracle's dedicated lily pad mesh.
 *
 * Visually similar to a regular {@link LilyPad} (cyan-rimmed disc on
 * the water surface) but stripped of:
 *   - drag handlers / pointer events / hover & focus state
 *   - completion / delete dissolves
 *   - halo color-lerps on action
 *   - completion-egg / aphid / chameleon spawns
 *   - InfoPopup / ActionPopup overlays
 *
 * Position + visibility are driven exclusively by the parent
 * `OracleFrogManager` — this component is a pure presenter.
 *
 * Geometry is duplicated rather than extracted because a refactor of
 * LilyPad's internals is out of scope for Story 6.7 (Dev Notes:
 * "Shared lily-pad geometry — bias toward duplication"). The ridge
 * + disc shape is a simplified version of the regular pad's body —
 * a smooth ring + flat top, no notch.
 */

import { forwardRef } from 'react';
import * as THREE from 'three';

const NEON_CYAN = '#00eeff';

// Match the regular pad's PAD_RADIUS (1.0) — the AC mandates the
// same diameter as a regular lily pad.
export const ORACLE_PAD_RADIUS = 1.0;
const ORACLE_PAD_THICKNESS = 0.05;

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
  return (
    <group ref={ref} position={position} visible={visible}>
      {/* Pad body — flat cylinder along Y axis. */}
      <mesh position={[0, ORACLE_PAD_THICKNESS / 2, 0]}>
        <cylinderGeometry
          args={[ORACLE_PAD_RADIUS, ORACLE_PAD_RADIUS, ORACLE_PAD_THICKNESS, 48]}
        />
        <meshPhysicalMaterial
          color={NEON_CYAN}
          emissive={NEON_CYAN}
          emissiveIntensity={0.25}
          transmission={0.2}
          opacity={0.65 * opacity}
          transparent
          roughness={0.25}
          metalness={0}
          ior={1.4}
        />
      </mesh>
      {/* Rim — slim torus along the perimeter for the neon highlight. */}
      <mesh
        position={[0, ORACLE_PAD_THICKNESS, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <torusGeometry args={[ORACLE_PAD_RADIUS, 0.025, 8, 64]} />
        <meshBasicMaterial color={NEON_CYAN} transparent opacity={0.95 * opacity} />
      </mesh>
    </group>
  );
});
