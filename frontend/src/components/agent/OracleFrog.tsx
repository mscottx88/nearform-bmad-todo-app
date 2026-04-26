/**
 * Story 6.7: the Oracle Frog mesh.
 *
 * Procedural geometry — no GLB/GLTF asset. Body is assembled from
 * primitive geometries grouped under a single <group> so the whole
 * frog can sway / lean / hop together. Outline is a single closed
 * Catmull-Rom curve wrapped in a TubeGeometry so it reads as a
 * smooth flowing neon contour rather than the triangulated edges of
 * the body geometry. Eyes are small <sphereGeometry> instances with
 * a basic neon-green material.
 *
 * Animation:
 *   - One useFrame loop reads `agentState` from useAgentStore and
 *     drives per-state body / eye / emissive math.
 *   - prefers-reduced-motion is read once on mount into a useRef and
 *     cached; when set, body / eye motion is skipped but emissive
 *     intensity still ramps so state changes remain visible.
 *   - The throat-sac scale-pulse on each `chunk` event is queued via
 *     a subscription to streamingBuffer length so we get one pulse
 *     per chunk arrival (the buffer length only ever grows; new
 *     chunks bump it).
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAgentStore, type OracleAgentState } from '../../stores/useAgentStore';
import {
  createFrogOutlineGeometry,
  FROG_EMISSIVE_INTENSITY,
} from './oracleFrogGeometry';

const NEON_CYAN = '#00eeff';
const NEON_GREEN = '#39ff14';
// AC 4 'error' branch: emissive shifts toward red-orange for ~1500ms
// then reverts to cyan. Held as a literal because Three.js material
// constructors don't read CSS variables.
const NEON_ERROR = '#ff6600';

const SUCCESS_HOP_HEIGHT = 0.15;
const SUCCESS_HOP_DURATION_S = 0.5;
const ERROR_DURATION_S = 0.6;
const ERROR_COLOUR_REVERT_S = 1.5;
// Each chunk pushes one entry onto the throat-pulse queue; entries
// expire after CHUNK_PULSE_DURATION_S so the throat reads as "still
// puffing the last word" between chunks.
const CHUNK_PULSE_DURATION_S = 0.6;

interface Props {
  /**
   * Emissive intensity scale — applied as a multiplier over the
   * AC 4 per-state values. Defaults to 1.0 (full intensity). The
   * aquarium-window <View> sometimes runs without postprocessing,
   * so callers can boost the emissive there to compensate.
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

export function OracleFrog({ emissiveScale = 1.0 }: Props) {
  // Whole-frog group; transforms drive sway / lean / hop.
  const groupRef = useRef<THREE.Group>(null);
  // Body mesh — emissive material lives here so per-state intensity
  // ramps mutate one place.
  const bodyMaterialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  // Eye + throat refs — animated independently.
  const leftEyeRef = useRef<THREE.Mesh>(null);
  const rightEyeRef = useRef<THREE.Mesh>(null);
  const throatRef = useRef<THREE.Mesh>(null);

  // Per-mount random phase so multiple frogs (e.g. main view + the
  // aquarium-window duplicate) don't blink in lockstep.
  const seedRef = useRef<number>(Math.random() * Math.PI * 2);

  // Per-mount blink schedule: next blink time + duration.
  const nextBlinkAtRef = useRef<number>(0);
  const blinkUntilRef = useRef<number>(0);

  // Reduce-motion preference — read ONCE on mount per Dev Notes.
  const reduceMotionRef = useRef<boolean>(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    reduceMotionRef.current = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
  }, []);

  // One-shot animation tracking: hop on transition into 'success',
  // contract pose on transition into 'error'. We track the previous
  // state to detect the transition edge.
  const prevStateRef = useRef<OracleAgentState>('idle');
  const successHopRef = useRef<SuccessHop | null>(null);
  const errorPoseRef = useRef<ErrorPose | null>(null);

  // Throat-sac pulse queue. Subscribed to streamingBuffer length —
  // each chunk grows the buffer; we push a pulse per growth event.
  const throatPulsesRef = useRef<ChunkPulse[]>([]);
  useEffect(() => {
    let lastLen = useAgentStore.getState().streamingBuffer.length;
    const unsub = useAgentStore.subscribe((state) => {
      const len = state.streamingBuffer.length;
      if (len > lastLen) {
        throatPulsesRef.current.push({ startedAt: performance.now() / 1000 });
        // Cap the queue so a hyper-chunky stream doesn't grow it
        // unbounded; older entries past the active window are
        // pruned in useFrame anyway, this is a safety belt.
        if (throatPulsesRef.current.length > 16) {
          throatPulsesRef.current.shift();
        }
      }
      lastLen = len;
    });
    return unsub;
  }, []);

  // Outline geometry — built once per mount.
  const outlineGeom = useMemo(() => createFrogOutlineGeometry().tube, []);
  // Dispose the outline tube when the component unmounts to free
  // GPU buffers — the Three.js GC won't clean it on its own.
  useEffect(() => () => outlineGeom.dispose(), [outlineGeom]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const seed = seedRef.current;
    const reduceMotion = reduceMotionRef.current;
    const agentState = useAgentStore.getState().agentState;

    // ── Edge-detection for one-shot animations ──
    if (prevStateRef.current !== agentState) {
      if (agentState === 'success') {
        successHopRef.current = { startedAt: t };
      }
      if (agentState === 'error') {
        errorPoseRef.current = { startedAt: t };
        // Tint emissive immediately on entering error.
        bodyMaterialRef.current?.emissive.set(NEON_ERROR);
      }
      // Leaving 'error' (revert ~2s after error event fires; here we
      // also revert the emissive colour back to cyan once enough
      // time has passed — covered by the per-frame check below).
      prevStateRef.current = agentState;
    }

    // ── Emissive intensity (always runs, even with reduce-motion) ──
    const baseIntensity = pickEmissive(agentState);
    let emissiveIntensity = baseIntensity;
    // Success flash: brief 1.2 → 0.4 ramp over 200ms after the hop's
    // first 200ms. Decoupled from the body hop so the flash reads
    // even with reduce-motion on.
    if (agentState === 'success' && successHopRef.current) {
      const dt = t - successHopRef.current.startedAt;
      // 0..0.2s: full 1.2 flash. 0.2..0.4s: linear decay to idle 0.4.
      if (dt < 0.2) {
        emissiveIntensity = 1.2;
      } else if (dt < 0.4) {
        emissiveIntensity = 1.2 - (1.2 - 0.4) * ((dt - 0.2) / 0.2);
      } else {
        emissiveIntensity = 0.4;
      }
    }
    if (bodyMaterialRef.current) {
      bodyMaterialRef.current.emissiveIntensity = emissiveIntensity * emissiveScale;
    }

    // ── Error → emissive colour revert ──
    if (errorPoseRef.current) {
      const dt = t - errorPoseRef.current.startedAt;
      if (dt > ERROR_COLOUR_REVERT_S && bodyMaterialRef.current) {
        bodyMaterialRef.current.emissive.set(NEON_CYAN);
        // Leave errorPoseRef set until the contract pose finishes
        // (handled below) — only the colour revert is independent.
      }
    }

    // ── Reduce-motion: skip body / eye position math ──
    if (reduceMotion) {
      // Still tick the throat pulse queue cleanup so it doesn't grow
      // unbounded across long sessions.
      pruneThroatPulses(throatPulsesRef.current, t);
      return;
    }

    // ── Body group transforms ──
    const group = groupRef.current;
    if (group) {
      // Reset to a known baseline each frame; per-state branches
      // override what matters.
      group.position.x = 0;
      group.position.y = 0;
      group.position.z = 0;
      group.rotation.x = 0;
      group.rotation.y = 0;
      group.rotation.z = 0;
      group.scale.setScalar(1);

      switch (agentState) {
        case 'idle': {
          // Gentle Y-axis sway, period ~3s, ±0.04
          group.position.y = Math.sin((t * 2 * Math.PI) / 3 + seed) * 0.04;
          break;
        }
        case 'listening': {
          group.rotation.x = 0.15;
          group.rotation.z = Math.sin(t * 1.2 + seed) * 0.05;
          break;
        }
        case 'thinking': {
          // Body upright; eyes track horizontally — handled below.
          break;
        }
        case 'speaking': {
          // Body upright; throat sac pulses (handled below).
          break;
        }
        case 'success': {
          if (successHopRef.current) {
            const dt = t - successHopRef.current.startedAt;
            if (dt < SUCCESS_HOP_DURATION_S) {
              const u = dt / SUCCESS_HOP_DURATION_S;
              // Ease-out arc: parabola peaking at u=0.5.
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
              // Contract: scale 1 → 0.92 then back; same drooping rotation.
              const contract = 1 - 0.08 * Math.sin(u * Math.PI);
              group.scale.setScalar(contract);
              group.rotation.x = -0.15 * Math.sin(u * Math.PI);
            }
          }
          break;
        }
      }
    }

    // ── Eyes ──
    const leftEye = leftEyeRef.current;
    const rightEye = rightEyeRef.current;
    if (leftEye && rightEye) {
      // Reset eye positions to their rest offsets each frame; the
      // 'thinking' branch overrides position.x.
      const eyeY = leftEye.userData.restY ?? leftEye.position.y;
      const leftRestX = leftEye.userData.restX ?? leftEye.position.x;
      const rightRestX = rightEye.userData.restX ?? rightEye.position.x;
      leftEye.position.x = leftRestX;
      rightEye.position.x = rightRestX;
      leftEye.position.y = eyeY;
      rightEye.position.y = eyeY;

      // Per-state eye Y-scale (open/closed/wide/squinch).
      let yScale = 0.4; // idle baseline (half-closed)
      switch (agentState) {
        case 'listening':
          yScale = 1.2;
          break;
        case 'thinking':
        case 'speaking':
          yScale = 0.6;
          break;
        case 'success':
          // Eye crinkle — brief inflate to 0.8 over the hop window.
          if (successHopRef.current) {
            const dt = t - successHopRef.current.startedAt;
            if (dt < SUCCESS_HOP_DURATION_S) {
              yScale = 0.8;
            }
          }
          break;
        case 'error':
          yScale = 0.4;
          break;
      }

      // Idle blink: random ~4-6s schedule; close eyes (yScale -> 0.05) for ~120ms.
      if (agentState === 'idle') {
        if (t > nextBlinkAtRef.current && t > blinkUntilRef.current) {
          // Schedule a fresh blink with the current frame as start.
          blinkUntilRef.current = t + 0.12;
          nextBlinkAtRef.current = t + 4 + Math.random() * 2;
        }
        if (t < blinkUntilRef.current) {
          yScale = 0.05;
        }
      }

      leftEye.scale.y = yScale;
      rightEye.scale.y = yScale;

      // Thinking: eyes track left → right, period ~1.5s; modulate
      // eye position.x within ±0.02 around the rest offset.
      if (agentState === 'thinking') {
        const tx = Math.sin((t * 2 * Math.PI) / 1.5) * 0.02;
        leftEye.position.x = leftRestX + tx;
        rightEye.position.x = rightRestX + tx;
      }
    }

    // ── Throat sac ──
    const throat = throatRef.current;
    if (throat) {
      const pulses = throatPulsesRef.current;
      pruneThroatPulses(pulses, t);
      if (agentState === 'speaking' && pulses.length > 0) {
        // Sum overlapping pulse contributions (with attenuation) so
        // a burst of chunks reads as a sustained inflate; otherwise
        // a single pulse ramps up then back to rest.
        let inflate = 0;
        for (const p of pulses) {
          const dt = t - p.startedAt;
          if (dt < 0 || dt > CHUNK_PULSE_DURATION_S) continue;
          const u = dt / CHUNK_PULSE_DURATION_S;
          // Triangular envelope: 0 → 1 → 0 over the pulse window.
          const env = u < 0.4 ? u / 0.4 : 1 - (u - 0.4) / 0.6;
          inflate = Math.max(inflate, env);
        }
        throat.scale.setScalar(1 + inflate * 0.6);
      } else {
        throat.scale.setScalar(1);
      }
    }
  });

  return (
    <group ref={groupRef}>
      {/* Body — ellipsoid (sphere stretched in z). */}
      <mesh>
        <sphereGeometry args={[0.32, 24, 16]} />
        <meshPhysicalMaterial
          ref={bodyMaterialRef}
          color={NEON_CYAN}
          emissive={NEON_CYAN}
          emissiveIntensity={FROG_EMISSIVE_INTENSITY.idle}
          transmission={0.3}
          opacity={0.55}
          transparent
          roughness={0.15}
          metalness={0}
          ior={1.4}
        />
      </mesh>
      {/* Head — smaller sphere offset forward. */}
      <mesh position={[0, 0.18, 0.30]}>
        <sphereGeometry args={[0.20, 20, 14]} />
        <meshPhysicalMaterial
          color={NEON_CYAN}
          emissive={NEON_CYAN}
          emissiveIntensity={FROG_EMISSIVE_INTENSITY.idle}
          transmission={0.3}
          opacity={0.55}
          transparent
          roughness={0.15}
          metalness={0}
          ior={1.4}
        />
      </mesh>
      {/* Back legs — capsules along the haunch. */}
      <mesh position={[0.22, 0.05, -0.18]} rotation={[0, 0, -0.3]}>
        <capsuleGeometry args={[0.06, 0.18, 4, 8]} />
        <meshPhysicalMaterial
          color={NEON_CYAN}
          emissive={NEON_CYAN}
          emissiveIntensity={FROG_EMISSIVE_INTENSITY.idle}
          transmission={0.3}
          opacity={0.55}
          transparent
          roughness={0.15}
          metalness={0}
          ior={1.4}
        />
      </mesh>
      <mesh position={[-0.22, 0.05, -0.18]} rotation={[0, 0, 0.3]}>
        <capsuleGeometry args={[0.06, 0.18, 4, 8]} />
        <meshPhysicalMaterial
          color={NEON_CYAN}
          emissive={NEON_CYAN}
          emissiveIntensity={FROG_EMISSIVE_INTENSITY.idle}
          transmission={0.3}
          opacity={0.55}
          transparent
          roughness={0.15}
          metalness={0}
          ior={1.4}
        />
      </mesh>
      {/* Front legs — shorter, forward-leaning. */}
      <mesh position={[0.18, 0.0, 0.18]} rotation={[0.6, 0, -0.2]}>
        <capsuleGeometry args={[0.045, 0.13, 4, 6]} />
        <meshPhysicalMaterial
          color={NEON_CYAN}
          emissive={NEON_CYAN}
          emissiveIntensity={FROG_EMISSIVE_INTENSITY.idle}
          transmission={0.3}
          opacity={0.55}
          transparent
          roughness={0.15}
          metalness={0}
          ior={1.4}
        />
      </mesh>
      <mesh position={[-0.18, 0.0, 0.18]} rotation={[0.6, 0, 0.2]}>
        <capsuleGeometry args={[0.045, 0.13, 4, 6]} />
        <meshPhysicalMaterial
          color={NEON_CYAN}
          emissive={NEON_CYAN}
          emissiveIntensity={FROG_EMISSIVE_INTENSITY.idle}
          transmission={0.3}
          opacity={0.55}
          transparent
          roughness={0.15}
          metalness={0}
          ior={1.4}
        />
      </mesh>
      {/* Eyes — small bright neon-green spheres on top of the head. */}
      <mesh
        ref={leftEyeRef}
        position={[-0.09, 0.34, 0.36]}
        userData={{ restX: -0.09, restY: 0.34 }}
      >
        <sphereGeometry args={[0.04, 12, 8]} />
        <meshBasicMaterial color={NEON_GREEN} />
      </mesh>
      <mesh
        ref={rightEyeRef}
        position={[0.09, 0.34, 0.36]}
        userData={{ restX: 0.09, restY: 0.34 }}
      >
        <sphereGeometry args={[0.04, 12, 8]} />
        <meshBasicMaterial color={NEON_GREEN} />
      </mesh>
      {/* Throat sac — small sphere under the chin; inflates per chunk. */}
      <mesh ref={throatRef} position={[0, 0.06, 0.42]}>
        <sphereGeometry args={[0.07, 14, 10]} />
        <meshPhysicalMaterial
          color={NEON_CYAN}
          emissive={NEON_CYAN}
          emissiveIntensity={0.6}
          transmission={0.4}
          opacity={0.65}
          transparent
          roughness={0.18}
          metalness={0}
          ior={1.4}
        />
      </mesh>
      {/* Outline — single closed Catmull-Rom curve wrapped in a tube. */}
      <mesh geometry={outlineGeom}>
        <meshBasicMaterial color={NEON_CYAN} transparent opacity={0.95} />
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
  // Drop entries whose lifetime is past — front-of-queue first since
  // pulses are appended in order.
  while (pulses.length > 0 && t - pulses[0].startedAt > CHUNK_PULSE_DURATION_S) {
    pulses.shift();
  }
}
