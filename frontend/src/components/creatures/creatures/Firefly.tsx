import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface FireflyProps {
  position: [number, number, number];
  color: string;
  // When used inside <EmergingCreature>, opacity + drift are driven by the
  // parent so the self-animation must step aside (otherwise the pulse
  // overwrites the emerge fade every frame — child useFrame runs last).
  asEmerging?: boolean;
}

export function Firefly({ position, color, asEmerging = false }: FireflyProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  // Lazy `useState` initializer keeps the impure `Math.random` call out of
  // the render body (react-hooks/purity).
  const [seed] = useState(() => Math.random() * Math.PI * 2);

  useFrame((state) => {
    if (asEmerging) return;
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;
    const s = seed;
    // Gentle floating drift near the pad
    mesh.position.x = position[0] + Math.sin(t * 0.8 + s) * 0.3;
    mesh.position.y = position[1] + 0.3 + Math.sin(t * 1.2 + s) * 0.15;
    mesh.position.z = position[2] + Math.cos(t * 0.6 + s) * 0.3;
    // Glow pulse
    const pulse = 0.5 + Math.sin(t * 4 + s) * 0.5;
    (mesh.material as THREE.MeshBasicMaterial).opacity = pulse;
  });

  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[0.06, 6, 6]} />
      <meshBasicMaterial color={color} transparent opacity={0.8} />
    </mesh>
  );
}
