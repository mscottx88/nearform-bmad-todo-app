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

    // Story 4.6: during a cluster-handle drag (and the post-release
    // refetch window), compute the centroid / radius from the BASELINES
    // in clusterTranslation rather than the current memberPositions.
    // memberPositions updates as soon as React Query's refetch lands,
    // which would briefly double-offset the halo the same way it did
    // the pads. Baselines are frozen at drag start.
    const clusterTrans = usePondStore.getState().clusterTranslation;
    let centroid: { x: number; z: number };
    let R: number;
    if (clusterTrans?.groupId === groupId && clusterTrans.baselines.size > 0) {
      const baselines = Array.from(clusterTrans.baselines.values());
      const baseCentroid = computeCentroid(baselines);
      R = computeHaloRadius(baselines, baseCentroid);
      centroid = {
        x: baseCentroid.x + clusterTrans.dx,
        z: baseCentroid.z + clusterTrans.dz,
      };
    } else {
      centroid = computeCentroid(memberPositions);
      R = computeHaloRadius(memberPositions, centroid);
    }

    meshRef.current.position.set(centroid.x, RING_Y, centroid.z);
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
