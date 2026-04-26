/**
 * Story 6.7: the Oracle Frog mesh.
 *
 * **Visual direction (per user reference images, 2026-04-25):**
 * neon-wireframe holographic frog. Reference shapes have:
 *   - a wide, low-profile body (frog sitting on its haunches);
 *   - large bulging eye spheres on top of the head with dark pupils;
 *   - splayed back legs in a folded "V" pose (knees out to sides);
 *   - short front legs propping the front of the body up;
 *   - all geometry rendered as wireframe with neon stroke + a faint
 *     glass-like fill so it reads as "lit volumetric wireframe"
 *     rather than a solid mesh.
 *
 * Each body part is rendered TWICE: once as a translucent glass
 * fill (MeshPhysicalMaterial with low opacity + emissive glow), and
 * once as a wireframe (MeshBasicMaterial wireframe=true) for the
 * bright neon outline. This double-render is cheap — these are
 * small geometries with low segment counts.
 *
 * Animation:
 *   - One useFrame loop reads `agentState` from useAgentStore and
 *     drives per-state body / eye / emissive math.
 *   - prefers-reduced-motion is read once on mount into a useRef
 *     and cached; when set, body / eye motion is skipped but
 *     emissive intensity still ramps so state changes remain
 *     visible.
 *   - Throat-sac scale-pulses on each `chunk` event are driven via
 *     a subscription to `streamingBuffer` length — each chunk grows
 *     the buffer and we push a pulse onto a small queue.
 */

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAgentStore, type OracleAgentState } from '../../stores/useAgentStore';
import { FROG_EMISSIVE_INTENSITY } from './oracleFrogGeometry';

const NEON_CYAN = '#00eeff';
const NEON_GREEN = '#39ff14';
const NEON_DARK = '#001818';
const NEON_ERROR = '#ff6600';

const SUCCESS_HOP_HEIGHT = 0.15;
const SUCCESS_HOP_DURATION_S = 0.5;
const ERROR_DURATION_S = 0.6;
const ERROR_COLOUR_REVERT_S = 1.5;
const CHUNK_PULSE_DURATION_S = 0.6;

interface Props {
  /**
   * Emissive intensity scale — applied as a multiplier over the
   * AC 4 per-state values. Defaults to 1.0. The aquarium-window
   * <View> sometimes runs without postprocessing, so callers can
   * boost the emissive there to compensate.
   */
  emissiveScale?: number;
}

interface SuccessHop {
  startedAt: number;
}

interface ErrorPose {
  startedAt: number;
}

interface ChunkPulse {
  startedAt: number;
}

/**
 * Reusable shared material builder for the body parts. Each part
 * renders one of these as the "glass fill" plus a wireframe overlay
 * with `<meshBasicMaterial wireframe />`.
 */
const GLASS_PROPS = {
  transmission: 0.4,
  opacity: 0.18,
  transparent: true,
  roughness: 0.2,
  metalness: 0,
  ior: 1.4,
};

export function OracleFrog({ emissiveScale = 1.0 }: Props) {
  const groupRef = useRef<THREE.Group>(null);

  // Materials we mutate per-state. Refs to the glass materials of
  // the body + head — emissive intensity ramps mutate these. The
  // wireframe overlays don't need to mutate since their colour is
  // already part of the "always-on" neon line.
  const bodyGlassRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const headGlassRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const bodyWireRef = useRef<THREE.MeshBasicMaterial>(null);
  const headWireRef = useRef<THREE.MeshBasicMaterial>(null);

  // Eye + throat refs — animated independently.
  const leftEyeRef = useRef<THREE.Group>(null);
  const rightEyeRef = useRef<THREE.Group>(null);
  const throatRef = useRef<THREE.Mesh>(null);
  const throatWireRef = useRef<THREE.Mesh>(null);

  // Lazy useState initialiser keeps the impure Math.random() call
  // out of the render body (react-hooks/components-and-hooks-must-be-pure).
  // Same pattern as Firefly.tsx.
  const [seed] = useState(() => Math.random() * Math.PI * 2);
  const nextBlinkAtRef = useRef<number>(0);
  const blinkUntilRef = useRef<number>(0);

  const reduceMotionRef = useRef<boolean>(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    reduceMotionRef.current = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
  }, []);

  const prevStateRef = useRef<OracleAgentState>('idle');
  const successHopRef = useRef<SuccessHop | null>(null);
  const errorPoseRef = useRef<ErrorPose | null>(null);

  const throatPulsesRef = useRef<ChunkPulse[]>([]);
  useEffect(() => {
    let lastLen = useAgentStore.getState().streamingBuffer.length;
    const unsub = useAgentStore.subscribe((state) => {
      const len = state.streamingBuffer.length;
      if (len > lastLen) {
        throatPulsesRef.current.push({ startedAt: performance.now() / 1000 });
        if (throatPulsesRef.current.length > 16) {
          throatPulsesRef.current.shift();
        }
      }
      lastLen = len;
    });
    return unsub;
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const reduceMotion = reduceMotionRef.current;
    const agentState = useAgentStore.getState().agentState;

    // ── Edge-detection for one-shot animations ──
    if (prevStateRef.current !== agentState) {
      if (agentState === 'success') {
        successHopRef.current = { startedAt: t };
      }
      if (agentState === 'error') {
        errorPoseRef.current = { startedAt: t };
        bodyGlassRef.current?.emissive.set(NEON_ERROR);
        headGlassRef.current?.emissive.set(NEON_ERROR);
        bodyWireRef.current?.color.set(NEON_ERROR);
        headWireRef.current?.color.set(NEON_ERROR);
      }
      prevStateRef.current = agentState;
    }

    // ── Emissive intensity (always runs, even with reduce-motion) ──
    const baseIntensity = pickEmissive(agentState);
    let emissiveIntensity = baseIntensity;
    if (agentState === 'success' && successHopRef.current) {
      const dt = t - successHopRef.current.startedAt;
      if (dt < 0.2) {
        emissiveIntensity = 1.2;
      } else if (dt < 0.4) {
        emissiveIntensity = 1.2 - (1.2 - 0.4) * ((dt - 0.2) / 0.2);
      } else {
        emissiveIntensity = 0.4;
      }
    }
    const eff = emissiveIntensity * emissiveScale;
    if (bodyGlassRef.current) bodyGlassRef.current.emissiveIntensity = eff;
    if (headGlassRef.current) headGlassRef.current.emissiveIntensity = eff;

    // ── Error → emissive colour revert after ~1.5s ──
    if (errorPoseRef.current) {
      const dt = t - errorPoseRef.current.startedAt;
      if (dt > ERROR_COLOUR_REVERT_S) {
        bodyGlassRef.current?.emissive.set(NEON_CYAN);
        headGlassRef.current?.emissive.set(NEON_CYAN);
        bodyWireRef.current?.color.set(NEON_CYAN);
        headWireRef.current?.color.set(NEON_CYAN);
      }
    }

    // ── Reduce-motion: skip body / eye position math ──
    if (reduceMotion) {
      pruneThroatPulses(throatPulsesRef.current, t);
      return;
    }

    // ── Body group transforms ──
    const group = groupRef.current;
    if (group) {
      group.position.x = 0;
      group.position.y = 0;
      group.position.z = 0;
      group.rotation.x = 0;
      group.rotation.y = 0;
      group.rotation.z = 0;
      group.scale.setScalar(1);

      switch (agentState) {
        case 'idle': {
          // No idle Y-sway here per user feedback (2026-04-25):
          // "the frog should ride the lily pad ... it should not
          // be floating up and down on its own". The pad's parent
          // group in OracleFrogManager bobs with the water surface;
          // the frog inherits that motion automatically.
          break;
        }
        case 'listening': {
          group.rotation.x = 0.15;
          group.rotation.z = Math.sin(t * 1.2 + seed) * 0.05;
          break;
        }
        case 'thinking':
        case 'speaking':
          break;
        case 'success': {
          if (successHopRef.current) {
            const dt = t - successHopRef.current.startedAt;
            if (dt < SUCCESS_HOP_DURATION_S) {
              const u = dt / SUCCESS_HOP_DURATION_S;
              group.position.y = SUCCESS_HOP_HEIGHT * 4 * u * (1 - u);
            } else {
              successHopRef.current = null;
            }
          }
          break;
        }
        case 'error': {
          if (errorPoseRef.current) {
            const dt = t - errorPoseRef.current.startedAt;
            if (dt < ERROR_DURATION_S) {
              const u = dt / ERROR_DURATION_S;
              const contract = 1 - 0.08 * Math.sin(u * Math.PI);
              group.scale.setScalar(contract);
              group.rotation.x = -0.15 * Math.sin(u * Math.PI);
            }
          }
          break;
        }
      }
    }

    // ── Eyes (groups now: each holds a sphere + pupil) ──
    const leftEye = leftEyeRef.current;
    const rightEye = rightEyeRef.current;
    if (leftEye && rightEye) {
      // Per-state eye Y-scale (open/closed/wide/squinch).
      let yScale = 1.0; // baseline — bulging eyes show fully
      switch (agentState) {
        case 'idle':
          yScale = 0.95;
          break;
        case 'listening':
          yScale = 1.15;
          break;
        case 'thinking':
        case 'speaking':
          yScale = 0.9;
          break;
        case 'success':
          if (successHopRef.current) {
            const dt = t - successHopRef.current.startedAt;
            if (dt < SUCCESS_HOP_DURATION_S) yScale = 0.7;
          }
          break;
        case 'error':
          yScale = 0.5;
          break;
      }

      // Idle blink: random ~4-6s schedule; close eyes briefly.
      if (agentState === 'idle') {
        if (t > nextBlinkAtRef.current && t > blinkUntilRef.current) {
          blinkUntilRef.current = t + 0.12;
          nextBlinkAtRef.current = t + 4 + Math.random() * 2;
        }
        if (t < blinkUntilRef.current) {
          yScale = 0.05;
        }
      }

      leftEye.scale.y = yScale;
      rightEye.scale.y = yScale;

      // Thinking: eyes track horizontally — modulate eye GROUP
      // rotation.y so the pupil shifts visibly within the bulge.
      if (agentState === 'thinking') {
        const tx = Math.sin((t * 2 * Math.PI) / 1.5) * 0.3;
        leftEye.rotation.y = tx;
        rightEye.rotation.y = tx;
      } else {
        leftEye.rotation.y = 0;
        rightEye.rotation.y = 0;
      }
    }

    // ── Throat sac ──
    const throat = throatRef.current;
    const throatWire = throatWireRef.current;
    if (throat) {
      const pulses = throatPulsesRef.current;
      pruneThroatPulses(pulses, t);
      let scale = 1;
      if (agentState === 'speaking' && pulses.length > 0) {
        let inflate = 0;
        for (const p of pulses) {
          const dt = t - p.startedAt;
          if (dt < 0 || dt > CHUNK_PULSE_DURATION_S) continue;
          const u = dt / CHUNK_PULSE_DURATION_S;
          const env = u < 0.4 ? u / 0.4 : 1 - (u - 0.4) / 0.6;
          inflate = Math.max(inflate, env);
        }
        scale = 1 + inflate * 0.6;
      }
      throat.scale.setScalar(scale);
      if (throatWire) throatWire.scale.setScalar(scale);
    }
  });

  return (
    <group ref={groupRef}>
      {/* ─── Body: wide flattened ellipsoid (frog sitting). ─────── */}
      {/* Glass fill */}
      <mesh scale={[1.4, 0.55, 1.0]}>
        <sphereGeometry args={[0.32, 20, 14]} />
        <meshPhysicalMaterial
          ref={bodyGlassRef}
          color={NEON_CYAN}
          emissive={NEON_CYAN}
          emissiveIntensity={FROG_EMISSIVE_INTENSITY.idle}
          {...GLASS_PROPS}
        />
      </mesh>
      {/* Wireframe overlay — bright neon edges. Lower segment
          count gives a more "low-poly" wireframe look closer to
          the reference images. */}
      <mesh scale={[1.4, 0.55, 1.0]}>
        <sphereGeometry args={[0.325, 14, 10]} />
        <meshBasicMaterial
          ref={bodyWireRef}
          color={NEON_CYAN}
          wireframe
          transparent
          opacity={0.95}
        />
      </mesh>

      {/* ─── Head: smaller flattened sphere in front of body. ──── */}
      <mesh position={[0, 0.04, 0.32]} scale={[1.0, 0.7, 0.85]}>
        <sphereGeometry args={[0.26, 18, 14]} />
        <meshPhysicalMaterial
          ref={headGlassRef}
          color={NEON_CYAN}
          emissive={NEON_CYAN}
          emissiveIntensity={FROG_EMISSIVE_INTENSITY.idle}
          {...GLASS_PROPS}
        />
      </mesh>
      <mesh position={[0, 0.04, 0.32]} scale={[1.0, 0.7, 0.85]}>
        <sphereGeometry args={[0.265, 12, 9]} />
        <meshBasicMaterial
          ref={headWireRef}
          color={NEON_CYAN}
          wireframe
          transparent
          opacity={0.95}
        />
      </mesh>

      {/* ─── Eyes: large bulging spheres ON TOP of the head. ───── */}
      {/* Each eye is a group so we can scale-Y for blinking and
          rotate-Y for tracking, while the pupil rides along. */}
      <group ref={leftEyeRef} position={[-0.13, 0.20, 0.36]}>
        {/* Eye sphere — bright neon green */}
        <mesh>
          <sphereGeometry args={[0.10, 14, 10]} />
          <meshBasicMaterial color={NEON_GREEN} />
        </mesh>
        {/* Wireframe overlay on the eye */}
        <mesh>
          <sphereGeometry args={[0.105, 10, 8]} />
          <meshBasicMaterial color={NEON_GREEN} wireframe transparent opacity={0.7} />
        </mesh>
        {/* Pupil — small dark sphere on the front of the eye. The
            parent group's rotation.y orbits this around the eye
            sphere so the pupil tracks left-right. */}
        <mesh position={[0, 0, 0.085]}>
          <sphereGeometry args={[0.04, 10, 8]} />
          <meshBasicMaterial color={NEON_DARK} />
        </mesh>
      </group>
      <group ref={rightEyeRef} position={[0.13, 0.20, 0.36]}>
        <mesh>
          <sphereGeometry args={[0.10, 14, 10]} />
          <meshBasicMaterial color={NEON_GREEN} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.105, 10, 8]} />
          <meshBasicMaterial color={NEON_GREEN} wireframe transparent opacity={0.7} />
        </mesh>
        <mesh position={[0, 0, 0.085]}>
          <sphereGeometry args={[0.04, 10, 8]} />
          <meshBasicMaterial color={NEON_DARK} />
        </mesh>
      </group>

      {/* ─── Back legs: folded haunches splayed sideways. ──────── */}
      {/* Upper haunch — capsule from hip OUT and slightly UP. */}
      <FrogLeg origin={[0.30, -0.02, -0.05]} rotation={[0, -0.3, -0.6]} />
      <FrogLeg origin={[-0.30, -0.02, -0.05]} rotation={[0, 0.3, 0.6]} />
      {/* Lower haunch / calf — capsule from knee BACK and DOWN.
          Approximate the bent knee by chaining two segments per
          side. The reference frog images all show the classic
          "sitting frog" bent-knee shape. */}
      <FrogLeg origin={[0.42, -0.06, -0.18]} rotation={[0.3, 0, -0.2]} length={0.18} radius={0.05} />
      <FrogLeg origin={[-0.42, -0.06, -0.18]} rotation={[0.3, 0, 0.2]} length={0.18} radius={0.05} />

      {/* ─── Front legs: short verticals propping the front. ──── */}
      <FrogLeg origin={[0.18, -0.13, 0.22]} rotation={[0.4, 0, 0]} length={0.13} radius={0.04} />
      <FrogLeg origin={[-0.18, -0.13, 0.22]} rotation={[0.4, 0, 0]} length={0.13} radius={0.04} />

      {/* ─── Throat sac: small sphere under the chin; pulses with chunks ── */}
      <mesh ref={throatRef} position={[0, -0.04, 0.46]}>
        <sphereGeometry args={[0.07, 12, 9]} />
        <meshPhysicalMaterial
          color={NEON_CYAN}
          emissive={NEON_CYAN}
          emissiveIntensity={0.6}
          transmission={0.4}
          opacity={0.45}
          transparent
          roughness={0.2}
          metalness={0}
          ior={1.4}
        />
      </mesh>
      <mesh ref={throatWireRef} position={[0, -0.04, 0.46]}>
        <sphereGeometry args={[0.075, 10, 8]} />
        <meshBasicMaterial color={NEON_CYAN} wireframe transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

interface LegProps {
  origin: [number, number, number];
  rotation: [number, number, number];
  length?: number;
  radius?: number;
}

function FrogLeg({ origin, rotation, length = 0.20, radius = 0.06 }: LegProps) {
  return (
    <group position={origin} rotation={rotation}>
      <mesh>
        <capsuleGeometry args={[radius, length, 4, 8]} />
        <meshPhysicalMaterial
          color={NEON_CYAN}
          emissive={NEON_CYAN}
          emissiveIntensity={FROG_EMISSIVE_INTENSITY.idle}
          {...GLASS_PROPS}
        />
      </mesh>
      <mesh>
        <capsuleGeometry args={[radius * 1.02, length, 3, 6]} />
        <meshBasicMaterial color={NEON_CYAN} wireframe transparent opacity={0.95} />
      </mesh>
    </group>
  );
}

function pickEmissive(s: OracleAgentState): number {
  if (s === 'idle') return FROG_EMISSIVE_INTENSITY.idle;
  if (s === 'listening') return FROG_EMISSIVE_INTENSITY.listening;
  if (s === 'thinking') return FROG_EMISSIVE_INTENSITY.thinking;
  if (s === 'speaking') return FROG_EMISSIVE_INTENSITY.speaking;
  if (s === 'success') return FROG_EMISSIVE_INTENSITY.success;
  return FROG_EMISSIVE_INTENSITY.error;
}

function pruneThroatPulses(pulses: ChunkPulse[], t: number): void {
  while (pulses.length > 0 && t - pulses[0].startedAt > CHUNK_PULSE_DURATION_S) {
    pulses.shift();
  }
}
