import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Todo } from '../../types';
import { useUpdateTodo } from '../../api/todoApi';
import { useCreateCreature, useDeleteCreature } from '../../api/creatureApi';
import { usePondStore } from '../../stores/usePondStore';
import { CompletionEgg } from '../creatures/CompletionEgg';
import { Firefly } from '../creatures/creatures/Firefly';
import { WaterStrider } from '../creatures/creatures/WaterStrider';

type DropPhase = 'forming' | 'dropping' | 'settling' | 'pulsing' | 'resting';

const DROP_Y_START = 3;
const DROP_Y_REST = 0.05;
const FORM_DURATION = 0.2;
const DROP_DURATION = 0.3;
const SETTLE_DURATION = 0.4;
const PULSE_DURATION = 1.2; // 3 pulses over ~1.2 seconds
const PAD_RADIUS = 1.0;
const COMPLETED_Y = -0.1;
const COMPLETION_LERP = 0.05;
const RIM_HEIGHT = 0.07;
const SEGMENTS = 48;
const NOTCH_ANGLE = 0.08;

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Procedural vein shader for the lily pad surface
const padVertexShader = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const padFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uSeed;
  varying vec2 vPos;

  void main() {
    // Radial veins from notch point toward edges
    float angle = atan(vPos.y, vPos.x);
    float dist = length(vPos);

    // Main radial veins — 7-9 primary veins
    float veins = 0.0;
    float veinCount = 8.0;
    float veinAngle = mod(angle * veinCount + uSeed, 3.14159) - 1.5708;
    veins += smoothstep(0.06, 0.0, abs(veinAngle)) * 0.35;

    // Secondary branching veins
    float branchCount = 20.0;
    float branchAngle = mod(angle * branchCount + uSeed * 2.3, 3.14159) - 1.5708;
    float branchFade = smoothstep(0.3, 0.8, dist);
    veins += smoothstep(0.08, 0.0, abs(branchAngle)) * 0.2 * branchFade;

    // Central vein running from notch
    float centralVein = smoothstep(0.04, 0.0, abs(vPos.y)) * smoothstep(0.0, 0.3, vPos.x);
    veins += centralVein * 0.3;

    // Base dark color with subtle green tint
    vec3 baseColor = vec3(0.0, 0.02, 0.01);
    // Vein color — subtle neon tinted
    vec3 veinColor = uColor * 0.08;

    vec3 finalColor = baseColor + veinColor * veins;

    // Slight radial gradient — lighter at edges
    finalColor += uColor * 0.015 * dist;

    // Slightly transparent so overlapping pads don't look harsh
    gl_FragColor = vec4(finalColor, 0.92);
  }
`;

function buildPadShape(radius: number, segments: number, seed: number): THREE.Shape {
  const shape = new THREE.Shape();
  const notchStart = -NOTCH_ANGLE;
  const notchEnd = NOTCH_ANGLE;

  let first = true;
  for (let i = 0; i <= segments; i++) {
    const angle = notchEnd + (i / segments) * (Math.PI * 2 - (notchEnd - notchStart));
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
  const notchDepth = radius * 0.6;
  shape.lineTo(Math.cos(notchStart) * notchDepth, Math.sin(notchStart) * notchDepth);
  shape.closePath();
  return shape;
}

const RECENT_THRESHOLD_MS = 3000;

interface LilyPadProps {
  todo: Todo;
  onDropComplete?: (x: number, z: number) => void;
}

export function LilyPad({ todo, onDropComplete }: LilyPadProps) {
  const isRecent = Date.now() - new Date(todo.createdAt).getTime() < RECENT_THRESHOLD_MS;
  const groupRef = useRef<THREE.Group>(null);
  const rimRef = useRef<THREE.Mesh>(null);
  const padMeshRef = useRef<THREE.Mesh>(null);
  const targetY = useRef(todo.completed ? COMPLETED_Y : DROP_Y_REST);
  const updateTodo = useUpdateTodo();
  const createCreature = useCreateCreature();
  const deleteCreature = useDeleteCreature();
  const [creatureType, setCreatureType] = useState<string | null>(null);
  const phaseRef = useRef<DropPhase>(isRecent ? 'forming' : 'resting');
  const phaseTimer = useRef(0);
  const driftSeed = useRef(Math.random() * Math.PI * 2);
  const rotationY = useRef(Math.random() * Math.PI * 2);
  const dropNotified = useRef(false);
  const restStartTime = useRef(0);
  const [textOpacity, setTextOpacity] = useState(isRecent ? 0 : 1);

  const posX = todo.positionX ?? 0;
  const posZ = todo.positionY ?? 0;
  const color = todo.color || '#00eeff';
  const colorVec = useMemo(() => new THREE.Color(color), [color]);

  // Update target Y when completion state changes
  targetY.current = todo.completed ? COMPLETED_Y : DROP_Y_REST;

  const PAD_ZOOM_DISTANCE = 3.5; // camera distance to fill ~75% of viewport

  const handlePadClick = useCallback(() => {
    usePondStore.getState().focusCamera(posX, posZ, PAD_ZOOM_DISTANCE);
  }, [posX, posZ]);

  const handleEggToggle = useCallback(() => {
    const newCompleted = !todo.completed;
    updateTodo.mutate({ id: todo.id, completed: newCompleted });
    if (newCompleted) {
      const type = Math.random() < 0.5 ? 'firefly' : 'water_strider';
      setCreatureType(type);
      createCreature.mutate({
        todoId: todo.id,
        creatureType: type,
        rarity: 'common',
      });
    } else {
      setCreatureType(null);
      deleteCreature.mutate(todo.id);
    }
  }, [todo.id, todo.completed, updateTodo, createCreature, deleteCreature]);

  const padShape = useMemo(
    () => buildPadShape(PAD_RADIUS, SEGMENTS, driftSeed.current),
    [],
  );

  // Smooth solid rim — extruded wall with enough verts for a clean surface
  const rimGeometry = useMemo(() => {
    const points = padShape.getPoints(SEGMENTS);
    const geo = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const indices: number[] = [];

    for (const p of points) {
      // Bottom edge
      vertices.push(p.x, 0, p.y);
      // Top edge — flared slightly outward for a curled lip
      const nx = p.x * 1.04;
      const nz = p.y * 1.04;
      vertices.push(nx, RIM_HEIGHT, nz);
    }
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

  const [padUniforms] = useState(() => ({
    uColor: { value: new THREE.Vector3(colorVec.r, colorVec.g, colorVec.b) },
    uSeed: { value: driftSeed.current },
  }));

  useEffect(() => {
    const group = groupRef.current;
    if (!group?.position) return;
    group.rotation.y = rotationY.current;
    if (phaseRef.current !== 'resting') {
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
      if (restStartTime.current === 0) {
        restStartTime.current = state.clock.elapsedTime;
      }
      const t = state.clock.elapsedTime - restStartTime.current;
      const seed = driftSeed.current;
      const ramp = Math.min(t / 3, 1);
      group.position.x = posX + Math.sin(t * 0.3 + seed) * 0.08 * ramp;
      group.position.z = posZ + Math.cos(t * 0.25 + seed * 1.3) * 0.06 * ramp;
      // Smooth transition between active/completed Y + gentle bob
      const restY = THREE.MathUtils.lerp(
        group.position.y - Math.sin(t * 0.5 + seed) * 0.01 * ramp,
        targetY.current,
        COMPLETION_LERP,
      );
      group.position.y = restY + Math.sin(t * 0.5 + seed) * 0.01 * ramp;

      // Desaturate pad shader when completed
      if (padMeshRef.current) {
        const mat = padMeshRef.current.material as THREE.ShaderMaterial;
        if (mat.uniforms?.uColor) {
          const intensity = todo.completed ? 0.4 : 1.0;
          const targetColor = new THREE.Vector3(
            colorVec.r * intensity,
            colorVec.g * intensity,
            colorVec.b * intensity,
          );
          mat.uniforms.uColor.value.lerp(targetColor, COMPLETION_LERP);
        }
      }
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
        setTextOpacity(1);
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
        phaseTimer.current = 0;
        phaseRef.current = 'pulsing';
      }
    } else if (phase === 'pulsing') {
      const t = Math.min(phaseTimer.current / PULSE_DURATION, 1);
      const wave = Math.sin(t * Math.PI * 6);
      const decay = 1 - t;
      // Scale pulse
      group.scale.setScalar(1.0 + wave * 0.12 * decay);
      // Rim: fade-blink between yellow glow and normal color
      if (rimRef.current) {
        const mat = rimRef.current.material as THREE.MeshBasicMaterial;
        const glow = Math.max(0, wave) * decay;
        mat.color.set(color).lerp(new THREE.Color('#ffd700'), glow);
        mat.opacity = 0.4 + glow * 0.6;
      }
      if (t >= 1) {
        group.scale.setScalar(1);
        if (rimRef.current) {
          const mat = rimRef.current.material as THREE.MeshBasicMaterial;
          mat.color.set(color);
          mat.opacity = 0.4;
        }
        group.position.set(posX, DROP_Y_REST, posZ);
        restStartTime.current = 0;
        phaseRef.current = 'resting';
      }
    }
  });

  return (
    <group ref={groupRef}>
      {/* Pad surface with procedural vein texture */}
      <mesh ref={padMeshRef} geometry={flatGeometry} position={[0, 0.1, 0]} renderOrder={10} onClick={handlePadClick}>
        <shaderMaterial
          uniforms={padUniforms}
          vertexShader={padVertexShader}
          fragmentShader={padFragmentShader}
          side={THREE.DoubleSide}
          transparent
        />
      </mesh>
      {/* Smooth solid raised rim — flared outward for curled lip */}
      <mesh ref={rimRef} geometry={rimGeometry} position={[0, 0.1, 0]} renderOrder={11}>
        <meshBasicMaterial color={color} transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
      {/* Bright neon top edge */}
      <lineLoop renderOrder={12}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[
              new Float32Array(
                padShape.getPoints(SEGMENTS).flatMap((p) => [p.x * 1.04, 0.1 + RIM_HEIGHT, p.y * 1.04]),
              ),
              3,
            ]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={color} linewidth={1} />
      </lineLoop>
      {/* Text label — fades in on landing */}
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
            opacity: textOpacity,
            transition: 'opacity 200ms ease-in',
            maxWidth: '100px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            userSelect: 'none',
          }}
        >
          {todo.text}
        </div>
      </Html>
      {/* Completion egg — near the notch */}
      <CompletionEgg
        color={color}
        completed={todo.completed}
        onToggle={handleEggToggle}
        padRadius={PAD_RADIUS}
      />
      {/* Hatched creature near the notch */}
      {todo.completed && creatureType === 'firefly' && (
        <Firefly position={[PAD_RADIUS * 0.4, 0.2, 0.1]} color={color} />
      )}
      {todo.completed && creatureType === 'water_strider' && (
        <WaterStrider position={[PAD_RADIUS * 0.4, 0, 0.2]} color={color} />
      )}
    </group>
  );
}
