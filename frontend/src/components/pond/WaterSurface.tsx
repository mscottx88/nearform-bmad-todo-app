import { useCallback, useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { usePondStore } from "../../stores/usePondStore";
import {
  sampleElevation,
  type ElevationInputs,
  type RippleSlot,
  type AmbientRippleSlot,
} from "./waterElevation";

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

// Story 4.6 AC #16: directional wakes emitted during grouped member drag.
// Distinct from circular ripples — wakes are a stretched, motion-aligned
// displacement trailing behind the dragged pad. 12 slots comfortably
// cover a fast drag (~80ms emission cadence × ~450ms lifetime → ~6
// active wakes at steady-state, with overhead for bursts).
const WAKE_SLOTS = 12;
// Full wake lifetime in seconds. Slightly longer than the JS-side
// WAKE_EMIT_INTERVAL_MS × ~5 cycles so simultaneous active wakes form
// a visible trail. Past this elapsed time the shader no-ops the slot.
const WAKE_LIFETIME_S = 0.45;

// Phase velocity of the expanding wavefront in world units/sec. Passed
// to the shader as `uAmbientWavefrontSpeed` (story 2.9 AC #6 — was a
// template-literal injection pre-2.9, fragile across precision changes
// and runtime tunability). Matches the ambient ripple's `speed / freq`
// ratio (speed=2.2, freq=0.9 → ≈ 2.44) so the leading-edge mask and the
// underlying sine wave propagate at the same rate. Click ripples derive
// their wavefront speed from `speed / freq` inside the shader (AC #1).
const AMBIENT_WAVEFRONT_SPEED = 2.44;

// Click ripple slots: round-robin overwrite above ~2 Hz sustained click
// rate (8 slots × ~4s visibility window). Accepted tradeoff — no observed
// UX complaints, and clicks >2Hz are outside realistic use. Raise to 12
// if user-visible eviction reports land. Story 2.9 AC #9.
//
// Ambient ripple slots: with AMBIENT_SLOTS=3, up to 14s visibility, and
// 2.5–7s cadence, the oldest ambient gets overwritten every ~2.5s at
// minimum cadence. Accepted because ambients are non-semantic (no user
// intent tied to a specific ripple). Raise to 5 if visible "stutter"
// surfaces. Story 2.9 AC #10.

const vertexShader = /* glsl */ `
  uniform float uTime;
  // Story 2.9 AC #6: migrated from a JS template-literal injection to a
  // proper uniform so precision isn't truncated via toFixed and so the
  // value could in theory be tuned at runtime. Only the ambient ripple
  // uses this explicit front speed (ambient's wavefront is deliberately
  // slower-than-the-wave for a languid feel); click ripples derive their
  // front speed from speed/freq inside ripple() to keep the leading edge
  // locked to the wave crest (AC #1).
  uniform float uAmbientWavefrontSpeed;

  #define CLICK_SLOTS ${CLICK_SLOTS}
  uniform vec2 uDropCenter[CLICK_SLOTS];
  uniform float uDropTime[CLICK_SLOTS];
  uniform float uDropAmplitude[CLICK_SLOTS];

  #define AMBIENT_SLOTS ${AMBIENT_SLOTS}
  uniform vec2 uAmbientCenter[AMBIENT_SLOTS];
  uniform float uAmbientTime[AMBIENT_SLOTS];
  uniform float uAmbientDecayRate[AMBIENT_SLOTS];
  uniform float uAmbientAmplitude[AMBIENT_SLOTS];

  // Story 4.6 AC #16: wake slot uniforms. Each slot is a single
  // directional displacement trailing behind the emission point at the
  // given local-plane angle. uWakeAngle is in LOCAL-plane radians
  // (the caller negates the world-space angle before writing, because
  // world-Z to local-Y is a sign flip). uWakeLifetime is a single
  // scalar uniform per the 2.9 AC #6 rationale — avoids template-literal
  // injection of JS-side float constants into GLSL source, preserving
  // precision and leaving the knob tunable at runtime.
  #define WAKE_SLOTS ${WAKE_SLOTS}
  uniform vec2 uWakeCenter[WAKE_SLOTS];
  uniform float uWakeTime[WAKE_SLOTS];
  uniform float uWakeAngle[WAKE_SLOTS];
  uniform float uWakeAmplitude[WAKE_SLOTS];
  uniform float uWakeLifetime;

  varying float vElevation;
  varying vec2 vUv;

  // Expanding-wavefront ripple from a point. The sin(dist*freq - t*speed)
  // term propagates outward at phase velocity (speed/freq), but without a
  // wavefront mask the whole plane oscillates instantly at t=0. The
  // leadingEdge smoothstep gates elevation to dist <= wavefrontRadius,
  // so the ripple actually begins at the center and visibly radiates
  // outward, which is what a real water disturbance looks like.
  //
  // Story 2.9 AC #1: by default the wavefront propagates at the wave's
  // own phase velocity (speed/freq) so the leading edge stays locked to
  // the crest. Callers that want a deliberately-mismatched front (e.g.
  // the ambient ripple's slow, languid front while the wave oscillates
  // faster beneath it) pass a non-zero wavefrontOverride; otherwise the
  // override is 0.0 and the function derives the rate internally.
  // Story 4.6 AC #16: directional wake displacement. Unlike ripple()'s
  // circular wavefront, a wake is a motion-aligned bulge that trails
  // BEHIND the emission point. Implemented as a stretched gaussian in
  // the frame rotated to the motion direction: narrow along the motion
  // axis, broad (and expanding over time) perpendicular to it, peak
  // offset backwards so the emission point sits at the leading edge of
  // the crescent rather than its peak.
  float wake(
    vec2 pos,
    vec2 center,
    float angle,
    float amplitude,
    float elapsed,
    float lifetime
  ) {
    if (elapsed <= 0.0 || elapsed >= lifetime) return 0.0;

    vec2 rel = pos - center;
    float c = cos(angle);
    float s = sin(angle);
    // Motion-aligned local coords: longitudinal+ is forward along the
    // motion vector, lateral is the perpendicular (across) axis.
    float longitudinal = rel.x * c + rel.y * s;
    float lateral = -rel.x * s + rel.y * c;

    // Offset the gaussian peak BACKWARD along motion so the wake trails
    // behind the pad. longitudinalFromPeak = 0 sits at trailOffset units
    // behind the emission point.
    float trailOffset = 0.45;
    float longitudinalFromPeak = longitudinal + trailOffset;

    // Lateral spread grows with age — a wake is a narrow crest at first,
    // broadening into a crescent as it ages. Longitudinal width stays
    // tight so the wake reads as a line, not a blob.
    float sigmaPerp = 0.9 + elapsed * 3.5;
    float sigmaAlong = 0.32;

    float g = exp(
      -(longitudinalFromPeak * longitudinalFromPeak)
        / (2.0 * sigmaAlong * sigmaAlong)
      - (lateral * lateral) / (2.0 * sigmaPerp * sigmaPerp)
    );

    // Lifetime fade: quadratic out so the wake appears abruptly then
    // trails off (matches the emission → dissipate feel of real water).
    float normT = elapsed / lifetime;
    float fade = (1.0 - normT) * (1.0 - normT);

    return amplitude * g * fade;
  }

  float ripple(
    vec2 pos,
    vec2 center,
    float freq,
    float speed,
    float decay,
    float elapsed,
    float wavefrontOverride
  ) {
    float dist = length(pos - center);
    float wave = sin(dist * freq - uTime * speed);
    float falloff = exp(-dist * decay);
    // Wavefront radius at this moment; a 0.6-unit soft edge prevents a
    // hard ring pop at the leading edge.
    float wavefrontSpeed = wavefrontOverride > 0.0
      ? wavefrontOverride
      : speed / freq;
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
        uAmbientWavefrontSpeed
      );
      float fade = exp(-elapsed * uAmbientDecayRate[i]);
      elevation += r * uAmbientAmplitude[i] * fade;
    }

    // Impact ripples from pad drops OR user clicks — "rock in the pond".
    // Wavefront propagates at the wave's own phase velocity (speed/freq
    // = 5.5/1.3 ≈ 4.23 units/sec; story 2.9 AC #1 — pre-2.9 this was
    // hardcoded at 7.0, racing ahead of the wave crest). Low spatial
    // decay lets the ring travel to the far edges of the pond. Short
    // wavelength + fast oscillation gives a crisp, punchy feel. A brief
    // central splash pulse is layered on top for the instantaneous
    // impact feedback that a real rock would produce.
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

      // wavefrontOverride = 0.0 → ripple() derives speed/freq internally.
      float dropRipple = ripple(
        pos.xy,
        center,
        1.3,
        5.5,
        0.025,
        dropElapsed,
        0.0
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

    // Story 4.6 AC #16: wake slots. Each slot is a short-lived directional
    // bulge trailing a grouped-pad drag. Lifetime is gated inside wake()
    // so expired slots cost one conditional per vertex — cheap.
    for (int i = 0; i < WAKE_SLOTS; i++) {
      float wT0 = uWakeTime[i];
      if (wT0 <= 0.0) continue;
      float wElapsed = uTime - wT0;
      elevation += wake(
        pos.xy,
        uWakeCenter[i],
        uWakeAngle[i],
        uWakeAmplitude[i],
        wElapsed,
        uWakeLifetime
      );
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
    // Story 2.9 AC #6: explicit ambient wavefront speed (was a template-
    // literal injection pre-2.9). Click ripples don't need a counterpart
    // — their front speed is derived from speed/freq inside the shader.
    uAmbientWavefrontSpeed: { value: AMBIENT_WAVEFRONT_SPEED },
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
    // Story 4.6 AC #16: wake slots. Like click slots, round-robin over
    // WAKE_SLOTS so fast sequences emit distinct wakes instead of
    // overwriting each other.
    uWakeCenter: {
      value: Array.from({ length: WAKE_SLOTS }, () => new THREE.Vector2(0, 0)),
    },
    uWakeTime: {
      value: new Array<number>(WAKE_SLOTS).fill(0),
    },
    uWakeAngle: {
      value: new Array<number>(WAKE_SLOTS).fill(0),
    },
    uWakeAmplitude: {
      value: new Array<number>(WAKE_SLOTS).fill(0),
    },
    uWakeLifetime: { value: WAKE_LIFETIME_S },
  };
}

export function WaterSurface() {
  const meshRef = useRef<THREE.Mesh>(null);
  const [uniforms] = useState(createUniforms);
  const glowIntensity = usePondStore((s) => s.glowIntensity);
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
  const nextWakeSlotRef = useRef<number>(0);

  // Story 2.10: elevation-sampler input buffer. Pre-allocated once and
  // mutated in place each useFrame tick so `sampleElevation()` reads
  // fresh state without the hot path allocating. LilyPad.useFrame
  // reads the sampler from the store and calls it per pad per frame.
  const elevationInputsRef = useRef<ElevationInputs>({
    clickSlots: Array.from(
      { length: CLICK_SLOTS },
      (): RippleSlot => ({
        centerX: 0,
        centerY: 0,
        startTime: 0,
        amplitude: 0,
      }),
    ),
    ambientSlots: Array.from(
      { length: AMBIENT_SLOTS },
      (): AmbientRippleSlot => ({
        centerX: 0,
        centerY: 0,
        startTime: 0,
        amplitude: 0,
        decayRate: 0,
      }),
    ),
    ambientWavefrontSpeed: AMBIENT_WAVEFRONT_SPEED,
    elapsedTime: 0,
  });

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh || !mesh.material) return;
    const material = mesh.material as THREE.ShaderMaterial;
    if (!material.uniforms) return;
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uGlowIntensity.value = glowIntensity;

    // Story 2.9 AC #2: drain the ripple queue. Each enqueued ripple lands
    // in its own click slot, so two `triggerRipple` calls on the same JS
    // tick now both apply (pre-2.9 a single-slot `dropRipple` field
    // coalesced simultaneous writes into one). Read imperatively via
    // getState() to avoid a re-render on every enqueue. The shader
    // plane is rotated -90° about X, so world-Z → local-Y needs a flip
    // at uniform-write time; the store holds world coords throughout.
    //
    // Story 2.10 CR-patch: this drain MUST run before the elevation-
    // buffer refresh below — otherwise a ripple triggered on this tick
    // writes the uniform after the buffer snapshot, and LilyPad.useFrame
    // (same tick) reads stale slots → one-frame delay on pad-riding.
    const storeState = usePondStore.getState();
    const queued = storeState.dropRipples;
    if (queued.length > 0) {
      const dropCenters =
        material.uniforms.uDropCenter.value as THREE.Vector2[];
      const dropTimes = material.uniforms.uDropTime.value as number[];
      const dropAmps = material.uniforms.uDropAmplitude.value as number[];
      for (const { worldX, worldZ } of queued) {
        const clickSlot = nextClickSlotRef.current;
        dropCenters[clickSlot].set(worldX, -worldZ);
        dropTimes[clickSlot] = state.clock.elapsedTime;
        dropAmps[clickSlot] =
          CLICK_AMPLITUDE_MIN +
          Math.random() * (CLICK_AMPLITUDE_MAX - CLICK_AMPLITUDE_MIN);
        nextClickSlotRef.current = (clickSlot + 1) % CLICK_SLOTS;
      }
      storeState.drainRipples();
    }

    // Story 4.6 AC #16: drain the wake queue. Same pattern as the click-
    // ripple drain above — LilyPad writes world-space (x, z, angle) into
    // the store; here we flip world-Z → local-Y for the center and negate
    // the angle (motion direction's Y-component flips under the same
    // rotation). Shader gates lifetime via elapsed-time check in wake().
    const queuedWakes = storeState.wakes;
    if (queuedWakes.length > 0) {
      const wakeCenters = material.uniforms.uWakeCenter.value as THREE.Vector2[];
      const wakeTimes = material.uniforms.uWakeTime.value as number[];
      const wakeAngles = material.uniforms.uWakeAngle.value as number[];
      const wakeAmps = material.uniforms.uWakeAmplitude.value as number[];
      for (const w of queuedWakes) {
        const slot = nextWakeSlotRef.current;
        wakeCenters[slot].set(w.x, -w.z);
        wakeTimes[slot] = state.clock.elapsedTime;
        wakeAngles[slot] = -w.angle;
        // Per-wake amplitude: small enough that the wake reads as
        // "disturbance" rather than a splash. Tuned so multiple
        // overlapping wakes stack to a visible trail without
        // overwhelming the ambient wave pattern.
        wakeAmps[slot] = 0.18;
        nextWakeSlotRef.current = (slot + 1) % WAKE_SLOTS;
      }
      storeState.drainWakes();
    }

    if (pendingAmbientRef.current) {
      const { x, z, decayRate, amplitude } = pendingAmbientRef.current;
      const slot = nextAmbientSlotRef.current;
      const centers = material.uniforms.uAmbientCenter.value as THREE.Vector2[];
      const times = material.uniforms.uAmbientTime.value as number[];
      const decays = material.uniforms.uAmbientDecayRate.value as number[];
      const amps = material.uniforms.uAmbientAmplitude.value as number[];
      // Same world-Z → local-Y flip as the click-ripple drain above.
      centers[slot].set(x, -z);
      times[slot] = state.clock.elapsedTime;
      decays[slot] = decayRate;
      amps[slot] = amplitude;
      nextAmbientSlotRef.current = (slot + 1) % AMBIENT_SLOTS;
      pendingAmbientRef.current = null;
    }

    // Story 2.10: refresh the elevation-sampler input buffer from the
    // uniform arrays. Mutate in place — no allocations. Runs AFTER both
    // drain blocks above so brand-new ripples triggered this tick are
    // visible to LilyPad.useFrame (called later in the same R3F frame
    // via the store's imperative sampler handle).
    {
      const buf = elevationInputsRef.current;
      buf.elapsedTime = state.clock.elapsedTime;
      const uClickCenters = material.uniforms.uDropCenter.value as THREE.Vector2[];
      const uClickTimes = material.uniforms.uDropTime.value as number[];
      const uClickAmps = material.uniforms.uDropAmplitude.value as number[];
      for (let i = 0; i < CLICK_SLOTS; i++) {
        const slot = buf.clickSlots[i];
        slot.centerX = uClickCenters[i].x;
        slot.centerY = uClickCenters[i].y;
        slot.startTime = uClickTimes[i];
        slot.amplitude = uClickAmps[i];
      }
      const uAmbCenters = material.uniforms.uAmbientCenter.value as THREE.Vector2[];
      const uAmbTimes = material.uniforms.uAmbientTime.value as number[];
      const uAmbAmps = material.uniforms.uAmbientAmplitude.value as number[];
      const uAmbDecay = material.uniforms.uAmbientDecayRate.value as number[];
      for (let i = 0; i < AMBIENT_SLOTS; i++) {
        const slot = buf.ambientSlots[i];
        slot.centerX = uAmbCenters[i].x;
        slot.centerY = uAmbCenters[i].y;
        slot.startTime = uAmbTimes[i];
        slot.amplitude = uAmbAmps[i];
        slot.decayRate = uAmbDecay[i];
      }
    }
  });

  // Story 2.10: register the elevation sampler with the store on mount
  // so any consumer (LilyPad.useFrame, future floating creatures) can
  // sample the water surface imperatively. Closes over the ref whose
  // contents are updated by the useFrame tick above, so callers always
  // read the latest uniform state without allocating. Reset to a no-op
  // (returns 0 = flat water) on unmount.
  useEffect(() => {
    const sampler = (worldX: number, worldZ: number): number =>
      sampleElevation(worldX, worldZ, elevationInputsRef.current);
    usePondStore.getState().registerElevationSampler(sampler);
    return () => {
      usePondStore.getState().unregisterElevationSampler();
    };
  }, []);

  // Schedule occasional ambient ripples at random positions across the
  // pond. Chain setTimeouts so each delay is independently randomized
  // (setInterval gives fixed cadence, which reads as mechanical). A
  // ~20% skip chance on each tick creates occasional longer calms —
  // EXCEPT on the very first scheduled tick (story 2.9 AC #4), where
  // the skip check is bypassed so the pond is guaranteed to show a
  // ripple by ≈ AMBIENT_RIPPLE_FIRST_DELAY_MS on cold load.
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
    const schedule = (delayMs: number, isFirst: boolean) => {
      timeoutId = window.setTimeout(() => {
        // AC #4: always queue the first ripple; skip-probability only
        // applies from the second tick onward (pathological RNG could
        // otherwise leave the pond frozen for 8s+ after load).
        if (isFirst || Math.random() >= AMBIENT_SKIP_PROBABILITY) {
          queueOne();
        }
        const nextDelay =
          AMBIENT_RIPPLE_MIN_DELAY_MS +
          Math.random() *
            (AMBIENT_RIPPLE_MAX_DELAY_MS - AMBIENT_RIPPLE_MIN_DELAY_MS);
        schedule(nextDelay, false);
      }, delayMs);
    };
    schedule(AMBIENT_RIPPLE_FIRST_DELAY_MS, true);
    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      // Story 2.9 AC #7: also drop any pending ambient queued between
      // the last scheduler fire and cleanup. pendingAmbientRef is per-
      // instance today so this is theoretical, but if anyone refactors
      // to a shared ref the leak would become real.
      pendingAmbientRef.current = null;
    };
  }, []);

  // Click anywhere on the water surface → radiating ripple at the click
  // point. R3F's raycaster hands us the world-space intersection as
  // `e.point`. Lily-pad clicks stopPropagation before this fires, so
  // clicking a pad does NOT ripple the water — only empty-water clicks do.
  //
  // Popup dismissal on water-click is owned by `PondCamera.handlePointerUp`
  // (native `pointerup` fires before `click` per DOM event order). When
  // the popup is open and the user clicks water: PondCamera closes it;
  // this handler then fires a ripple at the click point. Net UX:
  // popup dismisses AND the water ripples where the dismiss click
  // landed — the ripple reads as tactile "click landed" feedback and
  // doesn't obstruct the dismiss. Resolves story 2.9 AC #3 as option
  // (b) "close-and-ripple" per the 2026-04-20 code review.
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
