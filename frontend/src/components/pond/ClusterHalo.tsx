// Story 4.6 AC #11: a single neon-cyan ring rendered in the 3D scene that
// encircles all pads belonging to a group. Uses a flat RingGeometry lying
// on the water plane, scaled each frame to match the computed halo radius.
// This replaces the earlier per-pad second GlowSource approach.
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { computeCentroid, computeHaloRadius } from '../../lib/clusterGeometry';
import { usePondStore } from '../../stores/usePondStore';

interface ClusterHaloProps {
  /** The group this halo belongs to — used to match clusterTranslation during grip drag. */
  groupId: string;
  memberPositions: { x: number; z: number }[];
  /** Hex color for the ring. Defaults to neon cyan #00eeff. */
  color?: string;
}

// A unit ring: inner=0.96, outer=1.0 — thin enough to read as a boundary
// ring without obscuring the pads. Scaled by R each frame.
const RING_INNER = 0.96;
const RING_OUTER = 1.0;
const RING_SEGMENTS = 96;
// Slightly above water so it doesn't z-fight with the water mesh.
const RING_Y = 0.03;

export function ClusterHalo({ groupId, memberPositions, color = '#00eeff' }: ClusterHaloProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!meshRef.current || memberPositions.length < 2) return;

    const centroid = computeCentroid(memberPositions);
    const R = computeHaloRadius(memberPositions, centroid);

    // Story 4.6: during a handle grip-phase drag, the whole group
    // translates rigidly. LilyPad already applies this offset to each
    // pad; the halo must ride with them or it lags behind at the
    // pre-drag centroid. Read imperatively via getState() — no
    // re-render on every drag move.
    const clusterTrans = usePondStore.getState().clusterTranslation;
    const offsetX = clusterTrans?.groupId === groupId ? clusterTrans.dx : 0;
    const offsetZ = clusterTrans?.groupId === groupId ? clusterTrans.dz : 0;

    meshRef.current.position.set(centroid.x + offsetX, RING_Y, centroid.z + offsetZ);
    // Scale x and z uniformly by R; y scale is irrelevant for a flat ring.
    meshRef.current.scale.set(R, R, 1);
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[RING_INNER, RING_OUTER, RING_SEGMENTS]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.35}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}
