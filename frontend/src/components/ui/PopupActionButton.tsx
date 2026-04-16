import { useRef, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';

const BUTTON_W = 1.4;
const BUTTON_H = 0.3;

const CORNERS: Array<[number, number, number]> = [
  [-BUTTON_W / 2, -BUTTON_H / 2, 0],
  [BUTTON_W / 2, -BUTTON_H / 2, 0],
  [BUTTON_W / 2, BUTTON_H / 2, 0],
  [-BUTTON_W / 2, BUTTON_H / 2, 0],
  [-BUTTON_W / 2, -BUTTON_H / 2, 0],
];

const PULSE_DURATION = 0.12; // seconds

interface PopupActionButtonProps {
  label: string;
  onClick: () => void;
  color?: string;
}

export function PopupActionButton({
  label,
  onClick,
  color = '#00eeff',
}: PopupActionButtonProps) {
  const groupRef = useRef<THREE.Group>(null);
  const pulseStart = useRef<number | null>(null);
  const [hovered, setHovered] = useState(false);

  const handlePointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    if (typeof document !== 'undefined') {
      document.body.style.cursor = 'pointer';
    }
  }, []);

  const handlePointerOut = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(false);
    if (typeof document !== 'undefined') {
      document.body.style.cursor = '';
    }
  }, []);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      (e.nativeEvent as MouseEvent & { sceneHandled?: boolean }).sceneHandled = true;
      pulseStart.current = performance.now() / 1000;
      onClick();
    },
    [onClick],
  );

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const hoverScale = hovered ? 1.08 : 1.0;
    let pulseScale = 1.0;
    if (pulseStart.current !== null) {
      const t = (state.clock.elapsedTime - pulseStart.current) / PULSE_DURATION;
      if (t >= 1) {
        pulseStart.current = null;
      } else {
        // 1 -> 0.92 -> 1 pulse
        pulseScale = 1.0 - 0.08 * Math.sin(t * Math.PI);
      }
    }
    g.scale.setScalar(hoverScale * pulseScale);
  });

  const lineWidth = hovered ? 2.5 : 1.5;
  const labelGlow = hovered ? 10 : 6;

  return (
    <group
      ref={groupRef}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      onClick={handleClick}
    >
      {/* Invisible hit plane for reliable click detection */}
      <mesh>
        <planeGeometry args={[BUTTON_W, BUTTON_H]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Line points={CORNERS} color={color} lineWidth={lineWidth} />
      <Html center distanceFactor={8} style={{ pointerEvents: 'none' }}>
        <span
          style={{
            color,
            fontFamily: 'var(--font-mono)',
            fontSize: '14px',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            textShadow: `0 0 ${labelGlow}px ${color}`,
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}
        >
          {label}
        </span>
      </Html>
    </group>
  );
}
