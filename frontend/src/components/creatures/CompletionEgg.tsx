import { useRef, useCallback, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const CRACK_DURATION = 0.8;

interface CompletionEggProps {
  color: string;
  completed: boolean;
  onToggle: () => void;
  padRadius: number;
}

export function CompletionEgg({
  color,
  completed,
  onToggle,
  padRadius,
}: CompletionEggProps) {
  const groupRef = useRef<THREE.Group>(null);
  const leftRef = useRef<THREE.Mesh>(null);
  const rightRef = useRef<THREE.Mesh>(null);
  const animating = useRef(false);
  const animTimer = useRef(0);
  const [visualState, setVisualState] = useState<'whole' | 'cracking' | 'hatched'>(
    completed ? 'hatched' : 'whole',
  );

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;

    if (animating.current) {
      animTimer.current += delta;
      const t = Math.min(animTimer.current / CRACK_DURATION, 1);

      if (visualState === 'cracking') {
        if (t < 0.3) {
          // Phase 1: wobble intensely
          const wobbleT = t / 0.3;
          group.rotation.z = Math.sin(wobbleT * Math.PI * 8) * 0.25 * (1 - wobbleT * 0.5);
        } else if (t < 0.7) {
          // Phase 2: split apart — two halves separate
          group.rotation.z = 0;
          const splitT = (t - 0.3) / 0.4;
          if (leftRef.current && rightRef.current) {
            leftRef.current.position.x = -splitT * 0.06;
            leftRef.current.rotation.z = splitT * 0.3;
            rightRef.current.position.x = splitT * 0.06;
            rightRef.current.rotation.z = -splitT * 0.3;
          }
        } else {
          // Phase 3: collapse to shell
          const collapseT = (t - 0.7) / 0.3;
          group.scale.y = 1 - collapseT * 0.55;
          if (leftRef.current && rightRef.current) {
            leftRef.current.position.x = 0.06 * (1 - collapseT);
            rightRef.current.position.x = -0.06 * (1 - collapseT);
            leftRef.current.rotation.z = 0.3 * (1 - collapseT);
            rightRef.current.rotation.z = -0.3 * (1 - collapseT);
          }
        }

        if (t >= 1) {
          animating.current = false;
          animTimer.current = 0;
          group.rotation.z = 0;
          group.scale.y = 0.45;
          if (leftRef.current) { leftRef.current.position.x = 0; leftRef.current.rotation.z = 0; }
          if (rightRef.current) { rightRef.current.position.x = 0; rightRef.current.rotation.z = 0; }
          setVisualState('hatched');
        }
      }
    } else if (visualState === 'whole') {
      // Gentle pulse
      const t = state.clock.elapsedTime;
      const pulse = 1 + Math.sin(t * 2.5) * 0.04;
      group.scale.set(pulse, pulse, pulse);
    }
  });

  const handleClick = useCallback(
    (e: THREE.Event) => {
      (e as unknown as { stopPropagation: () => void }).stopPropagation();
      if (animating.current) return;

      if (!completed) {
        // Crack open
        animating.current = true;
        animTimer.current = 0;
        setVisualState('cracking');
      } else {
        // Reform — instant for now
        setVisualState('whole');
        const group = groupRef.current;
        if (group) { group.scale.set(1, 1, 1); }
      }
      onToggle();
    },
    [completed, onToggle],
  );

  const isShell = visualState === 'hatched';
  const shellOpacity = isShell ? 0.15 : 0.35;
  const spotOpacity = isShell ? 0.15 : 0.35;

  return (
    <group
      ref={groupRef}
      position={[padRadius * 0.5, 0.14, 0]}
      scale={isShell ? [1, 0.45, 1] : [1, 1, 1]}
      onClick={handleClick}
    >
      {/* Left half of egg */}
      <mesh ref={leftRef}>
        <sphereGeometry args={[0.12, 12, 10, 0, Math.PI]} />
        <meshBasicMaterial
          color="#e0e8ff"
          transparent
          opacity={shellOpacity}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Right half of egg */}
      <mesh ref={rightRef}>
        <sphereGeometry args={[0.12, 12, 10, Math.PI, Math.PI]} />
        <meshBasicMaterial
          color="#e0e8ff"
          transparent
          opacity={shellOpacity}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Neon spots overlay */}
      <mesh scale={[1.05, 1.05, 1.05]}>
        <icosahedronGeometry args={[0.12, 0]} />
        <meshBasicMaterial
          color={color}
          wireframe
          transparent
          opacity={spotOpacity}
        />
      </mesh>
      {/* Inner glow */}
      <mesh scale={[0.5, 0.5, 0.5]}>
        <sphereGeometry args={[0.12, 6, 6]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={isShell ? 0.05 : 0.15}
        />
      </mesh>
    </group>
  );
}
