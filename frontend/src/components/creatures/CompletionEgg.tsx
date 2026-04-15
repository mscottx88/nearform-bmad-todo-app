import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

type EggState = 'whole' | 'cracking' | 'hatched';

const CRACK_DURATION = 0.4;
const REFORM_DURATION = 0.3;

// Egg-shaped ellipsoid: taller than wide
const EGG_RADIUS_X = 0.1;
const EGG_RADIUS_Y = 0.15;

// Procedural egg shader with spots
const eggVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const eggFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vPosition;

  float spots(vec3 p) {
    // Procedural spots using sin combinations
    float s1 = sin(p.x * 25.0) * sin(p.y * 30.0) * sin(p.z * 20.0);
    float s2 = sin(p.x * 15.0 + 2.0) * sin(p.y * 20.0 + 1.0);
    return smoothstep(0.3, 0.5, s1 + s2 * 0.5);
  }

  void main() {
    // Base shell: semi-transparent with neon tint
    float rim = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
    float rimGlow = pow(rim, 2.0) * 0.6;

    // Spots — darker patches on the shell
    float spotPattern = spots(vPosition * 8.0);

    vec3 shellColor = uColor * (0.3 + rimGlow);
    vec3 spotColor = uColor * 0.1;
    vec3 finalColor = mix(shellColor, spotColor, spotPattern * 0.4);

    // Bright rim outline effect
    finalColor += uColor * rimGlow;

    gl_FragColor = vec4(finalColor, uOpacity * (0.4 + rimGlow * 0.6));
  }
`;

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
  const meshRef = useRef<THREE.Mesh>(null);
  const eggState = useRef<EggState>(completed ? 'hatched' : 'whole');
  const animTimer = useRef(0);
  const animating = useRef(false);

  if (completed && eggState.current === 'whole' && !animating.current) {
    eggState.current = 'hatched';
  }
  if (!completed && eggState.current === 'hatched' && !animating.current) {
    eggState.current = 'whole';
  }

  const colorVec = new THREE.Color(color);
  const uniforms = useRef({
    uColor: { value: new THREE.Vector3(colorVec.r, colorVec.g, colorVec.b) },
    uOpacity: { value: 0.85 },
  });

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    if (animating.current) {
      animTimer.current += delta;

      if (eggState.current === 'cracking') {
        const t = Math.min(animTimer.current / CRACK_DURATION, 1);
        mesh.rotation.z = Math.sin(t * Math.PI * 6) * 0.3 * (1 - t);
        mesh.scale.y = 1 - t * 0.5;
        uniforms.current.uOpacity.value = 0.85 - t * 0.35;
        if (t >= 1) {
          eggState.current = 'hatched';
          animating.current = false;
          animTimer.current = 0;
          mesh.rotation.z = 0;
        }
      } else if (eggState.current === 'whole' && animating.current) {
        const t = Math.min(animTimer.current / REFORM_DURATION, 1);
        mesh.scale.y = 0.5 + t * 0.5;
        uniforms.current.uOpacity.value = 0.5 + t * 0.35;
        if (t >= 1) {
          animating.current = false;
          animTimer.current = 0;
        }
      }
    } else if (eggState.current === 'whole') {
      const t = state.clock.elapsedTime;
      const pulse = 1 + Math.sin(t * 3) * 0.06;
      mesh.scale.set(pulse, pulse * 1.05, pulse);
    }
  });

  const handleClick = (e: THREE.Event) => {
    (e as unknown as { stopPropagation: () => void }).stopPropagation();
    if (animating.current) return;

    if (eggState.current === 'whole') {
      eggState.current = 'cracking';
      animating.current = true;
      animTimer.current = 0;
    } else if (eggState.current === 'hatched') {
      animating.current = true;
      animTimer.current = 0;
      eggState.current = 'whole';
    }
    onToggle();
  };

  const isHatched = eggState.current === 'hatched' && !animating.current;

  return (
    <group position={[padRadius * 0.5, 0.12, 0]}>
      <mesh
        ref={meshRef}
        onClick={handleClick}
        scale={isHatched ? [1, 0.5, 1] : [1, 1, 1]}
      >
        <sphereGeometry args={[EGG_RADIUS_X, 12, 12]} />
        <shaderMaterial
          uniforms={uniforms.current}
          vertexShader={eggVertexShader}
          fragmentShader={eggFragmentShader}
          transparent
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Neon outline ring at egg equator */}
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, isHatched ? 0 : EGG_RADIUS_Y * 0.3, 0]}
      >
        <ringGeometry args={[EGG_RADIUS_X * 0.95, EGG_RADIUS_X * 1.05, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
