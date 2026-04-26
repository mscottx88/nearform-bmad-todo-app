/**
 * Story 6.7: orchestrator for the Oracle Frog + his lily pad.
 *
 * Responsibilities:
 *   1. Seed the persisted home position on first mount, idempotent —
 *      never overwrites an existing value.
 *   2. Drive the boundary-return state machine (dissolve → teleport →
 *      rematerialize) when the pad's current position drifts more
 *      than `ORACLE_BOUNDARY_RADIUS` world-units from home.
 *   3. Render `<OracleLilyPad>` + `<OracleFrog>` together so the
 *      frog inherits the pad's transform.
 *
 * The boundary-return is purely defensive in v1 — no code today
 * applies drift to the oracle pad. The animation exists so the safety
 * net is visible the moment it's ever needed.
 */

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
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

// Frog mesh half-width (X / Z) at scale=1 — derived from the outline
// control points in oracleFrogGeometry.ts (max |x| ≈ 0.40, max |z| ≈
// 0.45). Used to compute the per-pad fill ratio so the frog fills
// ~85% of the pad's diameter regardless of how PAD_RADIUS evolves.
const FROG_BASE_RADIUS = 0.45;
const FROG_PAD_FILL_RATIO = 0.85;

interface PhaseStart {
  startedAt: number;
}

interface Props {
  /**
   * Optional override of the displayed pad/frog scale. The aquarium-
   * window <View> may want to render a slightly smaller pad to give
   * the frog room — but the main scene always uses 1.0 so the pad
   * matches regular lily pads in size. Defaults to 1.0.
   */
  scale?: number;
}

export function OracleFrogManager({ scale = 1.0 }: Props) {
  // Persisted home — read via selector so an external setOraclePadPosition
  // call (e.g. from a future test fixture) re-renders the manager.
  const persistedHome = useAgentStore((s) => s.oraclePadPosition);

  // Boundary-return phase machine — useRef for the phase + start
  // timestamp (mutated inside useFrame), useState to force a re-render
  // when the phase changes so opacity/visible props flip.
  const phaseRef = useRef<ReturnPhase>('idle');
  const phaseStartRef = useRef<PhaseStart | null>(null);
  const [phaseTick, setPhaseTick] = useState(0);

  // Current displayed position — distinct from the home position so
  // the dissolve+rematerialize phases can hide the pad mid-flight.
  // Today no drift source moves the pad off home, so `displayed`
  // tracks the home position exactly. The state machine still uses
  // it as the "current" comparison for the boundary check.
  const [displayedPos, setDisplayedPos] = useState<[number, number, number] | null>(
    null,
  );

  // First-mount idempotent home initialiser per AC 2.
  useEffect(() => {
    const store = useAgentStore.getState();
    if (store.oraclePadPosition === null) {
      store.setOraclePadPosition({ ...ORACLE_HOME_POSITION });
    }
  }, []);

  // Whenever the persisted home updates, reset the displayed position.
  useEffect(() => {
    if (persistedHome === null) return;
    setDisplayedPos([persistedHome.x, 0, persistedHome.z]);
  }, [persistedHome]);

  // Reduce-motion gate (AC 3) — read once on mount.
  const reduceMotionRef = useRef<boolean>(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    reduceMotionRef.current = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
  }, []);

  useFrame((state) => {
    if (persistedHome === null || displayedPos === null) return;
    const now = performance.now();

    // Boundary check (AC 3) — only when idle. If the pad drifts past
    // the radius, kick off the dissolve phase.
    if (phaseRef.current === 'idle') {
      if (
        hasDriftedPastBoundary(
          { x: displayedPos[0], z: displayedPos[2] },
          persistedHome,
          ORACLE_BOUNDARY_RADIUS,
        )
      ) {
        if (reduceMotionRef.current) {
          // Reduce-motion: instant snap, no dissolve / particle / ripple.
          setDisplayedPos([persistedHome.x, 0, persistedHome.z]);
          return;
        }
        phaseRef.current = 'dissolving';
        phaseStartRef.current = { startedAt: now };
        setPhaseTick((n) => n + 1);
        return;
      }
    }

    // Phase progression — driven by wall-clock so it's framerate-
    // independent. R3F's clock would also work but performance.now
    // is consistent with the Story 6.2 SSE-revert timers.
    const start = phaseStartRef.current;
    if (start === null) return;
    const dt = now - start.startedAt;

    if (phaseRef.current === 'dissolving' && dt >= DISSOLVE_DURATION_MS) {
      phaseRef.current = 'teleporting';
      phaseStartRef.current = { startedAt: now };
      setDisplayedPos([persistedHome.x, 0, persistedHome.z]);
      setPhaseTick((n) => n + 1);
      return;
    }
    if (phaseRef.current === 'teleporting' && dt >= TELEPORT_DURATION_MS) {
      phaseRef.current = 'rematerializing';
      phaseStartRef.current = { startedAt: now };
      // Fire a single ripple at the home position so the water
      // reacts to the frog's return.
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
    // The state's clock isn't strictly required here, but referencing
    // it satisfies useFrame's contract that the callback consume the
    // state to participate in render scheduling.
    void state.clock.elapsedTime;
  });

  // Phase-derived opacity + visibility for the pad/frog. Computed each
  // render — phaseTick bumps trigger re-renders so the opacity ramps
  // visibly during dissolve / rematerialize.
  void phaseTick;
  const opacity = computeOpacity(phaseRef.current, phaseStartRef.current);
  const visible = phaseRef.current !== 'teleporting';

  if (persistedHome === null || displayedPos === null) return null;

  return (
    <group scale={scale}>
      <OracleLilyPad position={displayedPos} opacity={opacity} visible={visible} />
      {/* Frog rides on top of the pad — local Y above the pad surface
          so its bounding box fills ~85% of the pad diameter (AC 1). */}
      <group
        position={[displayedPos[0], displayedPos[1] + 0.05, displayedPos[2]]}
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
 * tests can call it directly (no need to render the manager + tick a
 * mocked useFrame to verify the radial-distance threshold). Returns
 * true iff `current` is strictly more than `radius` world-units from
 * `home`.
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
