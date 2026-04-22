// Story 4.6 AC #12: floating label above a cluster centroid.
// Lives inside the R3F Canvas tree (needs useFrame + useThree for
// the world→screen projection); renders its DOM via createPortal so
// it layers above the canvas without fighting WebGL compositing.
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

// Scratch vector — reused each frame to avoid per-frame allocation.
const _scratchV3 = new THREE.Vector3();

interface ClusterLabelProps {
  label: string;
  memberPositions: { x: number; z: number }[];
}

export function ClusterLabel({ label, memberPositions }: ClusterLabelProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const { camera, size } = useThree();

  useFrame(() => {
    const el = divRef.current;
    if (!el || memberPositions.length === 0) return;

    // Compute centroid in world space.
    const cx =
      memberPositions.reduce((s, p) => s + p.x, 0) / memberPositions.length;
    const cz =
      memberPositions.reduce((s, p) => s + p.z, 0) / memberPositions.length;

    // Project to NDC then to CSS pixel coordinates.
    _scratchV3.set(cx, 0.4, cz);
    _scratchV3.project(camera);

    const sx = ((_scratchV3.x + 1) / 2) * size.width;
    const sy = ((-_scratchV3.y + 1) / 2) * size.height;

    el.style.left = `${sx}px`;
    el.style.top = `${sy}px`;
  });

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={divRef}
      className="cluster-label"
      style={{
        position: 'fixed',
        left: '-9999px',
        top: '-9999px',
        fontFamily: "'Share Tech Mono', monospace",
        color: '#00eeff',
        fontSize: '11px',
        opacity: 0.8,
        pointerEvents: 'none',
        transform: 'translate(-50%, -100%)',
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      {label}
    </div>,
    document.body,
  );
}
