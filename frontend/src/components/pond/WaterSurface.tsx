import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { usePondStore } from '../../stores/usePondStore';

// Scheduling constants for the occasional ambient ripple. The pond still
// needs to feel alive when idle, but the previous 5 always-on ripple
// sources drowned out user-triggered click/drop ripples. One scheduled
// ambient ripple every 4-8s reads as "something stirred out there"
// without masking intentional feedback.
const AMBIENT_RIPPLE_MIN_DELAY_MS = 4000;
const AMBIENT_RIPPLE_MAX_DELAY_MS = 8000;
// First ripple fires quickly so the pond doesn't look frozen on load.
const AMBIENT_RIPPLE_FIRST_DELAY_MS = 1500;
// Random position within the visible pond area (±20 units on each axis).
const AMBIENT_RIPPLE_RADIUS = 20;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec2 uDropCenter;
  uniform float uDropTime;
  uniform vec2 uAmbientCenter;
  uniform float uAmbientTime;

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

    // Subtle overall breathing motion — the only always-on background
    // so click/drop ripples stand out clearly.
    float breath = sin(uTime * 0.3) * 0.02;
    float elevation = breath;

    // Occasional ambient ripple — one at a time, fades on its own over
    // ~3.5s. Scheduled by JS on a 4-8s timer (see WaterSurface useEffect).
    if (uAmbientTime > 0.0) {
      float ambientElapsed = uTime - uAmbientTime;
      if (ambientElapsed > 0.0 && ambientElapsed < 3.5) {
        float ambientRipple = ripple(pos.xy, uAmbientCenter, 1.3, 1.5, 0.08);
        float ambientDecay = exp(-ambientElapsed * 1.0);
        elevation += ambientRipple * 0.10 * ambientDecay;
      }
    }

    // Dynamic impact ripple from todo drop OR user click
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
    uAmbientCenter: { value: new THREE.Vector2(0, 0) },
    uAmbientTime: { value: 0 },
  };
}

export function WaterSurface() {
  const meshRef = useRef<THREE.Mesh>(null);
  const [uniforms] = useState(createUniforms);
  const glowIntensity = usePondStore((s) => s.glowIntensity);
  const dropRipple = usePondStore((s) => s.dropRipple);
  const lastRippleRef = useRef<number>(0);
  // Ambient ripples are scheduled by JS setTimeout and queued as a pending
  // {x, z} here; useFrame stamps the uniform on the next frame using the
  // R3F clock for `uAmbientTime`. Ref (not state) because we don't want
  // to trigger re-renders from the scheduler.
  const pendingAmbientRef = useRef<{ x: number; z: number } | null>(null);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh || !mesh.material) return;
    const material = mesh.material as THREE.ShaderMaterial;
    if (!material.uniforms) return;
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uGlowIntensity.value = glowIntensity;

    if (dropRipple && dropRipple.time !== lastRippleRef.current) {
      // The water plane is rotated -90° about X (mesh `rotation={[-Math.PI/2, 0, 0]}`),
      // so world-Z maps to LOCAL -Y in the plane geometry. The shader
      // compares `pos.xy` (local) against `uDropCenter`, so the world-Z
      // we got from `triggerRipple(x, z)` must be negated here. Without
      // this, the ripple appears at the mirrored-across-origin position
      // — which is why creation drops only "worked" at world (0, 0),
      // their default position before a user drags them.
      material.uniforms.uDropCenter.value.set(dropRipple.x, -dropRipple.z);
      material.uniforms.uDropTime.value = state.clock.elapsedTime;
      lastRippleRef.current = dropRipple.time;
    }

    if (pendingAmbientRef.current) {
      const { x, z } = pendingAmbientRef.current;
      // Same world-Z → local-Y flip as dropCenter.
      material.uniforms.uAmbientCenter.value.set(x, -z);
      material.uniforms.uAmbientTime.value = state.clock.elapsedTime;
      pendingAmbientRef.current = null;
    }
  });

  // Schedule occasional ambient ripples at random positions across the
  // pond. Chain setTimeouts so each subsequent delay is independently
  // randomized (setInterval would give fixed-cadence repeats, which
  // reads as mechanical instead of natural).
  useEffect(() => {
    let timeoutId: number | undefined;
    const queueOne = () => {
      const x = (Math.random() - 0.5) * 2 * AMBIENT_RIPPLE_RADIUS;
      const z = (Math.random() - 0.5) * 2 * AMBIENT_RIPPLE_RADIUS;
      pendingAmbientRef.current = { x, z };
    };
    const schedule = (delayMs: number) => {
      timeoutId = window.setTimeout(() => {
        queueOne();
        const nextDelay =
          AMBIENT_RIPPLE_MIN_DELAY_MS +
          Math.random() * (AMBIENT_RIPPLE_MAX_DELAY_MS - AMBIENT_RIPPLE_MIN_DELAY_MS);
        schedule(nextDelay);
      }, delayMs);
    };
    schedule(AMBIENT_RIPPLE_FIRST_DELAY_MS);
    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, []);

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
