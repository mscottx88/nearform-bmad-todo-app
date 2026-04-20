import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Todo } from '../../types';
import {
  usePondStore,
  selectCompleting,
  selectDeleting,
  selectTodoError,
} from '../../stores/usePondStore';
import { EmergingCreature } from '../creatures/EmergingCreature';
import { GlowSource } from './GlowSource';

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
  // Story 2.8 follow-up: anchor for the sustained focused-halo oscillation
  // (AC #10). Stamped lazily on the first useFrame tick where `focused` is
  // true and this ref is null — keeps the osc phase reproducible ("starts
  // at pad color, breathes toward white") instead of starting wherever
  // wall-clock time happens to land.
  const focusStartTimeRef = useRef<number | null>(null);
  const prevFocusedRef = useRef(focused);
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

  const posX = todo.positionX ?? 0;
  const posZ = todo.positionY ?? 0;
  const color = todo.color || '#00ff88';
  const colorVec = useMemo(() => new THREE.Color(color), [color]);

  // Sync target Y to the latest completion state via an effect so we don't
  // mutate a ref during render (react-hooks rule).
  useEffect(() => {
    targetY.current = todo.completed ? COMPLETED_Y : DROP_Y_REST;
  }, [todo.completed]);

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
      usePondStore.getState().clearTodoError(id);
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

  const handlePadClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      // Ignore clicks on a pad mid-sequence (completion OR deletion) — the
      // pad is still visibly present (scale/opacity > 0) through ~t=1.0s of
      // the dissolve, so it remains hit-testable. A second Complete would
      // fire a duplicate POST /creatures that fails on the DB
      // UniqueConstraint; a second Delete would fire a duplicate DELETE.
      const state = usePondStore.getState();
      if (state.completingTodos.has(todo.id) || state.deletingTodos.has(todo.id)) return;
      state.openPopup(todo.id, posX, posZ);
    },
    [todo.id, posX, posZ],
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
      const targetScale = baseTargetScale + decayFlicker;
      const currentScale = group.scale.x;
      group.scale.setScalar(THREE.MathUtils.lerp(currentScale, targetScale, COMPLETION_LERP));
      group.position.x = posX + Math.sin(t * 0.3 + seed) * 0.08 * ramp;
      group.position.z = posZ + Math.cos(t * 0.25 + seed * 1.3) * 0.06 * ramp;

      // Story 2.10: pad rides the water surface. Sample elevation at
      // the pad's (x, z) world position and lerp `position.y` toward
      // `targetY.current + elevation`. `targetY.current` still drives
      // the active/completed base height; water motion rides on top.
      // Replaces the fake 0.01-amplitude sine bob that predated the
      // sampler. Sampler is registered by WaterSurface on mount; before
      // that it returns 0 (flat water) — harmless fallback.
      const samplePond = usePondStore.getState().sampleElevation;
      const elevation = samplePond(posX, posZ);
      group.position.y = THREE.MathUtils.lerp(
        group.position.y,
        targetY.current + elevation,
        RIDE_LERP,
      );

      // Story 2.10: tilt the pad toward the local water gradient via
      // central differences at ±TILT_DELTA around the pad center.
      // Small-angle alignment of pad +Y with water normal
      // (-df/dx, 1, -df/dz):
      //   rotation.z = +atan(dydx)   → +x wave-rise → +x corner up
      //   rotation.x = -atan(dydz)   → +z wave-rise → +z corner up
      // Both clamped to ±15° per axis (TILT_MAX_RADIANS) so extreme
      // crests can't flip the pad; lerped at TILT_LERP for smoothness.
      // No allocations: raw numbers only, no Vector2/Quaternion.
      const elevXPlus = samplePond(posX + TILT_DELTA, posZ);
      const elevXMinus = samplePond(posX - TILT_DELTA, posZ);
      const elevZPlus = samplePond(posX, posZ + TILT_DELTA);
      const elevZMinus = samplePond(posX, posZ - TILT_DELTA);
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
          uColor.set(
            colorVec.r * AMBIENT_GLOW_HDR_SCALE,
            colorVec.g * AMBIENT_GLOW_HDR_SCALE,
            colorVec.b * AMBIENT_GLOW_HDR_SCALE,
          );
          uColor.lerp(FOCUS_PAD_GLOW, osc);
          strength = FOCUSED_GLOW_STRENGTH * intensity;
        } else {
          uColor.set(
            colorVec.r * AMBIENT_GLOW_HDR_SCALE,
            colorVec.g * AMBIENT_GLOW_HDR_SCALE,
            colorVec.b * AMBIENT_GLOW_HDR_SCALE,
          );
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

        glowMatRef.current.uniforms.uStrength.value = strength;
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
      group.position.set(posX, DROP_Y_REST + bounce, posZ);
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
        group.position.set(posX, DROP_Y_REST, posZ);
        restStartTime.current = 0;
        phaseRef.current = 'resting';
      }
    }
  });

  return (
    <group ref={groupRef}>
      {/* Pad surface with procedural vein texture */}
      <mesh ref={padMeshRef} geometry={flatGeometry} position={[0, 0.1, 0]} renderOrder={10} onClick={handlePadClick}>
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
