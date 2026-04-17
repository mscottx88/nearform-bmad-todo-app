import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface WaterStriderProps {
  position: [number, number, number];
  color: string;
  // When used inside <EmergingCreature>, position is driven by the parent's
  // rise animation so the skimming useFrame must stand down.
  asEmerging?: boolean;
}

export function WaterStrider({ position, color, asEmerging = false }: WaterStriderProps) {
  const groupRef = useRef<THREE.Group>(null);
  // Lazy `useState` initializer keeps the impure `Math.random` call out of
  // the render body (react-hooks/purity).
  const [seed] = useState(() => Math.random() * Math.PI * 2);

  useFrame((state) => {
    if (asEmerging) return;
    const group = groupRef.current;
    if (!group) return;
    const t = state.clock.elapsedTime;
    const s = seed;
    // Skims near the pad on the water surface
    group.position.x = position[0] + Math.sin(t * 0.5 + s) * 0.4;
    group.position.y = 0.02;
    group.position.z = position[2] + Math.cos(t * 0.4 + s) * 0.4;
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Body — small elongated shape */}
      <mesh>
        <boxGeometry args={[0.15, 0.02, 0.05]} />
        <meshBasicMaterial color={color} wireframe />
      </mesh>
      {/* Legs — 3 pairs of thin lines */}
      {[-0.04, 0, 0.04].map((z, i) => (
        <group key={i} position={[0, 0, z]}>
          <mesh position={[-0.1, -0.01, 0]} rotation={[0, 0, 0.3]}>
            <boxGeometry args={[0.18, 0.005, 0.005]} />
            <meshBasicMaterial color={color} transparent opacity={0.6} />
          </mesh>
          <mesh position={[0.1, -0.01, 0]} rotation={[0, 0, -0.3]}>
            <boxGeometry args={[0.18, 0.005, 0.005]} />
            <meshBasicMaterial color={color} transparent opacity={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
