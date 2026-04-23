// Story 4.6 AC #12: floating label above a cluster centroid.
// Uses drei's <Html> component to create a DOM overlay inside the R3F
// scene — createPortal from react-dom cannot be used inside R3F's custom
// reconciler (it would try to instantiate <div> as a Three.js object).
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { usePondStore } from '../../stores/usePondStore';

interface ClusterLabelProps {
  /** Group id — used to match clusterTranslation during handle drag. */
  groupId: string;
  label: string;
  memberPositions: { x: number; z: number }[];
}

export function ClusterLabel({ groupId, label, memberPositions }: ClusterLabelProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!groupRef.current || memberPositions.length === 0) return;

    // Story 4.6 (user feedback 2026-04-23): during a cluster-handle
    // drag, the whole group translates rigidly. Compute the centroid
    // from the BASELINES frozen in clusterTranslation (not from the
    // live memberPositions prop, which only updates after the refetch
    // arrives). Without this, the label lags behind at the pre-drag
    // centroid. Matches the ClusterHalo and LilyPad patterns.
    const clusterTrans = usePondStore.getState().clusterTranslation;
    let cx: number;
    let cz: number;
    if (
      clusterTrans?.groupId === groupId &&
      clusterTrans.baselines.size > 0
    ) {
      let sx = 0;
      let sz = 0;
      for (const pos of clusterTrans.baselines.values()) {
        sx += pos.x;
        sz += pos.z;
      }
      const n = clusterTrans.baselines.size;
      cx = sx / n + clusterTrans.dx;
      cz = sz / n + clusterTrans.dz;
    } else {
      cx = memberPositions.reduce((s, p) => s + p.x, 0) / memberPositions.length;
      cz = memberPositions.reduce((s, p) => s + p.z, 0) / memberPositions.length;
    }

    groupRef.current.position.set(cx, 0.4, cz);
  });

  return (
    <group ref={groupRef}>
      <Html center style={{ pointerEvents: 'none' }}>
        <div
          className="cluster-label"
          style={{
            fontFamily: "'Share Tech Mono', monospace",
            color: '#00eeff',
            fontSize: '11px',
            opacity: 0.8,
            whiteSpace: 'nowrap',
            userSelect: 'none',
            transform: 'translateY(-20px)',
          }}
        >
          {label}
        </div>
      </Html>
    </group>
  );
}
