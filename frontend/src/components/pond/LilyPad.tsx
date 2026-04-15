import { useRef, useState, useEffect, useMemo } from 'react';
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
const PAD_RADIUS = 1.0;
const RIM_HEIGHT = 0.06;
const SEGMENTS = 48;
const NOTCH_ANGLE = 0.08; // radians — small V-notch opening

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Build an organic lily pad shape — irregular edge with a V-notch.
 * Returns points on the XZ plane (Y is up).
 */
function buildPadShape(radius: number, segments: number, seed: number): THREE.Shape {
  const shape = new THREE.Shape();
  const notchStart = -NOTCH_ANGLE;
  const notchEnd = NOTCH_ANGLE;

  let first = true;
  for (let i = 0; i <= segments; i++) {
    const angle = notchEnd + (i / segments) * (Math.PI * 2 - (notchEnd - notchStart));
    // Organic wobble on the radius — 3 harmonics seeded per-pad
    const wobble =
      1.0 +
      Math.sin(angle * 3 + seed) * 0.06 +
      Math.sin(angle * 7 + seed * 2.3) * 0.03 +
      Math.sin(angle * 13 + seed * 0.7) * 0.015;
    const r = radius * wobble;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (first) {
      shape.moveTo(x, z);
      first = false;
    } else {
      shape.lineTo(x, z);
    }
  }
  // Close with a short notch inward (not to center)
  const notchDepth = radius * 0.6;
  shape.lineTo(Math.cos(notchStart) * notchDepth, Math.sin(notchStart) * notchDepth);
  shape.closePath();
  return shape;
}

interface LilyPadProps {
  todo: Todo;
  isNew?: boolean;
  onDropComplete?: (x: number, z: number) => void;
}

export function LilyPad({ todo, isNew = false, onDropComplete }: LilyPadProps) {
  const groupRef = useRef<THREE.Group>(null);
  const phaseRef = useRef<DropPhase>(isNew ? 'forming' : 'resting');
  const phaseTimer = useRef(0);
  const driftSeed = useRef(Math.random() * Math.PI * 2);
  const dropNotified = useRef(false);
  const [showText, setShowText] = useState(!isNew);

  const posX = todo.positionX ?? 0;
  const posZ = todo.positionY ?? 0;
  const color = todo.color || '#00eeff';

  const padShape = useMemo(
    () => buildPadShape(PAD_RADIUS, SEGMENTS, driftSeed.current),
    [],
  );

  const rimGeometry = useMemo(() => {
    const points = padShape.getPoints(SEGMENTS);
    const geo = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const indices: number[] = [];

    // Two rings of vertices: bottom edge (y=0) and top edge (y=RIM_HEIGHT)
    for (const p of points) {
      vertices.push(p.x, 0, p.y);
      vertices.push(p.x, RIM_HEIGHT, p.y);
    }
    // Connect pairs into quads
    for (let i = 0; i < points.length - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [padShape]);

  const flatGeometry = useMemo(() => {
    const shapeGeo = new THREE.ShapeGeometry(padShape, SEGMENTS);
    // ShapeGeometry creates on XY — rotate verts to XZ
    const pos = shapeGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      pos.setXYZ(i, x, 0, y);
    }
    pos.needsUpdate = true;
    shapeGeo.computeVertexNormals();
    return shapeGeo;
  }, [padShape]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group?.position) return;
    if (isNew) {
      group.position.set(posX, DROP_Y_START, posZ);
      group.scale.setScalar(0);
    } else {
      group.position.set(posX, DROP_Y_REST, posZ);
      group.scale.setScalar(1);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const phase = phaseRef.current;

    if (phase === 'resting') {
      const t = state.clock.elapsedTime;
      const seed = driftSeed.current;
      group.position.x = posX + Math.sin(t * 0.3 + seed) * 0.08;
      group.position.z = posZ + Math.cos(t * 0.25 + seed * 1.3) * 0.06;
      group.position.y = DROP_Y_REST + Math.sin(t * 0.5 + seed) * 0.02;
      return;
    }

    phaseTimer.current += delta;

    if (phase === 'forming') {
      const t = Math.min(phaseTimer.current / FORM_DURATION, 1);
      group.scale.setScalar(easeOut(t));
      group.position.set(posX, DROP_Y_START, posZ);
      if (t >= 1) {
        phaseTimer.current = 0;
        phaseRef.current = 'dropping';
      }
    } else if (phase === 'dropping') {
      const t = Math.min(phaseTimer.current / DROP_DURATION, 1);
      const y = DROP_Y_START + (DROP_Y_REST - DROP_Y_START) * easeInOut(t);
      group.position.set(posX, y, posZ);
      if (t >= 1) {
        if (!dropNotified.current && onDropComplete) {
          onDropComplete(posX, posZ);
          dropNotified.current = true;
        }
        phaseTimer.current = 0;
        phaseRef.current = 'settling';
      }
    } else if (phase === 'settling') {
      const t = Math.min(phaseTimer.current / SETTLE_DURATION, 1);
      const bounce = Math.sin(t * Math.PI) * 0.05 * (1 - t);
      group.position.set(posX, DROP_Y_REST + bounce, posZ);
      if (t >= 1) {
        phaseRef.current = 'resting';
        setShowText(true);
      }
    }
  });

  return (
    <group ref={groupRef}>
      {/* Opaque black fill to occlude water beneath */}
      <mesh geometry={flatGeometry} position={[0, 0.1, 0]} renderOrder={10}>
        <meshBasicMaterial color="#000000" side={THREE.DoubleSide} />
      </mesh>
      {/* Raised rim — wireframe for neon outline look */}
      <mesh geometry={rimGeometry} position={[0, 0.1, 0]} renderOrder={11}>
        <meshBasicMaterial color={color} wireframe transparent opacity={0.8} />
      </mesh>
      {/* Solid top edge of rim for bright outline */}
      <lineLoop renderOrder={12}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[
              new Float32Array(
                padShape.getPoints(SEGMENTS).flatMap((p) => [p.x, 0.1 + RIM_HEIGHT, p.y]),
              ),
              3,
            ]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={color} linewidth={1} />
      </lineLoop>
      {/* Text label */}
      {showText && (
        <Html
          position={[0, 0.2, 0]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div
            style={{
              fontFamily: "'Inter', sans-serif",
              color: '#ffffff',
              fontSize: '11px',
              textShadow: `0 0 6px ${color}`,
              whiteSpace: 'nowrap',
              opacity: 0.9,
              maxWidth: '100px',
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
