import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Todo } from '../../types';

type DropPhase = 'forming' | 'dropping' | 'settling' | 'resting';

const DROP_Y_START = 3;
const DROP_Y_REST = 0.05;
const FORM_DURATION = 0.2;
const DROP_DURATION = 0.3;
const SETTLE_DURATION = 0.4;

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface LilyPadProps {
  todo: Todo;
  isNew?: boolean;
  onDropComplete?: (x: number, z: number) => void;
}

export function LilyPad({ todo, isNew = false, onDropComplete }: LilyPadProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [phase, setPhase] = useState<DropPhase>(isNew ? 'forming' : 'resting');
  const phaseTimer = useRef(0);
  const driftSeed = useRef(Math.random() * Math.PI * 2);
  const dropNotified = useRef(false);

  const posX = todo.positionX ?? 0;
  const posZ = todo.positionY ?? 0;

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    if (phase === 'resting') {
      const t = state.clock.elapsedTime;
      const seed = driftSeed.current;
      mesh.position.x = posX + Math.sin(t * 0.3 + seed) * 0.08;
      mesh.position.z = posZ + Math.cos(t * 0.25 + seed * 1.3) * 0.06;
      mesh.position.y = DROP_Y_REST + Math.sin(t * 0.5 + seed) * 0.02;
      return;
    }

    phaseTimer.current += delta;

    if (phase === 'forming') {
      const t = Math.min(phaseTimer.current / FORM_DURATION, 1);
      const scale = easeOut(t);
      mesh.scale.setScalar(scale);
      mesh.position.set(posX, DROP_Y_START, posZ);
      if (t >= 1) {
        phaseTimer.current = 0;
        setPhase('dropping');
      }
    } else if (phase === 'dropping') {
      const t = Math.min(phaseTimer.current / DROP_DURATION, 1);
      const y = DROP_Y_START + (DROP_Y_REST - DROP_Y_START) * easeInOut(t);
      mesh.position.set(posX, y, posZ);
      if (t >= 1) {
        if (!dropNotified.current && onDropComplete) {
          onDropComplete(posX, posZ);
          dropNotified.current = true;
        }
        phaseTimer.current = 0;
        setPhase('settling');
      }
    } else if (phase === 'settling') {
      const t = Math.min(phaseTimer.current / SETTLE_DURATION, 1);
      const bounce = Math.sin(t * Math.PI) * 0.05 * (1 - t);
      mesh.position.set(posX, DROP_Y_REST + bounce, posZ);
      if (t >= 1) {
        setPhase('resting');
      }
    }
  });

  const color = todo.color || '#00eeff';

  return (
    <group>
      <mesh
        ref={meshRef}
        position={[posX, isNew ? DROP_Y_START : DROP_Y_REST, posZ]}
        scale={isNew ? 0 : 1}
      >
        <cylinderGeometry args={[1.2, 1.2, 0.08, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.6}
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
        />
      </mesh>
      {phase === 'resting' && (
        <Html
          position={[posX, 0.15, posZ]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div
            style={{
              fontFamily: "'Inter', sans-serif",
              color: '#ffffff',
              fontSize: '12px',
              textShadow: `0 0 6px ${color}`,
              whiteSpace: 'nowrap',
              opacity: 0.9,
              maxWidth: '120px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              userSelect: 'none',
            }}
          >
            {todo.text}
          </div>
        </Html>
      )}
    </group>
  );
}
