/**
 * Story 6.7: orchestrator for the Oracle Frog + his lily pad.
 *
 * Responsibilities:
 *   1. Seed the persisted home position on first mount, idempotent —
 *      never overwrites an existing value.
 *   2. Drive the boundary-return state machine (dissolve → teleport →
 *      rematerialize) when the pad's current position drifts more
 *      than `ORACLE_BOUNDARY_RADIUS` world-units from home.
 *   3. **Sample the water elevation each frame and ride it.** Both
 *      the pad AND the frog share a single parent `<group>` whose
 *      Y position is updated to match the water surface, so the
 *      frog rides the pad — no independent bob (per user feedback
 *      2026-04-25).
 *   4. Render `<OracleLilyPad>` + `<OracleFrog>` together so the
 *      frog inherits the pad's transform.
 *
 * The boundary-return is purely defensive in v1 — no code today
 * applies horizontal drift to the oracle pad. The animation exists
 * so the safety net is visible the moment it's ever needed.
 */

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAgentStore } from '../../stores/useAgentStore';
import { usePondStore } from '../../stores/usePondStore';
import { OracleFrog } from './OracleFrog';
import { OracleLilyPad, ORACLE_PAD_RADIUS } from './OracleLilyPad';

// Tunable defaults per AC 3 — module-scope so future changes happen
// in one place rather than scattered across the state machine body.
export const ORACLE_HOME_POSITION = { x: -3.5, z: 3.5 } as const;
export const ORACLE_BOUNDARY_RADIUS = 1.0;
export const ORACLE_RETURN_DURATION_MS = 1500;
const DISSOLVE_DURATION_MS = 500;
const TELEPORT_DURATION_MS = 100;
// 1500 - 500 - 100 = 900 ms rematerialize.

type ReturnPhase = 'idle' | 'dissolving' | 'teleporting' | 'rematerializing';

// Frog mesh half-width (X / Z) at scale=1 — derived from the body
// ellipsoid in OracleFrog.tsx (max |x| ≈ 0.45 after the [1.4, 0.55,
// 1.0] body scale). Used to compute the per-pad fill ratio so the
// frog fills ~85% of the pad's diameter regardless of how
// PAD_RADIUS evolves.
const FROG_BASE_RADIUS = 0.45;
const FROG_PAD_FILL_RATIO = 0.85;

// Water-bob lerp rate. Matches the regular LilyPad's RIDE_LERP so
// the oracle pad rides the surface with the same responsiveness as
// every other pad in the pond.
const RIDE_LERP = 0.08;

interface PhaseStart {
  startedAt: number;
}

interface Props {
  /**
   * Optional override of the displayed pad/frog scale. Defaults to
   * 1.0 — the main scene always uses 1.0 so the oracle pad matches
   * regular lily pads in size.
   */
  scale?: number;
}

export function OracleFrogManager({ scale = 1.0 }: Props) {
  const persistedHome = useAgentStore((s) => s.oraclePadPosition);

  // Boundary-return phase machine — useRef for the phase + start
  // timestamp (mutated inside useFrame), useState to force a
  // re-render when the phase changes so opacity/visible props flip.
  const phaseRef = useRef<ReturnPhase>('idle');
  const phaseStartRef = useRef<PhaseStart | null>(null);
  const [phaseTick, setPhaseTick] = useState(0);

  // Parent group ref — its world position is updated each frame to
  // match the water surface elevation at the pad's home (x, z), so
  // both pad AND frog ride together.
  const padGroupRef = useRef<THREE.Group>(null);
  // Smoothed Y elevation. Lerps toward the sampled value via
  // RIDE_LERP so jitter is filtered out the same way the regular
  // LilyPad does.
  const rideElevationRef = useRef<number>(0);

  // First-mount idempotent home initialiser per AC 2.
  useEffect(() => {
    const store = useAgentStore.getState();
    if (store.oraclePadPosition === null) {
      store.setOraclePadPosition({ ...ORACLE_HOME_POSITION });
    }
  }, []);

  // Reduce-motion gate (AC 3) — read once on mount.
  const reduceMotionRef = useRef<boolean>(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    reduceMotionRef.current = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
  }, []);

  useFrame(() => {
    if (persistedHome === null) return;
    const group = padGroupRef.current;
    if (group === null) return;
    const now = performance.now();

    // ── Water bob: sample elevation at the home position and lerp
    //    the parent group's Y toward it. The pad sits at local Y =
    //    0 inside the group; the frog at local Y = pad-thickness so
    //    it sits ON the pad surface. Both ride the parent group's
    //    Y, which matches the water surface. ──
    const sample = usePondStore.getState().sampleElevation;
    const targetElev = reduceMotionRef.current
      ? 0
      : sample(persistedHome.x, persistedHome.z);
    rideElevationRef.current +=
      (targetElev - rideElevationRef.current) * RIDE_LERP;

    // Drive horizontal position from the boundary-return state
    // machine. v1 has no drift source, so X/Z always = home.
    group.position.x = persistedHome.x;
    group.position.z = persistedHome.z;
    group.position.y = rideElevationRef.current;

    // ── Boundary-return phase machine ──
    // Currently the displayed pos is always the home (no horizontal
    // drift in v1), so the boundary check never trips. Kept for the
    // safety-net behaviour described in AC 3.
    if (phaseRef.current === 'idle') {
      if (
        hasDriftedPastBoundary(
          { x: group.position.x, z: group.position.z },
          persistedHome,
          ORACLE_BOUNDARY_RADIUS,
        )
      ) {
        if (reduceMotionRef.current) return;
        phaseRef.current = 'dissolving';
        phaseStartRef.current = { startedAt: now };
        setPhaseTick((n) => n + 1);
        return;
      }
    }

    const start = phaseStartRef.current;
    if (start === null) return;
    const dt = now - start.startedAt;

    if (phaseRef.current === 'dissolving' && dt >= DISSOLVE_DURATION_MS) {
      phaseRef.current = 'teleporting';
      phaseStartRef.current = { startedAt: now };
      setPhaseTick((n) => n + 1);
      return;
    }
    if (phaseRef.current === 'teleporting' && dt >= TELEPORT_DURATION_MS) {
      phaseRef.current = 'rematerializing';
      phaseStartRef.current = { startedAt: now };
      usePondStore.getState().triggerRipple(persistedHome.x, persistedHome.z);
      setPhaseTick((n) => n + 1);
      return;
    }
    if (
      phaseRef.current === 'rematerializing' &&
      dt >= ORACLE_RETURN_DURATION_MS - DISSOLVE_DURATION_MS - TELEPORT_DURATION_MS
    ) {
      phaseRef.current = 'idle';
      phaseStartRef.current = null;
      setPhaseTick((n) => n + 1);
      return;
    }
  });

  // Phase-derived opacity + visibility for the pad/frog. Computed
  // each render — phaseTick bumps trigger re-renders so the opacity
  // ramps visibly during dissolve / rematerialize. The lint rule
  // about "ref reads during render" trips here; the values are only
  // used by JSX props on the next paint and are intentionally
  // animation-state-driven.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  void phaseTick;
  const phase = phaseRef.current;
  const phaseStart = phaseStartRef.current;
  const opacity = computeOpacity(phase, phaseStart);
  const visible = phase !== 'teleporting';

  if (persistedHome === null) return null;

  return (
    <group ref={padGroupRef} scale={scale}>
      {/* Pad sits at the parent group's origin; the parent's
          position drives the water-bob ride. */}
      <OracleLilyPad position={[0, 0, 0]} opacity={opacity} visible={visible} />
      {/* Frog rides on top of the pad — local Y above the pad
          surface so its bounding box sits on top. Same parent group
          as the pad → frog rides whatever Y the pad rides. */}
      <group
        position={[0, 0.07, 0]}
        scale={(FROG_PAD_FILL_RATIO * ORACLE_PAD_RADIUS) / FROG_BASE_RADIUS}
        visible={visible}
      >
        <OracleFrog />
      </group>
    </group>
  );
}

/**
 * AC 3 boundary-detection helper. Pulled out as a pure function so
 * tests can call it directly. Returns true iff `current` is strictly
 * more than `radius` world-units from `home`.
 */
export function hasDriftedPastBoundary(
  current: { x: number; z: number },
  home: { x: number; z: number },
  radius: number,
): boolean {
  const dx = current.x - home.x;
  const dz = current.z - home.z;
  return Math.sqrt(dx * dx + dz * dz) > radius;
}

function computeOpacity(phase: ReturnPhase, start: PhaseStart | null): number {
  if (phase === 'idle') return 1;
  if (start === null) return 1;
  const dt = performance.now() - start.startedAt;
  if (phase === 'dissolving') {
    return Math.max(0, 1 - dt / DISSOLVE_DURATION_MS);
  }
  if (phase === 'teleporting') {
    return 0;
  }
  if (phase === 'rematerializing') {
    const remat =
      ORACLE_RETURN_DURATION_MS - DISSOLVE_DURATION_MS - TELEPORT_DURATION_MS;
    return Math.min(1, dt / remat);
  }
  return 1;
}
