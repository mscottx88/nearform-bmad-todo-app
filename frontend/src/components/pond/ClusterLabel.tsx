// Story 4.6 AC #12: floating label above a cluster centroid.
// Uses drei's <Html> component to create a DOM overlay inside the R3F
// scene — createPortal from react-dom cannot be used inside R3F's custom
// reconciler (it would try to instantiate <div> as a Three.js object).
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

interface ClusterLabelProps {
  label: string;
  memberPositions: { x: number; z: number }[];
}

export function ClusterLabel({ label, memberPositions }: ClusterLabelProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!groupRef.current || memberPositions.length === 0) return;

    const cx =
      memberPositions.reduce((s, p) => s + p.x, 0) / memberPositions.length;
    const cz =
      memberPositions.reduce((s, p) => s + p.z, 0) / memberPositions.length;

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
