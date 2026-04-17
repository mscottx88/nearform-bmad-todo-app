import { useCallback, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { usePondStore } from '../../stores/usePondStore';

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec2 uDropCenter;
  uniform float uDropTime;

  varying float vElevation;
  varying vec2 vUv;

  // Circular ripple from a point, decaying over distance and time
  float ripple(vec2 pos, vec2 center, float freq, float speed, float decay) {
    float dist = length(pos - center);
    float wave = sin(dist * freq - uTime * speed);
    float falloff = exp(-dist * decay);
    return wave * falloff;
  }

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Multiple ambient ripple sources across the pond
    float r1 = ripple(pos.xy, vec2(12.0, 8.0),   1.2, 1.5, 0.06) * 0.12;
    float r2 = ripple(pos.xy, vec2(-15.0, -10.0), 1.5, 1.2, 0.05) * 0.10;
    float r3 = ripple(pos.xy, vec2(5.0, -18.0),   1.0, 1.8, 0.07) * 0.08;
    float r4 = ripple(pos.xy, vec2(-8.0, 20.0),   1.8, 1.0, 0.08) * 0.06;
    float r5 = ripple(pos.xy, vec2(22.0, -5.0),   1.3, 1.4, 0.06) * 0.07;

    // Very subtle overall breathing motion
    float breath = sin(uTime * 0.3) * 0.02;

    float elevation = r1 + r2 + r3 + r4 + r5 + breath;

    // Dynamic impact ripple from todo drop
    if (uDropTime > 0.0) {
      float dropElapsed = uTime - uDropTime;
      if (dropElapsed > 0.0 && dropElapsed < 2.0) {
        float dropRipple = ripple(pos.xy, uDropCenter, 2.0, 3.0, 0.1);
        float dropDecay = exp(-dropElapsed * 2.0);
        elevation += dropRipple * 0.25 * dropDecay;
      }
    }

    pos.z += elevation;
    vElevation = elevation;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uGlowIntensity;
  uniform vec3 uNeonColor;

  varying float vElevation;
  varying vec2 vUv;

  void main() {
    // Ripple crests glow brighter
    float rippleGlow = smoothstep(-0.02, 0.12, vElevation);
    float brightness = (0.12 + rippleGlow * 0.28) * uGlowIntensity;

    // Fade toward edges for bounded pond feel
    float edgeFade = 1.0 - smoothstep(0.3, 0.52, length(vUv - 0.5));

    vec3 color = uNeonColor * brightness * edgeFade;

    gl_FragColor = vec4(color, brightness * edgeFade * 0.9);
  }
`;

function createUniforms() {
  return {
    uTime: { value: 0 },
    uGlowIntensity: { value: 1.0 },
    uNeonColor: { value: new THREE.Vector3(0.0, 0.933, 1.0) },
    uDropCenter: { value: new THREE.Vector2(0, 0) },
    uDropTime: { value: 0 },
  };
}

export function WaterSurface() {
  const meshRef = useRef<THREE.Mesh>(null);
  const [uniforms] = useState(createUniforms);
  const glowIntensity = usePondStore((s) => s.glowIntensity);
  const dropRipple = usePondStore((s) => s.dropRipple);
  const lastRippleRef = useRef<number>(0);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh || !mesh.material) return;
    const material = mesh.material as THREE.ShaderMaterial;
    if (!material.uniforms) return;
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uGlowIntensity.value = glowIntensity;

    if (dropRipple && dropRipple.time !== lastRippleRef.current) {
      material.uniforms.uDropCenter.value.set(dropRipple.x, dropRipple.z);
      material.uniforms.uDropTime.value = state.clock.elapsedTime;
      lastRippleRef.current = dropRipple.time;
    }
  });

  // Click anywhere on the water surface → radiating ripple at the click
  // point. R3F's raycaster hands us the world-space intersection as
  // `e.point`; pass `(x, z)` to triggerRipple so the shader's uDropCenter
  // gets the right position on the water plane. Lily-pad clicks
  // stopPropagation before this fires, so clicking a pad does NOT ripple
  // the water — only empty-water clicks do.
  const handleWaterClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    usePondStore.getState().triggerRipple(e.point.x, e.point.z);
  }, []);

  return (
    <mesh
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={0}
      onClick={handleWaterClick}
    >
      <planeGeometry args={[100, 100, 64, 64]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        wireframe
        transparent
        depthWrite
      />
    </mesh>
  );
}
