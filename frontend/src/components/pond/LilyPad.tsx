import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Todo } from '../../types';
import { usePondStore, selectCompleting, selectDeleting } from '../../stores/usePondStore';
import { EmergingCreature } from '../creatures/EmergingCreature';

// 'completed' / 'deleted' are terminal phases — the dissolve finished
// locally and the pad is awaiting unmount. Distinct from 'completing' /
// 'deleting' so we can distinguish "happy-path finish" from "external
// cancel" in the recovery branch.
type DropPhase =
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
const PULSE_DURATION = 1.2; // 3 pulses over ~1.2 seconds
const PAD_RADIUS = 1.0;
const COMPLETED_Y = -0.1;
const COMPLETION_LERP = 0.05;
const RIM_HEIGHT = 0.07;
const SEGMENTS = 48;
const NOTCH_ANGLE = 0.08;

// Completion-sequence timings in seconds (R3F clock). See story 2-4 dev notes
// for the single source of truth.
const COMPLETING_FLASH_END = 0.30;
const COMPLETING_EMERGE_START = 0.20;
const COMPLETING_EMERGE_END = 0.70;
const COMPLETING_DISSOLVE_START = 0.40;
const COMPLETING_DISSOLVE_END = 1.20;
const COMPLETING_TOTAL = 1.60;
const COMPLETE_FLASH_COLOR = new THREE.Vector3(0.224, 1.0, 0.078); // #39ff14

// Deletion-sequence timings mirror completion but drop the Emerge phase —
// no creature on delete. See story 2-5 for the single source of truth.
const DELETING_FLASH_END = 0.30;
const DELETING_DISSOLVE_START = 0.40;
const DELETING_DISSOLVE_END = 1.20;
const DELETING_TOTAL = 1.60;
const DELETE_FLASH_COLOR = new THREE.Vector3(1.0, 0.09, 0.267); // #ff1744

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
}

export function LilyPad({ todo, onDropComplete, focused = false }: LilyPadProps) {
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
  const targetY = useRef(todo.completed ? COMPLETED_Y : DROP_Y_REST);
  const phaseRef = useRef<DropPhase>(isRecent ? 'forming' : 'resting');
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
  const [textOpacity, setTextOpacity] = useState(isRecent ? 0 : 1);

  // Subscribe to the completion-sequence entry for this todo. When present,
  // the pad transitions into the `completing` phase and drives the flash →
  // emerge → dissolve → settle arc.
  const completing = usePondStore(selectCompleting(todo.id));
  // Parallel subscription for the deletion-sequence entry.
  const deleting = usePondStore(selectDeleting(todo.id));

  const posX = todo.positionX ?? 0;
  const posZ = todo.positionY ?? 0;
  const color = todo.color || '#00ff88';
  const colorVec = useMemo(() => new THREE.Color(color), [color]);

  // Sync target Y to the latest completion state via an effect so we don't
  // mutate a ref during render (react-hooks rule).
  useEffect(() => {
    targetY.current = todo.completed ? COMPLETED_Y : DROP_Y_REST;
  }, [todo.completed]);

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
  }));

  useEffect(() => {
    const group = groupRef.current;
    if (!group?.position) return;
    group.rotation.y = rotationY;
    if (phaseRef.current !== 'resting') {
      group.position.set(posX, DROP_Y_START, posZ);
      group.scale.setScalar(0);
    } else {
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
    }

    const phase = phaseRef.current;

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
        const store = usePondStore.getState();
        store.finishCompletion(todo.id);
        store.finishDeletion(todo.id);
        return;
      }

      // Flash: override shader uColor to full-intensity neon green for the
      // 300ms flash window (AC #2 — "at full intensity"), then restore to
      // the pad's base color on flash-end. The dissolve's opacity fade
      // hides whatever color is underneath.
      if (padMeshRef.current) {
        const mat = padMeshRef.current.material as THREE.ShaderMaterial;
        if (mat.uniforms?.uColor) {
          if (t < COMPLETING_FLASH_END) {
            mat.uniforms.uColor.value.copy(COMPLETE_FLASH_COLOR);
          } else {
            mat.uniforms.uColor.value.set(colorVec.r, colorVec.g, colorVec.b);
          }
        }
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
        const store = usePondStore.getState();
        store.finishDeletion(todo.id);
        store.finishCompletion(todo.id);
        return;
      }

      // Flash: snap uColor to full-intensity neon red for the 300ms flash
      // window (AC #2 — "at full intensity"), then restore to the pad's
      // base color on flash-end. The dissolve's opacity fade hides whatever
      // color is underneath.
      if (padMeshRef.current) {
        const mat = padMeshRef.current.material as THREE.ShaderMaterial;
        if (mat.uniforms?.uColor) {
          if (t < DELETING_FLASH_END) {
            mat.uniforms.uColor.value.copy(DELETE_FLASH_COLOR);
          } else {
            mat.uniforms.uColor.value.set(colorVec.r, colorVec.g, colorVec.b);
          }
        }
      }

      // Ripple: fire exactly once at the dissolve start.
      if (!deletingRippleFired.current && t >= DELETING_DISSOLVE_START) {
        usePondStore.getState().triggerRipple(posX, posZ);
        deletingRippleFired.current = true;
      }

      // Dissolve: no creature to keep visible — plain fade of the whole pad.
      if (t >= DELETING_DISSOLVE_START) {
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
      // Progressive density override: ensure focused pads render at readable size
      const targetScale = focused ? 1.2 : 1.0;
      const currentScale = group.scale.x;
      group.scale.setScalar(THREE.MathUtils.lerp(currentScale, targetScale, COMPLETION_LERP));
      group.position.x = posX + Math.sin(t * 0.3 + seed) * 0.08 * ramp;
      group.position.z = posZ + Math.cos(t * 0.25 + seed * 1.3) * 0.06 * ramp;
      // Smooth transition between active/completed Y + gentle bob
      const restY = THREE.MathUtils.lerp(
        group.position.y - Math.sin(t * 0.5 + seed) * 0.01 * ramp,
        targetY.current,
        COMPLETION_LERP,
      );
      group.position.y = restY + Math.sin(t * 0.5 + seed) * 0.01 * ramp;

      // Desaturate pad shader when completed
      if (padMeshRef.current) {
        const mat = padMeshRef.current.material as THREE.ShaderMaterial;
        if (mat.uniforms?.uColor) {
          const intensity = todo.completed ? 0.4 : 1.0;
          const targetColor = new THREE.Vector3(
            colorVec.r * intensity,
            colorVec.g * intensity,
            colorVec.b * intensity,
          );
          mat.uniforms.uColor.value.lerp(targetColor, COMPLETION_LERP);
        }
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
      if (rimRef.current) {
        const mat = rimRef.current.material as THREE.MeshBasicMaterial;
        const glow = Math.max(0, wave) * decay;
        mat.color.set(color).lerp(new THREE.Color('#ffd700'), glow);
        mat.opacity = 0.4 + glow * 0.6;
      }
      if (t >= 1) {
        group.scale.setScalar(1);
        if (rimRef.current) {
          const mat = rimRef.current.material as THREE.MeshBasicMaterial;
          mat.color.set(color);
          mat.opacity = 0.4;
        }
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
    </group>
  );
}
