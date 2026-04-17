import { useCallback, useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { usePondStore } from "../../stores/usePondStore";

// Number of concurrent ambient ripple "slots" in the shader. Each slot is
// an independent expanding wavefront. With 3 slots plus randomized
// scheduling, the pond usually has 1-2 overlapping ripples going with
// occasional moments of calm — never a metronomic single pulse.
const AMBIENT_SLOTS = 3;

// Scheduling: new ambients fire every 2.5-7s and round-robin into the
// slots. With a typical ripple life of ~6-10s (decay-dependent) and a
// ~4s average gap, expect 1-3 active at any time. Occasional long gaps
// (Math.random tail) give the calm stretches the user asked for.
const AMBIENT_RIPPLE_MIN_DELAY_MS = 2500;
const AMBIENT_RIPPLE_MAX_DELAY_MS = 7000;
// Every so often, skip a scheduled ripple entirely to create longer
// stretches of calm — ~20% chance on each tick.
const AMBIENT_SKIP_PROBABILITY = 0.2;
// First ripple fires quickly so the pond doesn't look frozen on load.
const AMBIENT_RIPPLE_FIRST_DELAY_MS = 1200;
// Random position within the visible pond area (±20 units on each axis).
const AMBIENT_RIPPLE_RADIUS = 20;
// Each ambient ripple gets a random decay rate in this range, which
// produces a random-feeling visible duration — low decay = long slow
// ripple that radiates far; high decay = quick pulse that fades fast.
const AMBIENT_DECAY_RATE_MIN = 0.25;
const AMBIENT_DECAY_RATE_MAX = 0.55;
// Random amplitude per ripple — some barely disturb the surface, some
// are pronounced. Avoids the "every ripple looks identical" feel.
const AMBIENT_AMPLITUDE_MIN = 0.09;
const AMBIENT_AMPLITUDE_MAX = 0.22;

// Click/drop ripple amplitude — randomized per event so clicks feel
// punchy and slightly varied. Floor is well above AMBIENT_AMPLITUDE_MAX
// so a click always reads louder than the loudest ambient ripple.
const CLICK_AMPLITUDE_MIN = 0.45;
const CLICK_AMPLITUDE_MAX = 0.7;

// Concurrent click ripple slots. A new click uses the next slot rather
// than overwriting the previous one, so existing ripples are guaranteed
// to finish their animation. Sized so realistic click bursts (a few per
// second) never evict an in-flight ripple during its ~4s lifetime.
const CLICK_SLOTS = 8;

// Phase velocity of the expanding wavefront in world units/sec. Used by
// both JS (hard cutoff when the front has traveled past the pond) and
// the shader mask (gates elevation to dist ≤ front). Must match the
// ratio `speed / freq` used in the shader's ambient ripple call below:
// speed=2.2, freq=0.9 → phase velocity ≈ 2.44 units/sec. Bumped from
// the previous combo so the wavefront is visibly expanding, not glacial.
const AMBIENT_WAVEFRONT_SPEED = 2.44;

const vertexShader = /* glsl */ `
  uniform float uTime;

  #define CLICK_SLOTS ${CLICK_SLOTS}
  uniform vec2 uDropCenter[CLICK_SLOTS];
  uniform float uDropTime[CLICK_SLOTS];
  uniform float uDropAmplitude[CLICK_SLOTS];

  #define AMBIENT_SLOTS ${AMBIENT_SLOTS}
  uniform vec2 uAmbientCenter[AMBIENT_SLOTS];
  uniform float uAmbientTime[AMBIENT_SLOTS];
  uniform float uAmbientDecayRate[AMBIENT_SLOTS];
  uniform float uAmbientAmplitude[AMBIENT_SLOTS];

  varying float vElevation;
  varying vec2 vUv;

  // Expanding-wavefront ripple from a point. The sin(dist*freq - t*speed)
  // term propagates outward at phase velocity (speed/freq), but without a
  // wavefront mask the whole plane oscillates instantly at t=0. The
  // leadingEdge smoothstep gates elevation to dist <= wavefrontRadius,
  // so the ripple actually begins at the center and visibly radiates
  // outward, which is what a real water disturbance looks like.
  float ripple(
    vec2 pos,
    vec2 center,
    float freq,
    float speed,
    float decay,
    float elapsed,
    float wavefrontSpeed
  ) {
    float dist = length(pos - center);
    float wave = sin(dist * freq - uTime * speed);
    float falloff = exp(-dist * decay);
    // Wavefront radius at this moment; a 0.6-unit soft edge prevents a
    // hard ring pop at the leading edge.
    float front = elapsed * wavefrontSpeed;
    float leadingEdge = 1.0 - smoothstep(front, front + 0.6, dist);
    return wave * falloff * leadingEdge;
  }

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Subtle overall breathing motion — the only always-on background
    // so click/drop/ambient ripples stand out clearly.
    float breath = sin(uTime * 0.3) * 0.02;
    float elevation = breath;

    // Up to AMBIENT_SLOTS concurrent ambient ripples, each independent.
    // An unused slot has uAmbientTime == 0.0; the shader skips it. Each
    // slot's ripple uses the expanding wavefront mask so it physically
    // radiates from its center instead of appearing everywhere at once.
    for (int i = 0; i < AMBIENT_SLOTS; i++) {
      float t0 = uAmbientTime[i];
      if (t0 <= 0.0) continue;
      float elapsed = uTime - t0;
      if (elapsed <= 0.0 || elapsed >= 14.0) continue;
      float r = ripple(
        pos.xy,
        uAmbientCenter[i],
        0.9,
        2.2,
        0.035,
        elapsed,
        ${AMBIENT_WAVEFRONT_SPEED.toFixed(2)}
      );
      float fade = exp(-elapsed * uAmbientDecayRate[i]);
      elevation += r * uAmbientAmplitude[i] * fade;
    }

    // Impact ripples from pad drops OR user clicks — "rock in the pond".
    // Fast-expanding wavefront (speed 7.0 world units/sec vs ambient 2.44)
    // with low spatial decay so the ring travels to the far edges of the
    // pond. Short wavelength + fast oscillation gives a crisp, punchy
    // feel. A brief central splash pulse is layered on top for the
    // instantaneous impact feedback that a real rock would produce.
    //
    // Each slot is an independent click — a new click occupies the next
    // slot (round-robin in JS) instead of overwriting the previous one,
    // so in-flight ripples always finish their animation even when the
    // user clicks rapidly. Amplitude is randomized per click so every
    // splash feels slightly different; its floor sits well above
    // AMBIENT_AMPLITUDE_MAX so clicks always read louder than ambient.
    for (int i = 0; i < CLICK_SLOTS; i++) {
      float dropT0 = uDropTime[i];
      if (dropT0 <= 0.0) continue;
      float dropElapsed = uTime - dropT0;
      if (dropElapsed <= 0.0 || dropElapsed >= 4.0) continue;

      vec2 center = uDropCenter[i];
      float amp = uDropAmplitude[i];

      float dropRipple = ripple(
        pos.xy,
        center,
        1.3,
        5.5,
        0.025,
        dropElapsed,
        7.0
      );
      float dropFade = exp(-dropElapsed * 1.1);
      elevation += dropRipple * amp * dropFade;

      // Central splash punch — tight Gaussian around the impact point
      // that flashes for ~0.25s. Sells the "impact" moment; without it
      // the ring alone feels like it materialized from nowhere.
      float dropDist = length(pos.xy - center);
      float splash = exp(-dropDist * dropDist * 0.8) * exp(-dropElapsed * 10.0);
      elevation += splash * amp * 1.2;
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
    // Per-slot click arrays — a new click takes the next slot (round-robin)
    // instead of overwriting an in-flight ripple, so animations always
    // complete. See CLICK_SLOTS.
    uDropCenter: {
      value: Array.from(
        { length: CLICK_SLOTS },
        () => new THREE.Vector2(0, 0),
      ),
    },
    uDropTime: {
      value: new Array<number>(CLICK_SLOTS).fill(0),
    },
    // Randomized per click so each splash feels slightly different;
    // stamped by useFrame when a new drop arrives.
    uDropAmplitude: {
      value: new Array<number>(CLICK_SLOTS).fill(CLICK_AMPLITUDE_MIN),
    },
    // Per-slot arrays (Three.js auto-uploads array uniforms when each
    // element is a THREE.Vector2 / number and the array length matches
    // the shader declaration).
    uAmbientCenter: {
      value: Array.from(
        { length: AMBIENT_SLOTS },
        () => new THREE.Vector2(0, 0),
      ),
    },
    uAmbientTime: {
      value: new Array<number>(AMBIENT_SLOTS).fill(0),
    },
    uAmbientDecayRate: {
      value: new Array<number>(AMBIENT_SLOTS).fill(0.4),
    },
    uAmbientAmplitude: {
      value: new Array<number>(AMBIENT_SLOTS).fill(0.16),
    },
  };
}

export function WaterSurface() {
  const meshRef = useRef<THREE.Mesh>(null);
  const [uniforms] = useState(createUniforms);
  const glowIntensity = usePondStore((s) => s.glowIntensity);
  const dropRipple = usePondStore((s) => s.dropRipple);
  const lastRippleRef = useRef<number>(0);
  // Ambient ripples are scheduled by JS setTimeout and queued here; the
  // next useFrame tick stamps the uniforms into the next available slot
  // using a round-robin index. Ref (not state) to avoid re-renders from
  // the scheduler.
  const pendingAmbientRef = useRef<{
    x: number;
    z: number;
    decayRate: number;
    amplitude: number;
  } | null>(null);
  const nextAmbientSlotRef = useRef<number>(0);
  const nextClickSlotRef = useRef<number>(0);

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
      //
      // Round-robin into the next click slot so rapid clicks don't
      // overwrite an in-flight ripple — each splash gets to finish its
      // full animation. With CLICK_SLOTS=8 and a 4s window, only clicking
      // faster than ~2Hz will evict the oldest in-flight ripple.
      const clickSlot = nextClickSlotRef.current;
      const dropCenters =
        material.uniforms.uDropCenter.value as THREE.Vector2[];
      const dropTimes = material.uniforms.uDropTime.value as number[];
      const dropAmps = material.uniforms.uDropAmplitude.value as number[];
      dropCenters[clickSlot].set(dropRipple.x, -dropRipple.z);
      dropTimes[clickSlot] = state.clock.elapsedTime;
      dropAmps[clickSlot] =
        CLICK_AMPLITUDE_MIN +
        Math.random() * (CLICK_AMPLITUDE_MAX - CLICK_AMPLITUDE_MIN);
      nextClickSlotRef.current = (clickSlot + 1) % CLICK_SLOTS;
      lastRippleRef.current = dropRipple.time;
    }

    if (pendingAmbientRef.current) {
      const { x, z, decayRate, amplitude } = pendingAmbientRef.current;
      const slot = nextAmbientSlotRef.current;
      const centers = material.uniforms.uAmbientCenter.value as THREE.Vector2[];
      const times = material.uniforms.uAmbientTime.value as number[];
      const decays = material.uniforms.uAmbientDecayRate.value as number[];
      const amps = material.uniforms.uAmbientAmplitude.value as number[];
      // Same world-Z → local-Y flip as dropCenter.
      centers[slot].set(x, -z);
      times[slot] = state.clock.elapsedTime;
      decays[slot] = decayRate;
      amps[slot] = amplitude;
      nextAmbientSlotRef.current = (slot + 1) % AMBIENT_SLOTS;
      pendingAmbientRef.current = null;
    }
  });

  // Schedule occasional ambient ripples at random positions across the
  // pond. Chain setTimeouts so each delay is independently randomized
  // (setInterval gives fixed cadence, which reads as mechanical). A
  // ~20% skip chance on each tick creates occasional longer calms.
  useEffect(() => {
    let timeoutId: number | undefined;
    const queueOne = () => {
      const x = (Math.random() - 0.5) * 2 * AMBIENT_RIPPLE_RADIUS;
      const z = (Math.random() - 0.5) * 2 * AMBIENT_RIPPLE_RADIUS;
      pendingAmbientRef.current = {
        x,
        z,
        decayRate:
          AMBIENT_DECAY_RATE_MIN +
          Math.random() * (AMBIENT_DECAY_RATE_MAX - AMBIENT_DECAY_RATE_MIN),
        amplitude:
          AMBIENT_AMPLITUDE_MIN +
          Math.random() * (AMBIENT_AMPLITUDE_MAX - AMBIENT_AMPLITUDE_MIN),
      };
    };
    const schedule = (delayMs: number) => {
      timeoutId = window.setTimeout(() => {
        if (Math.random() >= AMBIENT_SKIP_PROBABILITY) {
          queueOne();
        }
        const nextDelay =
          AMBIENT_RIPPLE_MIN_DELAY_MS +
          Math.random() *
            (AMBIENT_RIPPLE_MAX_DELAY_MS - AMBIENT_RIPPLE_MIN_DELAY_MS);
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
