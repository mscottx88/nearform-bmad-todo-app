import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Todo } from '../../types';
import {
  usePondStore,
  selectCompleting,
  selectDeleting,
  selectTodoError,
  selectColorPreview,
  selectSearchHit,
  selectIsSelected,
} from '../../stores/usePondStore';
import {
  useUpdateTodoPositions,
  type UpdatePositionEntry,
} from '../../api/todoApi';
import { EmergingCreature } from '../creatures/EmergingCreature';
import { GlowSource } from './GlowSource';

// Story 4.2: drag + spread-out support.
// Module-scope so every pad shares the same Plane + scratch vectors
// rather than allocating on each pointermove / useFrame tick. The
// scratch objects are mutated in place during ray-plane
// intersection — callers read `worldDragPoint.x / .z` after
// `intersectPlane` returns truthy.
const WATER_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const worldDragPoint = new THREE.Vector3();
// Window-level pointermove does not carry a pre-computed ray the way
// R3F's ThreeEvent does, so we keep our own Raycaster + NDC Vector2
// to derive the water-plane hit from raw clientX/Y + camera + canvas.
const dragRaycaster = new THREE.Raycaster();
const dragNDC = new THREE.Vector2();
// Screen-space movement in px before a pointerDown is treated as a
// drag. 4 px matches the existing camera click-vs-drag threshold in
// PondCamera (see `Math.sqrt(dx² + dy²) > 5` — 4 here gives pads a
// slightly tighter click tolerance, which reads correctly for a
// direct-manipulation target vs. a camera orbit).
const DRAG_THRESHOLD_PX = 4;
// Arrival threshold for /spread-out — the pad fires PATCH and
// clears its target once both axes are within this world-unit gap.
// 0.05 matches the OrbitControls reset-arrive threshold used
// elsewhere; tight enough that the final snap is imperceptible,
// loose enough that the lerp actually lands in finite frames.
const SPREAD_ARRIVE_THRESHOLD = 0.05;

// 'completed' / 'deleted' are terminal phases — the dissolve finished
// locally and the pad is awaiting unmount. Distinct from 'completing' /
// 'deleting' so we can distinguish "happy-path finish" from "external
// cancel" in the recovery branch.
// 'waiting' + 'materializing' (story 2.6): stagger path for pads that
// existed in the DB before this session. They render invisibly at rest
// position during 'waiting', then scale in place during 'materializing'.
// No high drop, no ripple — existing pads aren't being created, they're
// just surfacing after a refresh.
//
// 'forming' / 'dropping' / 'settling' / 'pulsing' (story 2.2): creation
// path for brand-new pads (isRecent=true). Pad drops from the sky with
// ripple feedback so the user sees their thought land in the water.
type DropPhase =
  | 'waiting'
  | 'materializing'
  | 'forming'
  | 'dropping'
  | 'settling'
  | 'pulsing'
  | 'resting'
  | 'completing'
  | 'completed'
  | 'deleting'
  | 'deleted';

const DROP_Y_START = 3;
const DROP_Y_REST = 0.05;
const FORM_DURATION = 0.2;
const DROP_DURATION = 0.3;
const SETTLE_DURATION = 0.4;
// Story 2.6: staggered-load materialize window. Scale 0→1 at rest
// position, no elevation change, no ripple. Lighter than the creation
// drop arc because existing pads aren't being created.
const MATERIALIZE_DURATION = 0.4;
const PULSE_DURATION = 1.2; // 3 pulses over ~1.2 seconds
const PAD_RADIUS = 1.0;
const COMPLETED_Y = -0.1;
const COMPLETION_LERP = 0.05;
const RIM_HEIGHT = 0.07;
const SEGMENTS = 48;
const NOTCH_ANGLE = 0.08;

// Completion-sequence timings in seconds (R3F clock). Story 2.7 rebudgeted
// the original 1.6s total (2.4 spec) to 2.0s so the pulse window can match
// the creation `pulsing` phase's 1.2s duration 1:1 — complete/delete now
// feel identical to creation. Scale pulse + rim highlight run the full
// 1.2s; dissolve moves to 1.2→2.0s (duration unchanged at 0.8s).
//
// Note: the pad BODY is not highlighted during complete/delete (per 2.7
// iteration with Michael). The only color feedback is the ridge (rim)
// lerping toward the action color over the pulse window. The pad surface
// continues to render at its base `uColor` throughout the sequence.
const COMPLETING_EMERGE_START = 0.20;
const COMPLETING_EMERGE_END = 0.70;
const COMPLETING_PULSE_END = 1.20;     // matches creation PULSE_DURATION
const COMPLETING_DISSOLVE_START = 1.20;
const COMPLETING_DISSOLVE_END = 2.00;
const COMPLETING_TOTAL = 2.00;
// Rim target during the pulse window — HDR-range so the Bloom pass
// (luminanceThreshold 0.2 in PondScene) picks it up as a bright neon
// spike on the ridge rather than a dull LDR tint. Green channel pushed
// past 1.0 for HDR bloom contribution. LDR ~= #39ff14 (neon green).
const COMPLETE_RIM_COLOR = new THREE.Color().setRGB(0.3, 2.5, 0.15);

// Deletion-sequence timings mirror completion (story 2.7). No Emerge
// phase — no creature on delete.
const DELETING_PULSE_END = 1.20;
const DELETING_DISSOLVE_START = 1.20;
const DELETING_DISSOLVE_END = 2.00;
const DELETING_TOTAL = 2.00;
// Matching HDR treatment for the delete rim — LDR ~= #ff1744 (neon red).
const DELETE_RIM_COLOR = new THREE.Color().setRGB(2.5, 0.3, 0.7);

// Story 2.7 follow-up: HDR pad-body tint targets. Driven via the
// `uFlashColor` + `uFlashStrength` shader uniforms. Per Michael's
// direction the strength lerps across the ENTIRE 2.0s sequence (not
// just the 1.2s pulse) with a cubic ease-in — subtle at the start so
// the build doesn't read as "intense all at once", peaking at the
// moment the dissolve finishes and the pad disappears.
const COMPLETE_PAD_TINT = new THREE.Vector3(0.2, 2.0, 0.1);
const DELETE_PAD_TINT = new THREE.Vector3(2.0, 0.2, 0.5);
const PAD_TINT_MAX = 0.6;

// Selection ring — thin neon-white ring encircling the pad while it is in
// the multi-selection set (Ctrl/Shift-click). Animates away (scale-up +
// fade-out) over SELECTION_FADE_DURATION seconds when deselected so the
// transition into the cluster ring reads as a clean pop.
const SELECTION_RING_INNER = 1.12;
const SELECTION_RING_OUTER = 1.22;
const SELECTION_RING_SEGMENTS = 48;
const SELECTION_FADE_DURATION = 0.35;
// Y slightly above the pad body so it clears z-fighting with the flat
// surface geometry (local +0.12 → world ~0.17 when at DROP_Y_REST).
const SELECTION_RING_Y = 0.12;

// Story 4.6 (retained after group removal — sprint-change-proposal-2026-04-23):
// any pad being dragged pushes nearby pads out of the way. Impact
// radius is 2× SELECTION_RING_OUTER so two pads "touch" right at the
// visible halo-ring edge. The nudge formula pushes the sibling to
// EXACTLY NUDGE_RADIUS from the drag anchor along the radial so they
// end up non-overlapping regardless of how deep the approach went.
const NUDGE_RADIUS = 2 * SELECTION_RING_OUTER;

// Story 2.8: pad-action glow on water. Each pad mounts a GlowSource
// disc just above the water plane; its shader uniforms are driven from
// the same per-phase strength curves that feed the pad body/rim tint.
// The existing Bloom pass at luminanceThreshold 0.2 picks these HDR
// colors up automatically, producing a soft halo on the water surface.
const GLOW_RADIUS = 1.8;              // 1.8x PAD_RADIUS — halo extends past the pad rim
// Local Y inside the LilyPad group. Group root sits at DROP_Y_REST=0.05,
// so local -0.04 puts the halo at world y=0.01 — 1cm above the water
// plane at y=0 (avoids z-fighting with water mesh, stays below the pad
// body at local y=0.1). During dissolve the group scales down and the
// glow rides that scale — reads as the halo receding into the water.
const GLOW_Y_OFFSET = -0.04;
const FOCUS_GLOW_MAX = 0.35;          // Smaller cap for focus-flash glow — quieter than action moments
// Ambient glow: every resting pad emits a subtle halo in its own color
// so the pond reads as "lit by the pads" rather than "dark water with
// bright decorations sitting on it". Strength is deliberately low so
// the transient flash/pulse/focus moments still clearly stand out.
// The HDR scale pushes LDR hex pad colors past 1.0 so the Bloom pass
// at luminanceThreshold 0.2 picks them up as a gentle neon bleed.
const AMBIENT_GLOW_STRENGTH = 0.22;
const AMBIENT_GLOW_HDR_SCALE = 2.6;
// Sustained halo for whichever pad currently has `focused=true` (popup
// open). Quieter than the 0.4s click-to-focus pop (FOCUS_GLOW_MAX=0.35).
// Matches AMBIENT_GLOW_STRENGTH (both 0.22) — a deliberate coupling so
// the handoff from focused→unfocused (and vice versa) has no visible
// step-change in halo brightness. The focused pad is distinguished by
// color oscillation (pad-color↔white), not by strength. If you tune
// one of these constants, tune the other in lockstep or add a lerp
// bridge on the transition frame.
const FOCUSED_GLOW_STRENGTH = 0.22;
// Focused-pad halo breathes between the pad's own HDR color and HDR
// white on a sine wave. Period is long enough to read as "alive" but
// slow enough not to feel frantic — ~2.5s per cycle.
const FOCUSED_OSC_PERIOD_S = 2.5;
// Story 2.10: pad-floats-on-water lerp rates and tilt constants.
// RIDE_LERP = 0.08 → ~130ms to reach 90% of a new target height,
// matching the "smooth but responsive" feel of a floating object.
// TILT_DELTA = 0.35 (≈ PAD_RADIUS / 3) = the half-width we sample
// gradients across so the tilt reflects the pad-sized region, not a
// pointwise slope at the center.
// TILT_MAX_RADIANS = 15° cap per axis; extreme wave crests shouldn't
// flip the pad on its side.
const RIDE_LERP = 0.08;
const TILT_DELTA = 0.35;
const TILT_MAX_RADIANS = (Math.PI * 15) / 180;
const TILT_LERP = 0.08;
// Vector3-typed mirrors of the THREE.Color creation/focus HDR rim targets,
// so the GlowSource shader uniform (vec3) can consume them via .copy()
// without per-frame object allocation.
const CREATION_PAD_GLOW = new THREE.Vector3(2.5, 1.8, 0.2);
const FOCUS_PAD_GLOW = new THREE.Vector3(3.0, 3.0, 3.0);

// Creation rim target — HDR neon yellow matching the complete/delete
// treatment so all three pulse-rim highlights share the same brightness
// "family". Replaces the prior LDR #ffd700 gold. LDR ~= #ffd700.
const CREATION_RIM_COLOR = new THREE.Color().setRGB(2.5, 1.8, 0.2);

// Story 2.7 follow-up: quick HDR neon white flash on the ridge the moment
// a resting pad becomes focused (initial click that opens the popup).
// Distinct "family" from the 1.2s complete/delete pulse — this is a
// lightweight interaction confirmation, not a mutation, so a single fast
// decay over ~400ms is enough.
const FOCUS_FLASH_DURATION = 0.4;
const FOCUS_RIM_COLOR = new THREE.Color().setRGB(3.0, 3.0, 3.0);

// Story 2.7 flash-pulse — matches the creation `pulsing` phase 1:1 in
// shape AND duration. Three full oscillations, decaying in amplitude,
// over the 1.2s pulse window. Shared constants: same math for complete
// and delete keeps the sequences visually parallel; only the flash color
// and rim-target color differ.
//   scale = 1 + sin(pulseT · FREQ) · AMPLITUDE · (1 - pulseT)
// where `pulseT = t / PULSE_END` normalizes to 0→1 across 1.2s.
const FLASH_PULSE_AMPLITUDE = 0.12;     // ±12% — identical to creation
const FLASH_PULSE_FREQ = Math.PI * 6;   // 3 full oscillations — identical to creation

// Story 2.6 decay-state constants. Decay applies only in the `resting`
// phase — other phases own their own uColor / scale / opacity choreography
// and layering decay on top would paint muddy transitions.
const DECAY_SATURATION = 0.3;       // lerp uColor toward 30% of base color
const DECAY_SCALE_AMPLITUDE = 0.03; // ±3% flicker on top of focused scale
const DECAY_SCALE_FREQ_HZ = 0.5;    // 0.5Hz ⇒ ~2s per cycle (slow wilt)
const DECAY_RIM_OPACITY = 0.25;
// Recovery is driven by COMPLETION_LERP across scale/uColor/rim — at 0.05
// per frame it bottoms out ~320ms after the error clears, close to the
// 400ms target in the spec's timing summary.

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Shared dissolve/restore traversals used by both the completing and
// deleting branches. `skipDissolve` opts subtrees out (EmergingCreature
// tags itself so its emerge fade isn't clobbered during the overlap).
function fadePadMaterials(group: THREE.Group, opacity: number): void {
  group.traverse((obj) => {
    if (obj.userData.skipDissolve) return;
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh || (obj as THREE.Line).isLine) {
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) {
        for (const m of mat) {
          m.transparent = true;
          m.opacity = opacity;
        }
      } else if (mat) {
        mat.transparent = true;
        mat.opacity = opacity;
      }
    }
  });
}

// Pad materials in their resting configuration:
//   - ShaderMaterial (pad surface) — transparent=true, opacity=1 (driven by shader alpha)
//   - MeshBasicMaterial (rim) — transparent=true, opacity=0.4
//   - LineBasicMaterial (top edge) — transparent=false, opacity=1
// The dissolve's `fadePadMaterials` flips transparent=true on everything;
// this helper must restore the flag too or lineBasicMaterial is left in
// transparent-blend mode, producing depth-sort flicker on external cancel.
function restoreMaterial(m: THREE.Material): void {
  if (m instanceof THREE.LineBasicMaterial) {
    m.transparent = false;
    m.opacity = 1;
  } else if (m instanceof THREE.MeshBasicMaterial) {
    m.transparent = true;
    m.opacity = 0.4;
  } else {
    m.transparent = true;
    m.opacity = 1;
  }
}

function restorePadMaterials(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj.userData.skipDissolve) return;
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh || (obj as THREE.Line).isLine) {
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) {
        for (const m of mat) restoreMaterial(m);
      } else if (mat) {
        restoreMaterial(mat);
      }
    }
  });
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
  uniform vec3 uFlashColor;
  uniform float uFlashStrength;
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

    // Story 2.7 follow-up: gradual body tint toward the HDR action color
    // during complete/delete. uFlashStrength lerps up during the pulse
    // window in useFrame; uFlashColor is the HDR target. When strength = 0
    // (resting, waiting, creation) this is a no-op.
    float fs = clamp(uFlashStrength, 0.0, 1.0);
    finalColor = mix(finalColor, uFlashColor, fs);

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
  focused?: boolean;
  // Story 2.6: ms to wait before entering the 'forming' phase. PondScene
  // passes index * STAGGER_STEP_MS on initial load so pads cascade in.
  // 0 (or omitted) = no stagger.
  dropDelayMs?: number;
}

export function LilyPad({
  todo,
  onDropComplete,
  focused = false,
  dropDelayMs = 0,
}: LilyPadProps) {
  // Lazy `useState` initializers so impure calls (`Date.now`, `Math.random`)
  // run exactly once at mount, satisfying `react-hooks/purity`.
  const [isRecent] = useState(
    () => Date.now() - new Date(todo.createdAt).getTime() < RECENT_THRESHOLD_MS,
  );
  const [driftSeed] = useState(() => Math.random() * Math.PI * 2);
  const [rotationY] = useState(() => Math.random() * Math.PI * 2);
  const groupRef = useRef<THREE.Group>(null);
  const rimRef = useRef<THREE.Mesh>(null);
  const padMeshRef = useRef<THREE.Mesh>(null);
  // Story 2.8: ref to the GlowSource shader material. useFrame writes
  // uColor + uStrength uniforms each frame alongside the pad/rim updates.
  const glowMatRef = useRef<THREE.ShaderMaterial>(null);
  // Selection ring — visible while this pad is in selectedPadIds.
  // Animates away (expand + fade) on deselect via selectionFadeRef.
  const selectionRingRef = useRef<THREE.Mesh>(null);
  const wasSelectedRef = useRef(false);
  const selectionFadeRef = useRef<number | null>(null);
  const targetY = useRef(todo.completed ? COMPLETED_Y : DROP_Y_REST);
  // Initial phase — in priority order:
  //   1. Recently-created (isRecent) → 'forming' (no staggering — the user
  //      just dropped this pad and should see it fly in immediately).
  //   2. Staggered load (dropDelayMs > 0) → 'waiting' until the delay elapses.
  //   3. Otherwise → 'resting' (pre-existing pads on refetch, no stagger).
  // The `isRecent ? 0 : dropDelayMs` precedence ensures PondScene can
  // safely pass `index * STAGGER_STEP_MS` unconditionally on every render;
  // mid-session creations ignore the stagger because they're recent.
  const [initialDelayMs] = useState(() => (isRecent ? 0 : dropDelayMs));
  const waitStartRef = useRef<number | null>(null);
  const phaseRef = useRef<DropPhase>(
    isRecent ? 'forming' : initialDelayMs > 0 ? 'waiting' : 'resting',
  );
  const phaseTimer = useRef(0);
  const dropNotified = useRef(false);
  const restStartTime = useRef(0);
  // R3F-clock timestamp stamped on the first frame of the completing phase.
  // A ref so the same useFrame that sets it can read it on the next iteration
  // without a setState round-trip. A parallel state mirror drives the one
  // piece of JSX that needs to read it (the <EmergingCreature> mount gate).
  const completingStartTimeRef = useRef<number | null>(null);
  const [completingStartTime, setCompletingStartTime] = useState<number | null>(null);
  const completingRippleFired = useRef(false);
  // Deletion-sequence parallels: same ref + state-mirror split as completion.
  const deletingStartTimeRef = useRef<number | null>(null);
  const [deletingStartTime, setDeletingStartTime] = useState<number | null>(null);
  const deletingRippleFired = useRef(false);
  // Story 2.7 follow-up: refs driving the focus-flash. `pending` is set
  // by the useEffect that watches `focused` transitions; the next useFrame
  // tick consumes it and stamps `startRef` from the R3F clock. This
  // deferred stamp keeps clock reads confined to useFrame (same pattern
  // as waitStartRef, completingStartTimeRef, etc.).
  const focusFlashPendingRef = useRef(false);
  const focusFlashStartRef = useRef<number | null>(null);
  // Story 2.10 CR-patch: per-pad lerped elevation contribution, used
  // only during settling + pulsing. The raw elevation at the pad's
  // own impact-ripple center oscillates at ~5.5 rad/s and has an
  // exp(-10t) splash spike — writing it directly to position.y each
  // frame reads as a visible jitter. Lerping at RIDE_LERP acts as a
  // low-pass filter (same smoothing resting already has on position.y).
  const rideElevRef = useRef(0);
  // Story 2.8 follow-up: anchor for the sustained focused-halo oscillation
  // (AC #10). Stamped lazily on the first useFrame tick where `focused` is
  // true and this ref is null — keeps the osc phase reproducible ("starts
  // at pad color, breathes toward white") instead of starting wherever
  // wall-clock time happens to land.
  const focusStartTimeRef = useRef<number | null>(null);
  const prevFocusedRef = useRef(focused);
  // Story 4.2: drag-state refs. `dragStartScreenRef` is non-null for
  // the lifespan of a pointerDown→pointerUp cycle. `isDraggingRef`
  // flips true only once the pointer has moved past
  // DRAG_THRESHOLD_PX — i.e., a "real" drag vs. a stationary click.
  // `dragPosRef` holds the latest world-XZ from the water-plane
  // raycast; useFrame reads it to imperatively place the pad each
  // frame. Seeded to the pad's spawn position so the very-first-
  // frame click-to-popup path has valid coords even if pointermove
  // never fired.
  const isDraggingRef = useRef(false);
  const dragStartScreenRef = useRef<{ x: number; y: number } | null>(null);
  const dragPosRef = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  // True once any raycast during this drag cycle landed on the water
  // plane. Skips the release-time PATCH when no raycast ever succeeded
  // (e.g. camera angle that never intersects y=0), preventing a no-op
  // or stale-seed position commit.
  const raycastSucceededRef = useRef(false);
  // Story 4.2: "sticky drag" — after pointerUp the pad stays
  // pinned at `dragPosRef` until the updated `todo.positionX/Y`
  // arrives via React Query's refetch. Without this, the
  // resting-branch drift uses the STALE posX/posZ for the frames
  // between the PATCH firing and the refetched data arriving —
  // the pad visually flashes back to its pre-drag position before
  // jumping forward. Cleared by the useEffect below when posX/posZ
  // catch up to the committed drag target (within the same
  // arrival threshold used by the /spread-out lerp).
  const stickyDragRef = useRef(false);
  // Defensive backstop (2026-04-23): timestamp at which sticky was
  // last set. The useFrame resting branch auto-clears sticky if it
  // has been held for more than STICKY_MAX_MS — prevents a pad from
  // freezing forever if the server returns a clamped / rounded
  // position that never matches dragPosRef within the arrival
  // threshold. The pad's visual would snap back to the server's
  // value in that case, which is at worst a minor pop, far better
  // than silently ignoring all subsequent drags.
  const stickySetAtMsRef = useRef<number | null>(null);
  // Story 4.6 (retained): accumulated repulsion offset applied on top of
  // rest position while ANOTHER pad is being dragged nearby. Story 4.2
  // option-2 (2026-04-23): persists across anchor-out-of-range — the pad
  // stays shoved until the next drag pushes it further or commit fires.
  const siblingNudgeRef = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  // Track "did activeDragAnchor exist on the previous frame" so we can
  // detect the null-transition at drag release and commit the nudge.
  const hadDragAnchorRef = useRef(false);
  // Story 4.2 jitter-fix (2026-04-23): the last steady-state target the
  // cascade engagement wanted siblingNudgeRef to reach — computed per
  // engaged frame from the summed penetrations. At drag release, the
  // commit block SNAPS siblingNudgeRef to this target before capturing
  // the commit position, so the final position is the resolved cascade
  // state rather than a mid-lerp under-shoot. Null = "not engaged yet
  // this session" (don't snap, use the current ref as-is).
  const lastNudgeTargetRef = useRef<{ x: number; z: number } | null>(null);
  // (`isPublishedRef` removed 2026-04-23 — the local ref can desync
  // from the store's actual `displacedPads` contents, leaving stale
  // entries that nudge far-away pads. Both setDisplacedPad and
  // clearDisplacedPad short-circuit on no-change inputs, so calling
  // them unconditionally each frame based on current nudge magnitude
  // is cheap AND fully self-correcting.)
  // Story 4-8: batch position PATCH. Fires on drag release (with the
  // dragged pad plus all cascade-displaced siblings in one call), on
  // spread-out arrival (single-entry batch), and previously on the
  // per-sibling nudge commit — that last path is now folded into the
  // drag-release batch so the commit block no longer dispatches its
  // own mutation. Error handling (retry decay, clearTodoError/
  // setTodoError on every id in the batch) lives inside the hook.
  const updatePositions = useUpdateTodoPositions();
  // Story 4.2: camera + canvas are needed by the window-level
  // pointermove handler to raycast raw clientX/Y against the water
  // plane. Using useThree (rather than passing these in as props)
  // keeps the drag logic encapsulated in LilyPad.
  const { camera, gl } = useThree();

  // Story 5.3: lerped search saturation, in [0, 1]. 1.0 = pad
  // glows at its normal ambient/focused strength (no search, or a
  // strong match); 0.0 = glow snuffed entirely (non-match pads are
  // visually "dormant"). Consumed only by the glow-strength
  // multiplier in the glow block — pad body + rim colour are
  // untouched by search so the pond reads the same as non-search
  // except for the halo.
  const searchSaturationRef = useRef(1);
  // Text fades in at the END of the arrival animation. Both creation
  // ('forming' → 'dropping') and materialize ('waiting' → 'materializing')
  // paths leave textOpacity=0 until the pad reaches rest; already-settled
  // pads (no animation) start with text fully visible. Derive from the
  // same inputs that feed `phaseRef`'s initializer above — reading
  // `phaseRef.current` here would violate the ref-during-render rule.
  const [textOpacity, setTextOpacity] = useState(() =>
    !isRecent && initialDelayMs === 0 ? 1 : 0,
  );

  // Subscribe to the completion-sequence entry for this todo. When present,
  // the pad transitions into the `completing` phase and drives the flash →
  // emerge → dissolve → settle arc.
  const completing = usePondStore(selectCompleting(todo.id));
  // Parallel subscription for the deletion-sequence entry.
  const deleting = usePondStore(selectDeleting(todo.id));
  // Story 2.6: if the most recent mutation exhausted its retries, this
  // entry drives the decay visual during the `resting` phase. Continuous
  // lerping handles recovery smoothly when the entry clears — no dedicated
  // recovery-start ref needed.
  const errorEntry = usePondStore(selectTodoError(todo.id));
  // Story 4.1: transient color preview while the user hovers a swatch
  // in the Action Popup. Null unless a preview is active. Subscribing
  // with a memoized selector so only THIS pad re-renders on its own
  // preview changes, not on every other pad's hover activity.
  const previewColor = usePondStore(selectColorPreview(todo.id));

  // Story 5.3: search-mode subscription for THIS pad only. Re-renders
  // when this pad's match status flips, not on every other pad's
  // match-status change. The per-frame search-mode decision reads
  // `searchActive` + `searchAllMatches` imperatively inside useFrame
  // (via usePondStore.getState()) to avoid subscribing to those
  // scalars and firing extra renders.
  const searchHit = usePondStore(selectSearchHit(todo.id));

  // Story 4.6: this pad's membership in the multi-selection set.
  // Narrow subscription so only pads whose selection state flips
  // re-render on a toggle. Drives the white-rim oscillation below.
  const isSelected = usePondStore(selectIsSelected(todo.id));

  // Story 3.3: historical-pad visual treatment discriminator. Computed
  // once per render from `todo.deleted` / `todo.completed`. All 3.3
  // visual-branch decisions (fade, tint, click-gate, per-frame skip)
  // read from this single memo so adding/removing the treatment is a
  // localised change. Active pads short-circuit every 3.3 branch so
  // the pre-3.3 behaviour is byte-identical.
  const visualState = useMemo<'active' | 'completed' | 'deleted'>(() => {
    if (todo.deleted) return 'deleted';
    if (todo.completed) return 'completed';
    return 'active';
  }, [todo.deleted, todo.completed]);

  const posX = todo.positionX ?? 0;
  const posZ = todo.positionY ?? 0;
  // Story 4.1: `effectiveColor` layers the hover-preview on top of the
  // committed color. Everything downstream (rim material, colorVec for
  // shader uniform lerps) reads from this, so preview and commit flow
  // through the same pipeline — no drift between "what's previewed" and
  // "what the pad renders."
  //
  // Uses `||` rather than `??` so an empty-string `todo.color` (legacy
  // backend data, explicit blank update) falls through to the default
  // `#00ff88` just like the pre-4.1 code did. Valid hexes like
  // `#000000` remain truthy, so `||` is safe for every real palette
  // value. ActionPopup's `committedColor={todo.color || '#00ff88'}`
  // uses the same operator for consistency.
  const color = previewColor || todo.color || '#00ff88';
  const colorVec = useMemo(() => new THREE.Color(color), [color]);

  // Story 4.1: sync the pad shader's `uColor` uniform on every color
  // change — preview hover OR committed change. Fixes the 2.4 deferred-
  // work entry where `padUniforms.uColor` was frozen at mount. The
  // resting-branch lerp already reads `colorVec` (now preview-aware)
  // so its per-frame smoothing picks up seamlessly after the instant
  // snap here. Mutating `.value` in place avoids re-creating the
  // uniforms object (which would trigger a shader rebuild).
  //
  // Defensive chain: `padMeshRef.current` may exist without a real
  // ShaderMaterial in unit tests (JSX-stubbed mesh), so guard each
  // step before touching `.uniforms.uColor.value`.
  useEffect(() => {
    const mesh = padMeshRef.current;
    if (!mesh) return;
    const mat = mesh.material as THREE.ShaderMaterial | undefined;
    if (!mat?.uniforms?.uColor) return;
    // Story 4.1 CR-patch: apply the same `intensity` dimming the
    // resting-branch lerp uses (completed → 0.4, errorEntry →
    // DECAY_SATURATION, else 1.0). Without this, the snap writes at
    // full brightness and the per-frame lerp then pulls back to
    // `colorVec × intensity` over ~400ms — visible as a pulse-flash
    // on every hover/unhover of a completed or errored pad.
    const intensity = errorEntry
      ? DECAY_SATURATION
      : todo.completed
      ? 0.4
      : 1.0;
    mat.uniforms.uColor.value.set(
      colorVec.r * intensity,
      colorVec.g * intensity,
      colorVec.b * intensity,
    );
  }, [colorVec, todo.completed, errorEntry]);

  // Sync target Y to the latest completion state via an effect so we don't
  // mutate a ref during render (react-hooks rule).
  useEffect(() => {
    targetY.current = todo.completed ? COMPLETED_Y : DROP_Y_REST;
  }, [todo.completed]);

  // Story 4.2: clear the sticky-drag hold once the refetched todo
  // prop reflects the committed drag position. The arrival check
  // uses the same SPREAD_ARRIVE_THRESHOLD as the /spread-out
  // branch for consistency — any positional jitter smaller than
  // that reads as "caught up" and the resting-branch drift takes
  // over without a visible snap.
  useEffect(() => {
    if (!stickyDragRef.current) return;
    // If the update failed after the retry budget was exhausted, the
    // server never received the new position — refetch will not match
    // dragPosRef. Release sticky so the pad rejoins normal drift and
    // the 2.6 decay visual is free to read, instead of pinning the pad
    // at a position the backend knows nothing about. On next refetch
    // the pad snaps to the server's truth, matching other update-error
    // paths.
    if (errorEntry) {
      stickyDragRef.current = false;
      stickySetAtMsRef.current = null;
      restStartTime.current = 0;
      return;
    }
    const px = todo.positionX ?? 0;
    const py = todo.positionY ?? 0;
    const target = dragPosRef.current;
    if (
      Math.abs(px - target.x) < SPREAD_ARRIVE_THRESHOLD &&
      Math.abs(py - target.z) < SPREAD_ARRIVE_THRESHOLD
    ) {
      stickyDragRef.current = false;
      stickySetAtMsRef.current = null;
      // Jitter-fix (2026-04-23): reset the resting-phase clock so the
      // drift amplitude ramps from 0 over ~3s again. Without this, a
      // pad that was pinned (sticky) through a drag would start
      // drifting at FULL 0.08/0.06-unit amplitude the moment sticky
      // cleared — several freshly-committed pads simultaneously
      // resuming full-amplitude drift reads as collective jitter.
      // Resetting restartTime reads as "these pads just landed and
      // are still settling in" even though all the physics has
      // already resolved.
      restStartTime.current = 0;
    }
  }, [todo.positionX, todo.positionY, errorEntry]);

  // Defensive sticky-clear timeout. If a pad holds sticky for more
  // than STICKY_MAX_MS the watchdog useFrame (below) force-clears it.
  // Keeps this constant co-located with the ref declaration so the
  // relationship is obvious.
  const STICKY_MAX_MS = 5000;

  // Cleanup effect — on unmount, clear this pad from both the primary
  // (activeDragAnchor) and secondary (displacedPads) anchor channels.
  // Without this, a pad deleted mid-drag (or a displaced pad unmounted
  // by a refetch dropping the todo) would leave a frozen anchor
  // pointing at a dead id; every other pad's useFrame would keep
  // repelling against the ghost.
  useEffect(() => {
    const id = todo.id;
    return () => {
      const store = usePondStore.getState();
      if (store.activeDragAnchor?.padId === id) {
        store.setActiveDragAnchor(null);
      }
      if (store.displacedPads.has(id)) {
        store.clearDisplacedPad(id);
      }
    };
  }, [todo.id]);

  // P7: clear any lingering error-decay entry on unmount. Without this,
  // `errorTodos` accumulates entries for pads that were dissolved (terminal
  // phase) or dropped from the list (delete → backend removes) while an
  // in-flight retry was still failing — they never re-enter `resting` to
  // show the decay, so the Map just grows across a session. Keyed to
  // `todo.id` so StrictMode remounts correctly re-stamp on the surviving
  // render.
  useEffect(() => {
    const id = todo.id;
    return () => {
      const store = usePondStore.getState();
      store.clearTodoError(id);
      // Story 4.1 CR-patch: belt-and-suspenders preview cleanup for
      // ANY unmount path (Complete/Delete handlers already clear it
      // explicitly; this catches paths like a backend refetch dropping
      // the todo while its popup happens to be closed). Without this,
      // the `colorPreviews` Map would accumulate stale entries keyed
      // to pads that no longer exist.
      store.setColorPreview(id, null);
    };
  }, [todo.id]);

  // Story 2.7 follow-up: detect false → true transitions of `focused` and
  // mark a focus-flash pending. The useFrame resting branch stamps the
  // actual R3F-clock start time on its next tick. Initial-mount focused=true
  // does NOT trigger (prevFocusedRef starts equal to `focused` on first
  // render) — the flash is only for click-to-focus events mid-session.
  useEffect(() => {
    if (focused && !prevFocusedRef.current) {
      focusFlashPendingRef.current = true;
    }
    // Reset the focused-osc anchor when the popup closes so the next
    // focus opens from a known phase (osc=0 → pad-color) rather than
    // picking up whatever phase the last session ended at.
    if (!focused && prevFocusedRef.current) {
      focusStartTimeRef.current = null;
    }
    prevFocusedRef.current = focused;
  }, [focused]);

  // Story 4.2: window-level drag pipeline.
  //
  // Previous attempt kept pointermove + pointerup on the mesh. That
  // left a stale-state bug when pointerup landed OFF the mesh
  // (pointer released outside the canvas, dragged behind an overlay,
  // etc.) — R3F's event system never fired the mesh's pointerup, so
  // `dragStartScreenRef` stayed set and the NEXT pointermove over
  // the mesh (on a later hover) re-activated drag-follow on the pad.
  //
  // Fix: pointerDown stays on the mesh (needs R3F's raycast to know
  // which pad was hit), but then IMMEDIATELY attaches
  // pointermove/up/cancel listeners to `window`. Those fire
  // unconditionally regardless of where the pointer ends up, so the
  // drag cycle always terminates cleanly. Listeners are removed
  // inside the up/cancel handlers, and again on unmount via the
  // dedicated cleanup effect below.
  //
  // Using refs (not state) for the bound listeners so the mesh-side
  // pointerDown callback doesn't churn dependencies — the listeners
  // read from refs + closures over stable callbacks.
  const windowMoveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const windowUpRef = useRef<((e: PointerEvent) => void) | null>(null);
  const activePointerIdRef = useRef<number | null>(null);

  const detachWindowListeners = useCallback(() => {
    if (windowMoveRef.current) {
      window.removeEventListener('pointermove', windowMoveRef.current);
      windowMoveRef.current = null;
    }
    if (windowUpRef.current) {
      window.removeEventListener('pointerup', windowUpRef.current);
      window.removeEventListener('pointercancel', windowUpRef.current);
      windowUpRef.current = null;
    }
    activePointerIdRef.current = null;
  }, []);

  // Cleanup effect — on unmount, drop any in-flight window
  // listeners so a dissolving / unmounting pad doesn't leak
  // event handlers onto the window.
  useEffect(() => detachWindowListeners, [detachWindowListeners]);

  const handlePadPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      // User feedback 2026-04-23: only LMB drags pads. RMB/MMB stay
      // reserved for the OrbitControls pan / MMB ascend rigs — without
      // this gate a right-click on a pad would stopPropagation() and
      // swallow the native right-button that PondCamera needs for pan.
      if (e.nativeEvent.button !== 0) return;
      e.stopPropagation();
      const state = usePondStore.getState();
      if (state.completingTodos.has(todo.id) || state.deletingTodos.has(todo.id)) return;
      if (state.activePopupTodoId === todo.id) return;

      // Story 4.6 AC #1: Shift/Ctrl/Meta + click toggles multi-selection.
      // No drag attempt, no popup — the click is consumed by the
      // selection slice. Uses `nativeEvent` because `ThreeEvent` does
      // not forward modifier flags directly; the native pointer event
      // carries shiftKey/ctrlKey/metaKey.
      const native = e.nativeEvent;
      if (native.shiftKey || native.ctrlKey || native.metaKey) {
        state.togglePadSelection(todo.id);
        return;
      }
      // Defensive: if a previous cycle never received pointerup
      // (rare browser bug, or an unmount-remount mid-drag), drop
      // any stale listeners before starting a new one.
      detachWindowListeners();

      dragStartScreenRef.current = { x: e.clientX, y: e.clientY };
      isDraggingRef.current = false;
      raycastSucceededRef.current = false;
      // Seed dragPosRef with the pad's current visible position so a
      // sub-threshold release (click) has valid coords, and so a rapid
      // drag-after-drag (while sticky is still waiting for a refetch)
      // doesn't snap back to stale posX/posZ for a frame. The visible
      // pad position (group.position) already reflects drift / sticky /
      // prior-nudge offsets; falling back to posX/posZ only if the
      // group hasn't rendered yet keeps the legacy behaviour on mount.
      const groupNow = groupRef.current;
      // groupNow?.position is the Three.js group's live world XZ; falling
      // back to posX/posZ if the ref is null (pre-mount) or if the test
      // harness stubs the group without a .position vector.
      if (groupNow?.position) {
        dragPosRef.current = { x: groupNow.position.x, z: groupNow.position.z };
      } else {
        dragPosRef.current = { x: posX, z: posZ };
      }
      activePointerIdRef.current = e.nativeEvent.pointerId;

      const onWindowMove = (ev: PointerEvent) => {
        if (activePointerIdRef.current !== ev.pointerId) return;
        const start = dragStartScreenRef.current;
        if (!start) return;
        // Pointer released outside our tracking (e.g. browser
        // cancelled without firing pointerup) — `buttons` bitmask
        // is 0 when no button is pressed. Treat as a cancelled
        // interaction: detach listeners silently, no popup, no PATCH.
        // Opening a popup on an off-window release would surprise the
        // user (their pointer released outside the app).
        if (ev.buttons === 0) {
          dragStartScreenRef.current = null;
          isDraggingRef.current = false;
          detachWindowListeners();
          const cancelStore = usePondStore.getState();
          cancelStore.setActiveDragAnchor(null);
          if (cancelStore.cursorMode === 'grabbing') {
            cancelStore.setCursorMode('grab');
          }
          return;
        }
        // Pad entered completing/deleting mid-drag (keyboard shortcut,
        // external trigger). Abort silently — the pad is dissolving;
        // PATCHing its position would race with the completion/delete.
        const moveState = usePondStore.getState();
        if (
          moveState.completingTodos.has(todo.id) ||
          moveState.deletingTodos.has(todo.id)
        ) {
          dragStartScreenRef.current = null;
          isDraggingRef.current = false;
          detachWindowListeners();
          moveState.setActiveDragAnchor(null);
          if (moveState.cursorMode === 'grabbing') {
            moveState.setCursorMode('grab');
          }
          return;
        }
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        const distSq = dx * dx + dy * dy;
        if (!isDraggingRef.current && distSq < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
          return;
        }
        if (!isDraggingRef.current) {
          isDraggingRef.current = true;
          const dragStartStore = usePondStore.getState();
          dragStartStore.clearTargetPosition(todo.id);
          // Swap to the closed-fist cursor for the duration of the drag.
          dragStartStore.setCursorMode('grabbing');
          // Cascade: this pad is now the PRIMARY anchor (via
          // activeDragAnchor below). Drop it from the secondary map
          // to avoid double-publishing, and reset its nudge — the
          // user is placing this pad deliberately.
          dragStartStore.clearDisplacedPad(todo.id);
          siblingNudgeRef.current = { x: 0, z: 0 };
          lastNudgeTargetRef.current = null;
        }
        // Convert client coords → canvas NDC → water-plane hit. If the
        // canvas rect has no area yet (mid-resize, offscreen, detached)
        // the NDC math produces NaN which would poison dragPosRef and
        // propagate into every group.position write. Skip this frame.
        const rect = gl.domElement.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        dragNDC.set(
          ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          -((ev.clientY - rect.top) / rect.height) * 2 + 1,
        );
        dragRaycaster.setFromCamera(dragNDC, camera);
        if (dragRaycaster.ray.intersectPlane(WATER_PLANE, worldDragPoint)) {
          const newX = worldDragPoint.x;
          const newZ = worldDragPoint.z;
          dragPosRef.current = { x: newX, z: newZ };
          raycastSucceededRef.current = true;

          // Publish the drag anchor so every other pad's useFrame
          // slide-out-of-the-way nudge (NUDGE_RADIUS) tracks the
          // cursor live. Cleared on release below.
          usePondStore
            .getState()
            .setActiveDragAnchor({ padId: todo.id, x: newX, z: newZ });
        }
      };

      const onWindowUp = (ev: PointerEvent) => {
        if (activePointerIdRef.current !== ev.pointerId) return;
        const wasDrag = isDraggingRef.current;
        const didRaycast = raycastSucceededRef.current;
        dragStartScreenRef.current = null;
        isDraggingRef.current = false;
        detachWindowListeners();
        if (!wasDrag) {
          // Clean click — open popup (same mid-sequence guard as
          // the pre-4.2 onClick path).
          const guardState = usePondStore.getState();
          if (
            guardState.completingTodos.has(todo.id) ||
            guardState.deletingTodos.has(todo.id)
          ) {
            return;
          }
          guardState.openPopup(todo.id, posX, posZ);
          return;
        }
        // Real drag — PATCH the new position. stickyDragRef pins
        // the pad visually at dragPosRef until the refetched prop
        // catches up so the pad doesn't flash back to its old spot
        // between PATCH fire and cache invalidation.
        //
        // Skip PATCH if no raycast ever succeeded — dragPosRef still
        // holds the pointerDown seed, so writing it back would be a
        // no-op PATCH (or worse, commit a stale seed that differs
        // from the pad's visible drifted position). Also clear any
        // pending spread target so the pad doesn't lerp away from
        // the drop point once sticky releases.
        const releaseStore = usePondStore.getState();
        releaseStore.clearTargetPosition(todo.id);
        if (didRaycast) {
          // Story 4-8: batch drag-release PATCH. Collect every pad
          // that was cascade-displaced (published to displacedPads)
          // alongside this dragged pad, then fire ONE PATCH for the
          // whole set. The sibling-nudge commit block in useFrame
          // still resets its own local visual state (sticky,
          // dragPosRef, nudgeRef) but no longer dispatches its own
          // mutation — the dragger owns the write.
          stickyDragRef.current = true;
          stickySetAtMsRef.current = performance.now();
          const batch: UpdatePositionEntry[] = [];
          batch.push({
            id: todo.id,
            positionX: dragPosRef.current.x,
            positionY: dragPosRef.current.z,
          });
          releaseStore.displacedPads.forEach((pos, displacedId) => {
            if (displacedId === todo.id) return;
            batch.push({
              id: displacedId,
              positionX: pos.x,
              positionY: pos.z,
            });
          });
          updatePositions.mutate(batch);
          // Each committed sibling drops out of displacedPads right
          // away — on the next frame they'd already mirror their
          // committed position via posX (after refetch) but clearing
          // eagerly prevents any chance of a cascade-chase against a
          // stale secondary anchor.
          releaseStore.displacedPads.forEach((_, displacedId) => {
            if (displacedId === todo.id) return;
            releaseStore.clearDisplacedPad(displacedId);
          });
        }

        // Tear down drag-time store slices. activeDragAnchor clears so
        // other pads stop repelling; cursor reverts from 'grabbing' to
        // 'grab' (pointer almost always still over the pad since the
        // pad followed the cursor).
        releaseStore.setActiveDragAnchor(null);
        if (releaseStore.cursorMode === 'grabbing') {
          releaseStore.setCursorMode('grab');
        }
      };

      windowMoveRef.current = onWindowMove;
      windowUpRef.current = onWindowUp;
      window.addEventListener('pointermove', onWindowMove);
      window.addEventListener('pointerup', onWindowUp);
      window.addEventListener('pointercancel', onWindowUp);
    },
    [todo.id, posX, posZ, camera, gl, updatePositions, detachWindowListeners],
  );

  const padShape = useMemo(
    () => buildPadShape(PAD_RADIUS, SEGMENTS, driftSeed),
    [driftSeed],
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
    uSeed: { value: driftSeed },
    // Story 2.7 follow-up: body tint target + blend strength. Strength is
    // 0 everywhere except inside the 1.2s complete/delete pulse window,
    // where it eases in cubically up to a soft cap so the body only
    // gently gains action-color — the ridge remains the primary signal.
    uFlashColor: { value: new THREE.Vector3(0, 0, 0) },
    uFlashStrength: { value: 0 },
  }));

  useEffect(() => {
    const group = groupRef.current;
    if (!group?.position) return;
    group.rotation.y = rotationY;
    const phase = phaseRef.current;
    if (phase === 'forming') {
      // Creation path: high in the air, invisible, about to fall.
      group.position.set(posX, DROP_Y_START, posZ);
      group.scale.setScalar(0);
    } else if (phase === 'waiting') {
      // Materialize path: already at rest position but invisible until
      // the stagger delay elapses. No elevation change on arrival.
      group.position.set(posX, DROP_Y_REST, posZ);
      group.scale.setScalar(0);
    } else {
      // 'resting' — already-settled pad, visible at rest.
      group.position.set(posX, DROP_Y_REST, posZ);
      group.scale.setScalar(1);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;

    // Deletion-sequence entry. Ordered BEFORE the completing transition per
    // spec — if state somehow contains both, deletion wins (terminal intent).
    // Read startedAt from the store entry if already stamped (remount mid-
    // sequence); otherwise stamp now from the R3F clock so subsequent mounts
    // reuse the same anchor and don't replay flash+ripple.
    if (deleting && phaseRef.current === 'resting') {
      phaseRef.current = 'deleting';
      deletingRippleFired.current = false;
      const anchor =
        deleting.startedAt !== 0 ? deleting.startedAt : state.clock.elapsedTime;
      if (deleting.startedAt === 0) {
        usePondStore.getState().stampDeletionStart(todo.id, anchor);
      } else {
        // On remount, the ripple was already fired by the previous instance.
        deletingRippleFired.current = true;
      }
      deletingStartTimeRef.current = anchor;
      setDeletingStartTime(anchor);
      // Seed the glow color so the per-frame `uColor.lerp(DELETE_PAD_TINT, 0.06)`
      // below starts from the pad's ambient HDR baseline rather than whatever
      // lingered (on fresh mount this is (0,0,0), which would make the halo
      // invisible for ~25 frames while the lerp climbs out of black).
      if (glowMatRef.current) {
        glowMatRef.current.uniforms.uColor.value.set(
          colorVec.r * AMBIENT_GLOW_HDR_SCALE,
          colorVec.g * AMBIENT_GLOW_HDR_SCALE,
          colorVec.b * AMBIENT_GLOW_HDR_SCALE,
        );
      }
    }

    // External-cancel recovery for deletion. Runs before completing-cancel so
    // the spec ordering is preserved even though they are mutually exclusive
    // in practice.
    if (!deleting && phaseRef.current === 'deleting') {
      phaseRef.current = 'resting';
      deletingStartTimeRef.current = null;
      deletingRippleFired.current = false;
      setDeletingStartTime(null);
      group.scale.setScalar(1);
      restorePadMaterials(group);
      restStartTime.current = 0;
      // Restore rim color — the pulse lerps it toward HDR red; if cancel
      // lands mid-pulse the rim would otherwise stay frozen-red until
      // the resting branch's slow lerp pulled it back (~400ms of stuck
      // rim). `restorePadMaterials` only resets transparent/opacity.
      if (rimRef.current) {
        const rimMat = rimRef.current.material as THREE.MeshBasicMaterial;
        rimMat.color.set(color);
      }
      // A focus-flash queued just before the click-to-delete would
      // otherwise land as a delayed flash when the pad returns to
      // resting — drop the pending request AND any already-stamped
      // start time. Without clearing `focusFlashStartRef`, a sub-0.4s
      // click→delete→external-cancel sequence would replay the flash
      // on the first resting frame (stale stamp still within the 0.4s
      // FOCUS_FLASH_DURATION window).
      focusFlashPendingRef.current = false;
      focusFlashStartRef.current = null;
      // Clear the body tint uniforms accumulated during the cancelled
      // sequence (both strength and the HDR color target).
      if (padMeshRef.current) {
        const padMat = padMeshRef.current.material as THREE.ShaderMaterial;
        if (padMat.uniforms?.uFlashStrength) padMat.uniforms.uFlashStrength.value = 0;
        if (padMat.uniforms?.uFlashColor) padMat.uniforms.uFlashColor.value.set(0, 0, 0);
      }
      // Story 2.8: snap water glow to zero alongside the body-tint
      // reset so the halo doesn't linger after a cancelled sequence.
      if (glowMatRef.current) {
        glowMatRef.current.uniforms.uStrength.value = 0;
      }
      // Story 2.10 CR-patch: seed position.y to the current water
      // elevation so the first resting frame doesn't lerp UP through a
      // wave crest after a cancel. The pad's position.y during the
      // cancelled deleting sequence was DROP_Y_REST (pulsing/dissolve
      // don't write y), so without this seed a crest at the pad's
      // position would sit above the pad for ~8 frames.
      {
        const elev = usePondStore.getState().sampleElevation(posX, posZ);
        group.position.y = targetY.current + elev;
      }
    }

    // Transition into the completion sequence. Same store-anchor pattern as
    // deletion: reuse a persisted startedAt on remount rather than re-stamp.
    if (completing && phaseRef.current === 'resting') {
      phaseRef.current = 'completing';
      completingRippleFired.current = false;
      const anchor =
        completing.startedAt !== 0 ? completing.startedAt : state.clock.elapsedTime;
      if (completing.startedAt === 0) {
        usePondStore.getState().stampCompletionStart(todo.id, anchor);
      } else {
        completingRippleFired.current = true;
      }
      completingStartTimeRef.current = anchor;
      setCompletingStartTime(anchor);
      // Same remount-safe glow seed as the deleting branch above.
      if (glowMatRef.current) {
        glowMatRef.current.uniforms.uColor.value.set(
          colorVec.r * AMBIENT_GLOW_HDR_SCALE,
          colorVec.g * AMBIENT_GLOW_HDR_SCALE,
          colorVec.b * AMBIENT_GLOW_HDR_SCALE,
        );
      }
    }

    // Recovery: if the completing override was cleared while we were still
    // mid-sequence (external cancel — NOT the happy-path terminal transition,
    // which moves to 'completed' first), restore the pad to `resting` with
    // full opacity/scale so it isn't an invisible unclickable ghost.
    if (!completing && phaseRef.current === 'completing') {
      phaseRef.current = 'resting';
      completingStartTimeRef.current = null;
      completingRippleFired.current = false;
      setCompletingStartTime(null);
      group.scale.setScalar(1);
      restorePadMaterials(group);
      restStartTime.current = 0;
      // Same post-cancel cleanup as the deleting recovery above:
      // restore rim color, drop any queued focus-flash, and zero the
      // body-tint uniforms so the pad returns to baseline.
      if (rimRef.current) {
        const rimMat = rimRef.current.material as THREE.MeshBasicMaterial;
        rimMat.color.set(color);
      }
      // Mirror the deleting-recovery cleanup: clear BOTH pending and
      // already-stamped flash state so a sub-0.4s click→complete→cancel
      // sequence can't replay the flash on return to resting.
      focusFlashPendingRef.current = false;
      focusFlashStartRef.current = null;
      if (padMeshRef.current) {
        const padMat = padMeshRef.current.material as THREE.ShaderMaterial;
        if (padMat.uniforms?.uFlashStrength) padMat.uniforms.uFlashStrength.value = 0;
        if (padMat.uniforms?.uFlashColor) padMat.uniforms.uFlashColor.value.set(0, 0, 0);
      }
      if (glowMatRef.current) {
        glowMatRef.current.uniforms.uStrength.value = 0;
      }
      // Story 2.10 CR-patch: mirror the deleting-recovery seed — the
      // cancelled completing sequence left position.y at DROP_Y_REST,
      // and without this seed the first resting frame would lerp UP
      // through any wave crest sitting at the pad's position.
      {
        const elev = usePondStore.getState().sampleElevation(posX, posZ);
        group.position.y = targetY.current + elev;
      }
    }

    const phase = phaseRef.current;

    // Story 2.10: in non-resting phases, lerp tilt back toward 0 so the
    // pad doesn't stay crooked during pulse, dissolve, drop, settle, etc.
    // The resting branch below writes tilt targets from the water
    // gradient; every other phase zeros it out. `rotation.y` (set once
    // at phase-init time) is preserved — only the x/z tilt is touched.
    if (phase !== 'resting') {
      group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, 0, TILT_LERP);
      group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, 0, TILT_LERP);
    }

    // Terminal state: dissolve finished, awaiting unmount. Don't re-walk
    // descendants every frame, don't restore anything.
    if (phase === 'completed' || phase === 'deleted') return;

    if (phase === 'completing') {
      const startedAt = completingStartTimeRef.current;
      if (startedAt === null) return;
      const t = state.clock.elapsedTime - startedAt;

      // Once the sequence is done, mark terminal and release the store
      // override. finish* actions are idempotent — calling both unconditionally
      // defends against a cross-map stale entry if something upstream ever
      // populated both maps for this id.
      if (t >= COMPLETING_TOTAL) {
        phaseRef.current = 'completed';
        // Hygiene: zero the body-tint uniforms so that any brief moment
        // between 'completed' and unmount — or material reuse via HMR /
        // Strict-Mode double-invocation — starts from a clean baseline.
        if (padMeshRef.current) {
          const padMat = padMeshRef.current.material as THREE.ShaderMaterial;
          if (padMat.uniforms?.uFlashStrength) padMat.uniforms.uFlashStrength.value = 0;
          if (padMat.uniforms?.uFlashColor) padMat.uniforms.uFlashColor.value.set(0, 0, 0);
        }
        // Story 2.8: same hygiene on the water glow uniform.
        if (glowMatRef.current) {
          glowMatRef.current.uniforms.uStrength.value = 0;
        }
        const store = usePondStore.getState();
        store.finishCompletion(todo.id);
        store.finishDeletion(todo.id);
        return;
      }

      // Story 2.7: the complete sequence is now 2.0s total —
      //   0.0–1.2s   scale pulse + rim highlight + gentle body tint
      //   1.2–2.0s   dissolve (ripple fires at 1.2s)
      // Ridge carries the primary color signal (HDR-neon rim lerp). The
      // pad BODY also drifts toward the HDR action color via shader
      // uFlashStrength, but capped and eased so it reads as a gradual
      // build rather than a hard flash.
      const mat = padMeshRef.current
        ? (padMeshRef.current.material as THREE.ShaderMaterial)
        : null;

      // Pulse: identical math to creation's `pulsing` phase — three
      // damped oscillations over 1.2s. Scale snaps to 1.0 on pulse-end
      // so the dissolve's 1→0 ramp begins from a clean baseline.
      if (t < COMPLETING_PULSE_END) {
        const pulseT = t / COMPLETING_PULSE_END;
        const wave = Math.sin(pulseT * FLASH_PULSE_FREQ);
        const decay = 1 - pulseT;
        group.scale.setScalar(1 + wave * FLASH_PULSE_AMPLITUDE * decay);

        // Rim highlight in the action color (neon green for complete).
        // Same glow function as creation's gold-lerp; `glow` peaks at
        // each wave crest and decays across the pulse window. Sets
        // opacity 0.4 → 1.0 so the rim clearly reads during the peaks.
        if (rimRef.current) {
          const rimMat = rimRef.current.material as THREE.MeshBasicMaterial;
          const glow = Math.max(0, wave) * decay;
          rimMat.color.set(color).lerp(COMPLETE_RIM_COLOR, glow);
          rimMat.opacity = 0.4 + glow * 0.6;
        }
      }
      // No explicit "hold scale at 1" branch needed: PULSE_END equals
      // DISSOLVE_START, so the dissolve's `scale = 1 - eased` (starting
      // at eased=0 → scale=1) picks up seamlessly from the pulse tail.

      // Shared with the body-tint and glow writes below. `intensity`
      // matches the resting-branch dimming so the first completing
      // frame's glow strength lines up with whatever the prior-frame
      // resting write produced (no upward step for completed/errored
      // pads, which wrote `AMBIENT * 0.4` or `AMBIENT * DECAY_SATURATION`).
      const totalT = Math.min(t / COMPLETING_TOTAL, 1);
      const intensity = errorEntry
        ? DECAY_SATURATION
        : todo.completed
        ? 0.4
        : 1.0;

      // Body tint — cubic ease-in across the FULL 2.0s sequence so the
      // shift toward the HDR action color is subtle through the pulse,
      // strengthens through the dissolve, and peaks just as the pad
      // finishes disappearing. Runs regardless of phase sub-window
      // because the lerp target changes gradually with t.
      if (mat?.uniforms?.uFlashColor && mat.uniforms?.uFlashStrength) {
        mat.uniforms.uFlashColor.value.copy(COMPLETE_PAD_TINT);
        mat.uniforms.uFlashStrength.value = totalT * totalT * totalT * PAD_TINT_MAX;
      }

      // Story 2.8: water glow tracks the same cubic ease-in — additive
      // HDR halo on the water surface that builds with the pulse and
      // peaks as the pad disappears. Color LERPS (never snaps) from
      // whatever it was on the previous frame (ambient pad-color, or
      // the sustained focused halo if the user just clicked Complete)
      // toward COMPLETE_PAD_TINT at ~6% per frame — no visible
      // green→disappear→red discontinuity. Strength ramps from the
      // intensity-scaled AMBIENT baseline up to PAD_TINT_MAX so there's
      // also no dip at t=0 (totalT³ starts at 0 but we lerp between
      // ambient and peak).
      if (glowMatRef.current) {
        glowMatRef.current.uniforms.uColor.value.lerp(COMPLETE_PAD_TINT, 0.06);
        glowMatRef.current.uniforms.uStrength.value = THREE.MathUtils.lerp(
          AMBIENT_GLOW_STRENGTH * intensity,
          PAD_TINT_MAX,
          totalT * totalT * totalT,
        );
      }

      // Ripple: fire exactly once at the dissolve start.
      if (
        !completingRippleFired.current &&
        t >= COMPLETING_DISSOLVE_START
      ) {
        usePondStore.getState().triggerRipple(posX, posZ);
        completingRippleFired.current = true;
      }

      // Dissolve: scale the whole group and fade pad materials to 0.
      // `userData.skipDissolve` opts subtrees out — <EmergingCreature>
      // tags itself so its emerge fade isn't clobbered during the overlap.
      if (t >= COMPLETING_DISSOLVE_START) {
        // Snap rim color back to base on dissolve-start so the pulse
        // tail doesn't leave a stuck-green rim bleeding into the
        // dissolve. Opacity is driven by `fadePadMaterials` below —
        // no snap needed (the fade takes over on the same frame).
        if (rimRef.current) {
          const rimMat = rimRef.current.material as THREE.MeshBasicMaterial;
          rimMat.color.set(color);
        }
        const dissolveT = Math.min(
          (t - COMPLETING_DISSOLVE_START) /
            (COMPLETING_DISSOLVE_END - COMPLETING_DISSOLVE_START),
          1,
        );
        const eased = easeOut(dissolveT);
        group.scale.setScalar(1 - eased);
        fadePadMaterials(group, 1 - eased);
      }
      return;
    }

    if (phase === 'deleting') {
      const startedAt = deletingStartTimeRef.current;
      if (startedAt === null) return;
      const t = state.clock.elapsedTime - startedAt;

      // Once the sequence is done, mark terminal and release BOTH store
      // overrides — finish* are idempotent, so the cross-call is a safe
      // defense against a stale cross-map entry.
      if (t >= DELETING_TOTAL) {
        phaseRef.current = 'deleted';
        // Mirror the completing-branch hygiene — zero the body-tint
        // uniforms before the pad unmounts.
        if (padMeshRef.current) {
          const padMat = padMeshRef.current.material as THREE.ShaderMaterial;
          if (padMat.uniforms?.uFlashStrength) padMat.uniforms.uFlashStrength.value = 0;
          if (padMat.uniforms?.uFlashColor) padMat.uniforms.uFlashColor.value.set(0, 0, 0);
        }
        if (glowMatRef.current) {
          glowMatRef.current.uniforms.uStrength.value = 0;
        }
        const store = usePondStore.getState();
        store.finishDeletion(todo.id);
        store.finishCompletion(todo.id);
        return;
      }

      // Story 2.7: delete mirrors the completion sequence 1:1 —
      //   0.0–1.2s   creation-identical scale pulse + red rim highlight
      //              + gentle body tint toward HDR red
      //   1.2–2.0s   dissolve (ripple fires at 1.2s)
      const mat = padMeshRef.current
        ? (padMeshRef.current.material as THREE.ShaderMaterial)
        : null;

      if (t < DELETING_PULSE_END) {
        const pulseT = t / DELETING_PULSE_END;
        const wave = Math.sin(pulseT * FLASH_PULSE_FREQ);
        const decay = 1 - pulseT;
        group.scale.setScalar(1 + wave * FLASH_PULSE_AMPLITUDE * decay);

        if (rimRef.current) {
          const rimMat = rimRef.current.material as THREE.MeshBasicMaterial;
          const glow = Math.max(0, wave) * decay;
          rimMat.color.set(color).lerp(DELETE_RIM_COLOR, glow);
          rimMat.opacity = 0.4 + glow * 0.6;
        }
      }
      // See completing branch for the PULSE_END == DISSOLVE_START note.

      // Mirror of the completing branch — see that branch's comment.
      const totalT = Math.min(t / DELETING_TOTAL, 1);
      const intensity = errorEntry
        ? DECAY_SATURATION
        : todo.completed
        ? 0.4
        : 1.0;

      // Body tint — same full-2.0s cubic ease-in as the completing branch,
      // just with the delete HDR target.
      if (mat?.uniforms?.uFlashColor && mat.uniforms?.uFlashStrength) {
        mat.uniforms.uFlashColor.value.copy(DELETE_PAD_TINT);
        mat.uniforms.uFlashStrength.value = totalT * totalT * totalT * PAD_TINT_MAX;
      }

      // Story 2.8: water glow mirrors the body tint — DELETE_PAD_TINT,
      // same cubic-eased strength ramp from the intensity-scaled ambient
      // baseline. Color LERPS from prior value (green ambient, or
      // focused white) toward DELETE_PAD_TINT rather than snapping — no
      // green→disappear→red seam at the start of the delete sequence.
      if (glowMatRef.current) {
        glowMatRef.current.uniforms.uColor.value.lerp(DELETE_PAD_TINT, 0.06);
        glowMatRef.current.uniforms.uStrength.value = THREE.MathUtils.lerp(
          AMBIENT_GLOW_STRENGTH * intensity,
          PAD_TINT_MAX,
          totalT * totalT * totalT,
        );
      }

      // Ripple: fire exactly once at the dissolve start.
      if (!deletingRippleFired.current && t >= DELETING_DISSOLVE_START) {
        usePondStore.getState().triggerRipple(posX, posZ);
        deletingRippleFired.current = true;
      }

      // Dissolve: no creature to keep visible — plain fade of the whole pad.
      if (t >= DELETING_DISSOLVE_START) {
        // Color-snap only; opacity is driven by `fadePadMaterials`.
        if (rimRef.current) {
          const rimMat = rimRef.current.material as THREE.MeshBasicMaterial;
          rimMat.color.set(color);
        }
        const dissolveT = Math.min(
          (t - DELETING_DISSOLVE_START) /
            (DELETING_DISSOLVE_END - DELETING_DISSOLVE_START),
          1,
        );
        const eased = easeOut(dissolveT);
        group.scale.setScalar(1 - eased);
        fadePadMaterials(group, 1 - eased);
      }
      return;
    }

    if (phase === 'resting') {
      if (restStartTime.current === 0) {
        restStartTime.current = state.clock.elapsedTime;
      }
      const t = state.clock.elapsedTime - restStartTime.current;
      const seed = driftSeed;
      const ramp = Math.min(t / 3, 1);

      // Story 5.3: compute this frame's search saturation. The value
      // only gates the pad's GLOW STRENGTH — pad body colour and rim
      // are deliberately untouched by search so the pond looks the
      // same as non-search except for the halo beneath each pad.
      //
      //   'none'     → 1.0        (normal ambient/focused glow)
      //   'match'    → sqrt(score)  (halo scales with match strength)
      //   'nonmatch' → 0.0        (halo snuffed — pad is "dormant")
      //
      // Why sqrt(score) instead of score directly? A moderate match
      // (ts_rank + semantic ≈ 0.45 typical for "finish" vs. "finish
      // the todo app …") would otherwise scale the halo to only
      // ~45% brightness, which reads as barely-lit. sqrt biases the
      // low-middle upward so a 0.45 match glows at ~67% — visibly a
      // match — while 0.30 near-floor reads ~55% and 0.85 strong
      // reads ~92%. Non-match stays at 0 because sqrt(0) = 0.
      //
      // All reads from the store happen imperatively here, NOT as
      // React subscriptions, so searchActive/searchAllMatches changes
      // don't re-render every pad on every keystroke.
      const searchState = usePondStore.getState();
      let searchSaturation = 1;
      if (searchState.searchActive) {
        if (searchState.searchAllMatches) {
          searchSaturation = 1;
        } else if (searchHit !== undefined) {
          // Defence-in-depth clamp + finite check before the sqrt.
          // Backend `Field(ge=0, le=1)` should keep the score in
          // range, but a NaN or negative slipping through (schema
          // drift, interceptor bug, future code) propagates through
          // `THREE.MathUtils.lerp` into the `uStrength` uniform —
          // and NaN uniforms render as black pads on many drivers.
          const rawScore = Number.isFinite(searchHit.score) ? searchHit.score : 0;
          searchSaturation = Math.sqrt(Math.max(0, rawScore));
        } else {
          searchSaturation = 0;
        }
      }
      // Lerp toward the target saturation so mode transitions fade
      // smoothly rather than snapping. RIDE_LERP gives ~400ms full
      // traverse at 60fps which matches the UX spec's 400ms restore.
      searchSaturationRef.current = THREE.MathUtils.lerp(
        searchSaturationRef.current,
        searchSaturation,
        RIDE_LERP,
      );

      // Progressive density override: ensure focused pads render at readable size.
      // Decay adds a slow sinusoidal flicker on top of the base target scale.
      const baseTargetScale = focused ? 1.2 : 1.0;
      // P8: per-pad phase offset via `driftSeed` so multiple decaying pads
      // don't flicker in lockstep (reads as mechanical). Other per-pad
      // animations (position bob / drift) already use the same seed for the
      // same reason.
      const decayFlicker = errorEntry
        ? Math.sin(state.clock.elapsedTime * 2 * Math.PI * DECAY_SCALE_FREQ_HZ + driftSeed) * DECAY_SCALE_AMPLITUDE
        : 0;
      // Story 4.6 AC #1: selected pads oscillate 1.00–1.05 at 2 Hz.
      // `2 Hz` → period 0.5s → full cycle `t * Math.PI * 4`. Amplitude
      // 0.05 reads as a clear "held" cue without jitter. Additive on top
      // of the base scale so focused + decaying + selected composes.
      const selectionOscillation = isSelected
        ? 0.05 * Math.abs(Math.sin(state.clock.elapsedTime * Math.PI * 4))
        : 0;
      const targetScale = baseTargetScale + decayFlicker + selectionOscillation;
      const currentScale = group.scale.x;
      group.scale.setScalar(THREE.MathUtils.lerp(currentScale, targetScale, COMPLETION_LERP));

      // Story 4.6 (user feedback 2026-04-23): on drag-release (anchor
      // transitions non-null → null), if this pad built up a significant
      // nudge during the drag, COMMIT it so the pad stays out of the
      // dragged pad's way instead of snapping back and overlapping.
      // MUST run BEFORE the drag/sticky/spread branch below — once
      // stickyDragRef flips true, the IF branch below picks up on the
      // same frame and writes the committed position to group.position.
      // Running this after would leave a one-frame gap where siblingNudge
      // has been reset to 0 but the ELSE branch still writes posX
      // (original rest, pre-nudge), flashing back to the un-nudged
      // position for a tick before the IF branch takes over.
      const liveAnchor = usePondStore.getState().activeDragAnchor;
      const hadLiveAnchor = hadDragAnchorRef.current;
      hadDragAnchorRef.current = liveAnchor !== null;
      // Watchdog for the sticky-drag pin. If sticky has been held for
      // more than STICKY_MAX_MS, force-clear it. Guards against a
      // backend that returns a clamped / rounded position that never
      // matches dragPosRef within the 0.05 arrival threshold — the
      // useEffect-based clear would never fire and the pad would
      // freeze indefinitely, taking the sticky IF branch every frame
      // and silently ignoring every subsequent drag. Worst case with
      // the watchdog: the pad snaps to the server's actual position
      // after 5s, which is a far better failure mode than "pads stop
      // interacting."
      if (
        stickyDragRef.current &&
        stickySetAtMsRef.current !== null &&
        performance.now() - stickySetAtMsRef.current > STICKY_MAX_MS
      ) {
        stickyDragRef.current = false;
        stickySetAtMsRef.current = null;
        restStartTime.current = 0;
      }

      // Story 4-8: sibling-nudge commit is now LOCAL ONLY. On
      // drag-release (activeDragAnchor transitions non-null → null)
      // this block still pins the pad at its displaced position via
      // sticky + dragPosRef and resets the nudge ref — but the PATCH
      // for the new position is dispatched by the DRAGGER as a single
      // batch (see onWindowUp above, which reads `displacedPads` and
      // builds the full payload). That collapses the previous N-way
      // PATCH fan-out into one request.
      //
      // The 0.3 visual threshold still filters tiny passing nudges
      // from acquiring stickyness they didn't earn. (Below-threshold
      // displacements keep their ref value and no local visual flip.)
      if (
        hadLiveAnchor &&
        liveAnchor === null &&
        !isDraggingRef.current &&
        !stickyDragRef.current
      ) {
        // Jitter-fix (2026-04-23): snap the nudge ref to the last
        // steady-state target computed by the cascade engagement
        // before measuring the commit threshold. Without this, a pad
        // mid-lerp at release would commit an under-shot position
        // and multiple siblings in a cascade would land at visibly
        // different fractions of their intended offsets — reads as
        // jitter. Snapping makes the release moment a clean
        // "everything lands at its resolved position" beat.
        const target = lastNudgeTargetRef.current;
        if (target !== null) {
          siblingNudgeRef.current.x = target.x;
          siblingNudgeRef.current.z = target.z;
        }
        if (
          Math.abs(siblingNudgeRef.current.x) <= 0.3 &&
          Math.abs(siblingNudgeRef.current.z) <= 0.3
        ) {
          // Below commit threshold even after snapping — clear the
          // cached target so the next drag session starts fresh, and
          // fall through without committing.
          lastNudgeTargetRef.current = null;
        } else {
          const commitX = posX + siblingNudgeRef.current.x;
          const commitZ = posZ + siblingNudgeRef.current.z;
          dragPosRef.current = { x: commitX, z: commitZ };
          stickyDragRef.current = true;
          stickySetAtMsRef.current = performance.now();
          siblingNudgeRef.current = { x: 0, z: 0 };
          lastNudgeTargetRef.current = null;
          // The dragger's onWindowUp batch fires via the shared
          // `displacedPads` map; we don't need to publish ourselves
          // here because we were already published while being shoved
          // (and the dragger reads the map eagerly before clearing it).
          // But if we were below the PUBLISH threshold when the
          // dragger fired, we'd miss the batch — clear ourselves
          // regardless so future cascade reads don't chase a stale
          // position.
          usePondStore.getState().clearDisplacedPad(todo.id);
        }
      }

      // Story 4.2: drag + /spread-out overrides. Applied before the
      // ambient drift so the pad sits exactly where the user's
      // finger / the spread target says, not offset by the drift.
      //   Drag: x/z snap to the live raycast hit — the pad is the
      //     object being directly manipulated, so no smoothing.
      //   Spread target: x/z lerp toward the target each frame at
      //     `1 - 0.001^delta` (~10% per 60fps frame → ~333ms to
      //     close 90% of the gap). On arrival (both axes within
      //     SPREAD_ARRIVE_THRESHOLD) fire PATCH and clear the
      //     target — see AC #8.
      //   Neither: fall back to the pre-4.2 sinusoidal drift.
      if (isDraggingRef.current || stickyDragRef.current) {
        group.position.x = dragPosRef.current.x;
        group.position.z = dragPosRef.current.z;
      } else {
        const spreadTarget =
          usePondStore.getState().padTargetPositions.get(todo.id);
        if (spreadTarget) {
          const lerpSpeed = 1 - Math.pow(0.001, delta);
          group.position.x = THREE.MathUtils.lerp(
            group.position.x,
            spreadTarget.x,
            lerpSpeed,
          );
          group.position.z = THREE.MathUtils.lerp(
            group.position.z,
            spreadTarget.z,
            lerpSpeed,
          );
          if (
            Math.abs(group.position.x - spreadTarget.x) < SPREAD_ARRIVE_THRESHOLD &&
            Math.abs(group.position.z - spreadTarget.z) < SPREAD_ARRIVE_THRESHOLD
          ) {
            group.position.x = spreadTarget.x;
            group.position.z = spreadTarget.z;
            usePondStore.getState().clearTargetPosition(todo.id);
            // Story 4.2 flash-fix (parity with drag release): pin
            // the pad at `spreadTarget` until the refetched todo
            // arrives with the new position. Without this, the
            // resting-branch drift below would use the stale
            // posX/posZ for the handful of frames between the
            // PATCH firing and React Query invalidating +
            // refetching, visibly flashing the pad back to its
            // pre-spread position. Reuses the same dragPosRef +
            // stickyDragRef pair the drag pipeline uses — the
            // cleanup effect clears the flag when posX/posZ
            // arrives matching the target.
            dragPosRef.current = { x: spreadTarget.x, z: spreadTarget.z };
            stickyDragRef.current = true;
            stickySetAtMsRef.current = performance.now();
            // Story 4-8: use the batch endpoint for consistency even
            // on a single-pad arrival. Spread arrivals stagger across
            // frames so they don't aggregate — each pad fires its own
            // one-entry batch. Still a single PATCH path, shared
            // error handling with the drag-release batch.
            updatePositions.mutate([
              {
                id: todo.id,
                positionX: spreadTarget.x,
                positionY: spreadTarget.z,
              },
            ]);
          }
        } else {
          // Story 4.6 (user feedback 2026-04-22): ANY pad being dragged
          // pushes nearby pads out of the way, not just same-cluster
          // siblings. Impact radius is NUDGE_RADIUS (2 ×
          // SELECTION_RING_OUTER) so the threshold sits right at the
          // visible halo-ring edge — no more overlap between a dragged
          // pad and its neighbours.
          //
          // Sibling-nudge model 2026-04-23 (option 2 + cascade):
          // The nudge is a PERSISTENT positional offset — once a pad
          // has been shoved aside it stays there until either (a) the
          // next push shoves it further, or (b) drag-release commits
          // a nudge above threshold via PATCH (see the block above the
          // drag/sticky IF). When no anchor is in range, siblingNudgeRef
          // holds its last value (no spring-back).
          //
          // CASCADE (2026-04-23): anchors come from TWO sources:
          //   1. `activeDragAnchor` — the pad currently being dragged
          //      (primary, always-published).
          //   2. `displacedPads` — other pads whose own nudge has
          //      crossed DISPLACED_PUBLISH_THRESHOLD (secondary). This
          //      is how shoves chain: A pushed by X publishes its
          //      displaced position, B reads A as an anchor, B gets
          //      pushed, B publishes, and so on.
          //
          // Total push is a SUM OF PENETRATIONS: for each anchor
          // overlapping our displaced position, add a vector of
          // magnitude (NUDGE_RADIUS − adist) pointing anchor → us. A
          // pad sandwiched between two anchors has its pushes cancel
          // to the balance point (physically correct); a pad with a
          // single anchor gets the same target as the pre-cascade
          // formula (anchor + dir × NUDGE_RADIUS − rest).
          const primary = usePondStore.getState().activeDragAnchor;
          const secondaries = usePondStore.getState().displacedPads;
          const nudgedX = posX + siblingNudgeRef.current.x;
          const nudgedZ = posZ + siblingNudgeRef.current.z;
          let pushX = 0;
          let pushZ = 0;
          let engaged = false;
          const applyAnchor = (ax: number, az: number): void => {
            const adx = nudgedX - ax;
            const adz = nudgedZ - az;
            const adist = Math.sqrt(adx * adx + adz * adz);
            if (adist >= NUDGE_RADIUS) return;
            engaged = true;
            let dirX: number;
            let dirZ: number;
            if (adist > 1e-4) {
              dirX = adx / adist;
              dirZ = adz / adist;
            } else {
              // Coincident with this anchor — prefer existing nudge
              // direction (monotonic across the crossing), else
              // driftSeed so two coincident pads still separate.
              const prevMag = Math.sqrt(
                siblingNudgeRef.current.x * siblingNudgeRef.current.x +
                  siblingNudgeRef.current.z * siblingNudgeRef.current.z,
              );
              if (prevMag > 1e-4) {
                dirX = siblingNudgeRef.current.x / prevMag;
                dirZ = siblingNudgeRef.current.z / prevMag;
              } else {
                dirX = Math.cos(driftSeed);
                dirZ = Math.sin(driftSeed);
              }
            }
            const overlap = NUDGE_RADIUS - adist;
            pushX += dirX * overlap;
            pushZ += dirZ * overlap;
          };
          if (primary && primary.padId !== todo.id) {
            applyAnchor(primary.x, primary.z);
          }
          secondaries.forEach((pos, id) => {
            if (id === todo.id) return;
            applyAnchor(pos.x, pos.z);
          });
          if (engaged) {
            // Target nudge = (current displaced + summed push) − rest.
            const targetNudgeX = nudgedX + pushX - posX;
            const targetNudgeZ = nudgedZ + pushZ - posZ;
            // Cache the target so drag-release can snap siblingNudgeRef
            // to its steady-state position (otherwise mid-lerp values
            // at release read as jitter when several pads commit
            // simultaneously at under-shot positions).
            lastNudgeTargetRef.current = { x: targetNudgeX, z: targetNudgeZ };
            // Lerp at 0.35 → ~90% convergence in 6 frames (~100ms at
            // 60fps). Only runs while engaged; when no anchor is in
            // range, siblingNudgeRef holds its last value.
            siblingNudgeRef.current.x = THREE.MathUtils.lerp(
              siblingNudgeRef.current.x,
              targetNudgeX,
              0.35,
            );
            siblingNudgeRef.current.z = THREE.MathUtils.lerp(
              siblingNudgeRef.current.z,
              targetNudgeZ,
              0.35,
            );
          }

          // Cascade publish/unpublish — a shoved pad both (a) acts as
          // a secondary anchor for downstream chain reactions and (b)
          // joins the dragger's drag-release batch PATCH (story 4-8).
          // Threshold is aligned with the commit threshold below so
          // every pad that passes the visual-commit bar also makes it
          // into the backend batch — otherwise small-but-committed
          // displacements would be visually pinned (sticky) but never
          // reach the server, resetting on refresh.
          //
          group.position.x =
            posX +
            Math.sin(t * 0.3 + seed) * 0.08 * ramp +
            siblingNudgeRef.current.x;
          group.position.z =
            posZ +
            Math.cos(t * 0.25 + seed * 1.3) * 0.06 * ramp +
            siblingNudgeRef.current.z;
        }
      }

      // Publish / unpublish this pad's displaced position for the
      // cascade's secondary-anchor channel — runs UNCONDITIONALLY in
      // the resting phase after the drag/sticky/spread/cascade logic
      // above has settled this frame's nudge state. Previously lived
      // inside the cascade branch, which meant sticky / spread pads
      // never ran it and any stale displacedPads entries they carried
      // in would linger, nudging far-away pads from beyond
      // NUDGE_RADIUS of the dragger.
      //
      // Publishing the STEADY-STATE TARGET position (posX + cached
      // target nudge) rather than the current mid-lerp position
      // keeps three values aligned at drag release:
      //   (a) the dragger's batch payload (reads displacedPads)
      //   (b) each sibling's dragPosRef at commit (snapped to target)
      //   (c) the sticky-clear check (refetch vs dragPosRef)
      // Mid-lerp publishes would drift these apart and leave pads
      // stuck sticky, then inert to further drags.
      //
      // Both store actions short-circuit on no-change inputs, so
      // calling them every frame is cheap. The store is the sole
      // source of truth; no local "am I published?" ref is kept.
      const DISPLACED_PUBLISH_THRESHOLD = 0.3;
      const currentNudgeMag = Math.sqrt(
        siblingNudgeRef.current.x * siblingNudgeRef.current.x +
          siblingNudgeRef.current.z * siblingNudgeRef.current.z,
      );
      if (currentNudgeMag > DISPLACED_PUBLISH_THRESHOLD) {
        const publishTarget = lastNudgeTargetRef.current;
        const publishX = publishTarget
          ? posX + publishTarget.x
          : posX + siblingNudgeRef.current.x;
        const publishZ = publishTarget
          ? posZ + publishTarget.z
          : posZ + siblingNudgeRef.current.z;
        usePondStore.getState().setDisplacedPad(todo.id, {
          x: publishX,
          z: publishZ,
        });
      } else {
        usePondStore.getState().clearDisplacedPad(todo.id);
      }

      // Story 2.10: pad rides the water surface. Sample elevation at
      // the pad's CURRENT (drifted) world position — not the anchor
      // (posX, posZ) — so the ride + gradient reflect where the pad
      // actually IS this frame, not where it was spawned. The drift
      // (lines above) is ±0.08 / ±0.06 per axis; small, but at steep
      // crest fronts that phase difference makes tilt + ride more
      // accurate. `targetY.current` still drives the active/completed
      // base height; water motion rides on top. Replaces the fake
      // 0.01-amplitude sine bob that predated the sampler. Sampler is
      // registered by WaterSurface on mount; before that it returns 0
      // (flat water) — harmless fallback.
      const samplePond = usePondStore.getState().sampleElevation;
      const sampleAtX = group.position.x;
      const sampleAtZ = group.position.z;
      const elevation = samplePond(sampleAtX, sampleAtZ);
      group.position.y = THREE.MathUtils.lerp(
        group.position.y,
        targetY.current + elevation,
        RIDE_LERP,
      );

      // Story 2.10: tilt the pad toward the local water gradient via
      // central differences at ±TILT_DELTA around the pad's current
      // position. Small-angle alignment of pad +Y with water normal
      // (-df/dx, 1, -df/dz):
      //   rotation.z = +atan(dydx)   → +x wave-rise → +x corner up
      //   rotation.x = -atan(dydz)   → +z wave-rise → +z corner up
      // Both clamped to ±15° per axis (TILT_MAX_RADIANS) so extreme
      // crests can't flip the pad; lerped at TILT_LERP for smoothness.
      // No allocations: raw numbers only, no Vector2/Quaternion.
      const elevXPlus = samplePond(sampleAtX + TILT_DELTA, sampleAtZ);
      const elevXMinus = samplePond(sampleAtX - TILT_DELTA, sampleAtZ);
      const elevZPlus = samplePond(sampleAtX, sampleAtZ + TILT_DELTA);
      const elevZMinus = samplePond(sampleAtX, sampleAtZ - TILT_DELTA);
      const dydx = (elevXPlus - elevXMinus) / (2 * TILT_DELTA);
      const dydz = (elevZPlus - elevZMinus) / (2 * TILT_DELTA);
      const targetTiltZ = THREE.MathUtils.clamp(
        Math.atan(dydx),
        -TILT_MAX_RADIANS,
        TILT_MAX_RADIANS,
      );
      const targetTiltX = THREE.MathUtils.clamp(
        -Math.atan(dydz),
        -TILT_MAX_RADIANS,
        TILT_MAX_RADIANS,
      );
      group.rotation.x = THREE.MathUtils.lerp(
        group.rotation.x,
        targetTiltX,
        TILT_LERP,
      );
      group.rotation.z = THREE.MathUtils.lerp(
        group.rotation.z,
        targetTiltZ,
        TILT_LERP,
      );

      // Desaturate pad shader when completed OR when the pad is in error decay.
      // Decay takes precedence — a completed pad with a failed mutation reads
      // as "wilting" rather than "softly faded".
      if (padMeshRef.current) {
        const mat = padMeshRef.current.material as THREE.ShaderMaterial;
        if (mat.uniforms?.uColor) {
          const intensity = errorEntry
            ? DECAY_SATURATION
            : todo.completed
            ? 0.4
            : 1.0;
          const targetColor = new THREE.Vector3(
            colorVec.r * intensity,
            colorVec.g * intensity,
            colorVec.b * intensity,
          );
          mat.uniforms.uColor.value.lerp(targetColor, COMPLETION_LERP);
        }
      }

      // Rim opacity dips during decay and lerps back on recovery. Uses the
      // same lerp rate so color + rim + scale all recover in sync
      // (~400ms per AC #8). Story 2.7 follow-up: if a focus-flash is
      // active (user just clicked an unfocused pad to open its popup),
      // override the rim with a decaying HDR neon white pop instead.
      if (rimRef.current) {
        const rimMat = rimRef.current.material as THREE.MeshBasicMaterial;

        // Consume a pending focus-flash request from the useEffect.
        if (focusFlashPendingRef.current) {
          focusFlashStartRef.current = state.clock.elapsedTime;
          focusFlashPendingRef.current = false;
        }

        const flashStart = focusFlashStartRef.current;
        if (flashStart !== null) {
          const flashT = (state.clock.elapsedTime - flashStart) / FOCUS_FLASH_DURATION;
          if (flashT < 1) {
            const flashDecay = 1 - flashT;
            rimMat.color.set(color).lerp(FOCUS_RIM_COLOR, flashDecay);
            rimMat.opacity = 0.4 + flashDecay * 0.6;
            // Glow is NOT written here — it's handled in the unified
            // glow block below, where the click pop is layered on top
            // of the sustained focused/ambient baseline so there's no
            // hand-off seam when the 0.4s flash finishes.
          } else {
            // Flash ended: release the ref so the glow block below
            // drops the overlay and lets the baseline come through.
            // Rim color is lerped by the `focusFlashStartRef.current === null`
            // block below via COMPLETION_LERP rather than snapped, so
            // the rim doesn't pop back abruptly.
            focusFlashStartRef.current = null;
          }
        }

        if (focusFlashStartRef.current === null) {
          const targetRimOpacity = errorEntry ? DECAY_RIM_OPACITY : 0.4;
          rimMat.opacity = THREE.MathUtils.lerp(
            rimMat.opacity,
            targetRimOpacity,
            COMPLETION_LERP,
          );
          // Smooth the rim color back to base instead of snapping on
          // flash-end. COMPLETION_LERP (0.05) gives a ~400ms ease that
          // visually blends with the glow block's overlay decay above.
          const currentRimColor = rimMat.color;
          currentRimColor.lerp(colorVec, COMPLETION_LERP);
        }
      }

      // Story 2.8 follow-up: unified glow write.
      //
      //   Baseline (always written):
      //     `focused === true` → sustained halo oscillating between the
      //       pad's HDR color and HDR white on a ~2.5s sine cycle at
      //       FOCUSED_GLOW_STRENGTH. Reads as "alive and selected".
      //     otherwise → pad's own color at AMBIENT_GLOW_STRENGTH, scaled
      //       by completion/decay intensity.
      //
      //   Overlay (layered on top when focus just landed):
      //     The 0.4s click-to-focus flash pulls color toward pure white
      //     and boosts strength toward FOCUS_GLOW_MAX, proportional to
      //     `flashDecay`. As the flash decays, the overlay smoothly
      //     yields to the baseline — no hand-off seam at flash-end.
      if (glowMatRef.current) {
        const uColor = glowMatRef.current.uniforms.uColor.value;
        // Shared intensity — keeps the focused halo in sync with the
        // pad body's decay/completion dimming (without it, a focused
        // completed or errored pad would outshine its own dim body).
        const intensity = errorEntry
          ? DECAY_SATURATION
          : todo.completed
          ? 0.4
          : 1.0;
        let strength: number;

        // Story 3.3: completed / deleted pads use the action tint
        // (green / red HDR) for their halo instead of the pad's own
        // color, so history reads at a glance regardless of palette.
        // The pad body, rim, and opacity are unchanged — only the
        // surrounding halo signals the status.
        const baseGlowR =
          visualState === 'completed'
            ? COMPLETE_PAD_TINT.x
            : visualState === 'deleted'
            ? DELETE_PAD_TINT.x
            : colorVec.r * AMBIENT_GLOW_HDR_SCALE;
        const baseGlowG =
          visualState === 'completed'
            ? COMPLETE_PAD_TINT.y
            : visualState === 'deleted'
            ? DELETE_PAD_TINT.y
            : colorVec.g * AMBIENT_GLOW_HDR_SCALE;
        const baseGlowB =
          visualState === 'completed'
            ? COMPLETE_PAD_TINT.z
            : visualState === 'deleted'
            ? DELETE_PAD_TINT.z
            : colorVec.b * AMBIENT_GLOW_HDR_SCALE;

        if (focused) {
          // Stamp the focus anchor on the first tick we see `focused`.
          // The osc phase then reads from elapsed-since-focus-open, so
          // every popup opens at osc=0 (pad-color) and breathes toward
          // white on a fixed cadence — reproducible feel per open.
          if (focusStartTimeRef.current === null) {
            focusStartTimeRef.current = state.clock.elapsedTime;
          }
          const focusElapsed = state.clock.elapsedTime - focusStartTimeRef.current;
          const osc =
            0.5 +
            0.5 *
              Math.sin((focusElapsed * 2 * Math.PI) / FOCUSED_OSC_PERIOD_S);
          uColor.set(baseGlowR, baseGlowG, baseGlowB);
          uColor.lerp(FOCUS_PAD_GLOW, osc);
          strength = FOCUSED_GLOW_STRENGTH * intensity;
        } else {
          uColor.set(baseGlowR, baseGlowG, baseGlowB);
          strength = AMBIENT_GLOW_STRENGTH * intensity;
        }

        // Layer the click-to-focus flash on top of the baseline when
        // it's active. The flash ref is cleared in the rim block above
        // once flashT >= 1, so this overlay naturally disappears.
        if (focusFlashStartRef.current !== null) {
          const flashT =
            (state.clock.elapsedTime - focusFlashStartRef.current) /
            FOCUS_FLASH_DURATION;
          if (flashT < 1) {
            const flashDecay = 1 - flashT;
            uColor.lerp(FOCUS_PAD_GLOW, flashDecay);
            strength = THREE.MathUtils.lerp(strength, FOCUS_GLOW_MAX, flashDecay);
          }
        }

        // Story 5.3 (redesigned): search-mode glow follows the same
        // saturation lerp as the body color. Non-matches reach 0
        // (gray pads don't glow); strong matches keep ~full glow;
        // weak matches glow proportionally. Multiplying rather than
        // overriding preserves the underlying focused/ambient/flash
        // logic during non-search frames (saturation = 1).
        strength *= searchSaturationRef.current;

        glowMatRef.current.uniforms.uStrength.value = strength;
      }

      // Selection ring animation — driven from isSelected + wasSelectedRef
      // transition detection. Ring expands + fades out on deselect so the
      // switch from selection ring → cluster halo reads as a pop.
      if (selectionRingRef.current) {
        const ring = selectionRingRef.current;
        const ringMat = ring.material as THREE.MeshBasicMaterial;
        if (isSelected) {
          selectionFadeRef.current = null;
          ring.visible = true;
          ring.scale.setScalar(1);
          ringMat.opacity = 0.85;
        } else if (!wasSelectedRef.current) {
          // steady deselected state — keep hidden
          ring.visible = false;
        } else {
          // transition: was selected, now not — start fade if not already running
          if (selectionFadeRef.current === null) {
            selectionFadeRef.current = state.clock.elapsedTime;
          }
          const fadeT = Math.min(
            (state.clock.elapsedTime - selectionFadeRef.current) / SELECTION_FADE_DURATION,
            1,
          );
          if (fadeT >= 1) {
            ring.visible = false;
            selectionFadeRef.current = null;
          } else {
            ring.visible = true;
            ring.scale.setScalar(1 + fadeT * 0.4);
            ringMat.opacity = (1 - fadeT) * 0.85;
          }
        }
        wasSelectedRef.current = isSelected;
      }

      return;
    }

    // Staggered-load 'waiting' phase. On the first active frame, stamp the
    // R3F-clock start time. Once `initialDelayMs` has elapsed, transition to
    // 'materializing' — a lighter in-place scale-up than the creation drop
    // arc. Pad stays at rest position (no elevation) and invisible
    // (scale=0) during the wait.
    if (phase === 'waiting') {
      if (waitStartRef.current === null) {
        waitStartRef.current = state.clock.elapsedTime;
      }
      const elapsedMs = (state.clock.elapsedTime - waitStartRef.current) * 1000;
      group.position.set(posX, DROP_Y_REST, posZ);
      group.scale.setScalar(0);
      if (elapsedMs >= initialDelayMs) {
        phaseTimer.current = 0;
        phaseRef.current = 'materializing';
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
    } else if (phase === 'materializing') {
      // Scale up in place at rest position. No ripple, no drop — the pad
      // was already in the DB; this is just the visual appearing after
      // refresh. Ease-out so it "lands" softly rather than popping.
      const t = Math.min(phaseTimer.current / MATERIALIZE_DURATION, 1);
      group.scale.setScalar(easeOut(t));
      group.position.set(posX, DROP_Y_REST, posZ);
      if (t >= 1) {
        setTextOpacity(1);
        phaseTimer.current = 0;
        // Story 2.10 CR-patch: seed position.y with the water elevation
        // at the pad's spawn point so the first resting frame doesn't
        // lerp UP through a wave crest. Without this seed, a crest
        // passing the pad at handoff sits above the pad for ~8 frames
        // (AC #4 violation during the transition window).
        const elev = usePondStore.getState().sampleElevation(posX, posZ);
        group.position.y = targetY.current + elev;
        phaseRef.current = 'resting';
        restStartTime.current = 0;
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
      // Story 2.10 CR-patch: a new pad emits an impact ripple at
      // `onDropComplete` (end of dropping). The settling and pulsing
      // phases play out ON TOP of that outgoing ripple, so the pad
      // should visibly bob on the crests it just created — otherwise
      // the pad reads as "hovering above its own splash." AC #3 was
      // amended in the 2026-04-20 CR to allow water-riding in
      // settling + pulsing (the two landing phases); dropping,
      // completing, deleting, and terminal states remain un-sampled
      // because their own animation fully owns y.
      //
      // Elevation is LERPED (not hard-written) because the pad sits
      // at its own ripple's epicenter, where sin(-t*5.5) oscillates
      // rapidly and splash=exp(-10t) spikes sharply. RIDE_LERP acts
      // as a low-pass filter — matches resting's smoothing.
      const rawElev = usePondStore.getState().sampleElevation(posX, posZ);
      rideElevRef.current = THREE.MathUtils.lerp(
        rideElevRef.current,
        rawElev,
        RIDE_LERP,
      );
      group.position.set(
        posX,
        DROP_Y_REST + bounce + rideElevRef.current,
        posZ,
      );
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
      // Story 2.10 CR-patch: ride the water during the pulse too —
      // the impact ripple from the drop is still radiating outward
      // during this 1.2s window and the pad should bob on it.
      // Shares `rideElevRef` with settling for continuity across the
      // settling→pulsing boundary (no snap on transition).
      {
        const rawElev = usePondStore.getState().sampleElevation(posX, posZ);
        rideElevRef.current = THREE.MathUtils.lerp(
          rideElevRef.current,
          rawElev,
          RIDE_LERP,
        );
        group.position.y = DROP_Y_REST + rideElevRef.current;
      }
      // Rim: fade-blink between yellow glow and normal color
      const glow = Math.max(0, wave) * decay;
      if (rimRef.current) {
        const mat = rimRef.current.material as THREE.MeshBasicMaterial;
        mat.color.set(color).lerp(CREATION_RIM_COLOR, glow);
        mat.opacity = 0.4 + glow * 0.6;
      }
      // Story 2.8: water glow during creation pulse —
      //   Color flashes green↔gold synced to the wave (gold at crests,
      //     back toward the pad's own HDR color at troughs).
      //   Strength grows linearly from 0 to AMBIENT_GLOW_STRENGTH
      //     across the 1.2s pulse (the "halo growing in" feel) with an
      //     additive crest boost layered on top so each pulse reads as
      //     a burst rather than a monotonic ramp.
      //   At pulse end, strength naturally equals AMBIENT and color is
      //     at pad HDR — seamless handoff to the resting-branch ambient
      //     write below.
      if (glowMatRef.current) {
        const uColor = glowMatRef.current.uniforms.uColor.value;
        uColor.set(
          colorVec.r * AMBIENT_GLOW_HDR_SCALE,
          colorVec.g * AMBIENT_GLOW_HDR_SCALE,
          colorVec.b * AMBIENT_GLOW_HDR_SCALE,
        );
        uColor.lerp(CREATION_PAD_GLOW, glow);
        const baseGrowth = t * AMBIENT_GLOW_STRENGTH;
        const crestBoost = glow * 0.35;
        glowMatRef.current.uniforms.uStrength.value = baseGrowth + crestBoost;
      }
      if (t >= 1) {
        group.scale.setScalar(1);
        if (rimRef.current) {
          const mat = rimRef.current.material as THREE.MeshBasicMaterial;
          mat.color.set(color);
          mat.opacity = 0.4;
        }
        // No glow zero-out — the pulse formula above already lands at
        // strength=AMBIENT_GLOW_STRENGTH and color=pad HDR, matching
        // exactly what the resting branch will write on the next frame.
        // Story 2.10 CR-patch: seed position.y from the already-lerped
        // `rideElevRef` (not raw elev) so the pulsing→resting handoff
        // is continuous — pulsing's last written y was
        // `DROP_Y_REST + rideElevRef.current`, and the seed below
        // lands at the equivalent `targetY + rideElevRef.current`.
        // No snap.
        group.position.set(
          posX,
          targetY.current + rideElevRef.current,
          posZ,
        );
        restStartTime.current = 0;
        phaseRef.current = 'resting';
      }
    }
  });

  return (
    <group ref={groupRef}>
      {/* Pad surface with procedural vein texture */}
      <mesh
        ref={padMeshRef}
        geometry={flatGeometry}
        position={[0, 0.1, 0]}
        renderOrder={10}
        onPointerDown={handlePadPointerDown}
        // Story 4.6 (user feedback 2026-04-23): hovering any lily pad
        // swaps the firefly for the neon frog-hand cursor so the pad
        // reads as "draggable". Only swap from the idle 'firefly'
        // state — a mid-drag 'grabbing' (handle or this pad) must not
        // be stomped by a hover event, and the cluster handle's own
        // 'grab' state stays owned by the handle.
        onPointerEnter={() => {
          const state = usePondStore.getState();
          if (state.cursorMode === 'firefly') {
            state.setCursorMode('grab');
          }
        }}
        onPointerLeave={() => {
          const state = usePondStore.getState();
          // Revert only from 'grab' — drag-in-progress ('grabbing')
          // is preserved; the drag's own onWindowUp will reset.
          if (state.cursorMode === 'grab' && !isDraggingRef.current) {
            state.setCursorMode('firefly');
          }
        }}
      >
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
      {/* Text label — fades in on landing. Hidden during the completion OR
          deletion sequence (store override) AND the terminal-* window before
          unmount. `*StartTime` state mirrors persist across `finish*` so a
          one-frame label flash over a scale=0 pad is avoided. The
          external-cancel recovery paths null them again, restoring the label. */}
      {!completing && !deleting && completingStartTime === null && deletingStartTime === null && (
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
      )}
      {/* Completion creature — only visible during the emerge window of the
          `completing` phase. The component self-hides before/after via its
          useFrame; mounting while `completing` is present is enough. */}
      {completing && completingStartTime !== null && (
        <EmergingCreature
          creatureType={completing.creatureType}
          color={color}
          basePosition={[0, 0.15, 0]}
          startTime={completingStartTime + COMPLETING_EMERGE_START}
          duration={COMPLETING_EMERGE_END - COMPLETING_EMERGE_START}
        />
      )}
      {/* Story 4.6: selection ring — visible while this pad is Ctrl/Shift-
          selected; animates away on deselect. Flat ring geometry lying on
          the pad plane. userData.skipDissolve keeps fadePadMaterials from
          touching it during the completion/deletion sequences. */}
      <mesh
        ref={selectionRingRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, SELECTION_RING_Y, 0]}
        visible={false}
        userData={{ skipDissolve: true }}
        renderOrder={13}
      >
        <ringGeometry args={[SELECTION_RING_INNER, SELECTION_RING_OUTER, SELECTION_RING_SEGMENTS]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Story 2.8: additive HDR halo on the water below the pad. Always
          mounted (uniforms default to strength=0 → null contribution);
          useFrame branches above write per-phase color + strength.
          Rendered last in JSX so `querySelector('mesh')` in existing
          tests still returns the clickable pad mesh — renderOrder=5
          on the glow mesh (Object3D property) paints before the pad
          (renderOrder=10) and rim (11/12), so the halo sits visually
          beneath the pad regardless of JSX order. */}
      <GlowSource ref={glowMatRef} radius={GLOW_RADIUS} yOffset={GLOW_Y_OFFSET} />
    </group>
  );
}
