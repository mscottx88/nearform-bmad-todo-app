// Story 4.6 AC #13, #21–#25: cluster drag handle — DOM overlay positioned
// on the halo circle directed toward the bbox lower-right corner. Uses
// drei's <Html> component so the DOM content is created outside R3F's
// custom reconciler (createPortal from react-dom would fail inside Canvas).
//
// Two-phase drag:
//   slide — mouse inside halo: handle tracks halo boundary, cluster still.
//   grip  — mouse outside halo: cluster translates rigidly via onTranslate.
import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Todo } from '../../types';
import { usePondStore } from '../../stores/usePondStore';
import {
  computeCentroid,
  computeHaloRadius,
  computeBbox,
  computeHandleWorldPos,
  projectWorldToScreen,
} from '../../lib/clusterGeometry';

// Module-level scratch objects — reused each frame to avoid per-frame GC.
const _handleNDC = new THREE.Vector2();
const _handleRaycaster = new THREE.Raycaster();
const _handleWorldPoint = new THREE.Vector3();
const WATER_PLANE_HANDLE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

interface ClusterDragHandleProps {
  groupId: string;
  members: Todo[];
  /** Called during grip phase with the cumulative (dx, dz) from drag start. */
  onTranslate: (dx: number, dz: number) => void;
  /** Called on pointerup — caller commits member positions and clears translation. */
  onDragEnd: () => void;
}

export function ClusterDragHandle({
  groupId,
  members,
  onTranslate,
  onDragEnd,
}: ClusterDragHandleProps) {
  const groupRef = useRef<THREE.Group>(null);
  // Ref to the inner content div rendered by <Html>, for imperative show/hide
  // and rotation updates without React re-renders.
  const contentRef = useRef<HTMLDivElement>(null);
  const { camera, gl, size } = useThree();

  // Drag phase.
  const phaseRef = useRef<'idle' | 'slide' | 'grip'>('idle');
  // Centroid captured at pointerdown — stays frozen during slide phase.
  const capturedCentroidRef = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  const capturedRadiusRef = useRef(0);
  // Handle world position updated each frame (resting) or per move (dragging).
  const handleWorldPosRef = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  // Frozen at grip transition: gripOffset = H − C (direction × R from centroid).
  const gripOffsetRef = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  // Evolving centroid during grip phase.
  const currentCentroidRef = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  // Cumulative translation passed to onTranslate each move during grip.
  const cumulativeDxRef = useRef(0);
  const cumulativeDzRef = useRef(0);
  // True while the cursor is over the handle div itself — maintains visibility
  // during the brief window between pad pointerLeave and handle pointerEnter.
  const isHandleHoveredRef = useRef(false);
  // Pointer tracking — mirrors LilyPad's window-listener approach.
  const pointerIdRef = useRef<number | null>(null);
  const windowMoveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const windowUpRef = useRef<((e: PointerEvent) => void) | null>(null);

  const detachListeners = () => {
    if (windowMoveRef.current) {
      window.removeEventListener('pointermove', windowMoveRef.current);
      windowMoveRef.current = null;
    }
    if (windowUpRef.current) {
      window.removeEventListener('pointerup', windowUpRef.current);
      window.removeEventListener('pointercancel', windowUpRef.current);
      windowUpRef.current = null;
    }
    pointerIdRef.current = null;
  };

  // Drop any in-flight listeners when the component unmounts.
  useEffect(() => detachListeners, []);

  const getMouseWorld = (
    clientX: number,
    clientY: number,
  ): { x: number; z: number } | null => {
    const rect = gl.domElement.getBoundingClientRect();
    _handleNDC.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    _handleRaycaster.setFromCamera(_handleNDC, camera);
    if (_handleRaycaster.ray.intersectPlane(WATER_PLANE_HANDLE, _handleWorldPoint)) {
      return { x: _handleWorldPoint.x, z: _handleWorldPoint.z };
    }
    return null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    pointerIdRef.current = e.nativeEvent.pointerId;
    detachListeners();

    const memberPositions = members.map((t) => ({
      x: t.positionX ?? 0,
      z: t.positionY ?? 0,
    }));
    const centroid = computeCentroid(memberPositions);
    const R = computeHaloRadius(memberPositions, centroid);
    const bbox = computeBbox(memberPositions);
    const handlePos = computeHandleWorldPos(centroid, bbox, R);

    capturedCentroidRef.current = { ...centroid };
    capturedRadiusRef.current = R;
    handleWorldPosRef.current = { ...handlePos };
    currentCentroidRef.current = { ...centroid };
    cumulativeDxRef.current = 0;
    cumulativeDzRef.current = 0;
    phaseRef.current = 'slide';

    const onMove = (ev: PointerEvent) => {
      if (pointerIdRef.current !== ev.pointerId) return;
      if (ev.buttons === 0) { onUp(ev); return; }

      const M = getMouseWorld(ev.clientX, ev.clientY);
      if (!M) return;

      const C = capturedCentroidRef.current;
      const R = capturedRadiusRef.current;
      const mdx = M.x - C.x;
      const mdz = M.z - C.z;
      const dist = Math.sqrt(mdx * mdx + mdz * mdz);
      const safeDist = dist < 1e-6 ? 1e-6 : dist;

      if (phaseRef.current === 'slide') {
        // Handle tracks halo boundary: H = C + normalize(M − C) * R
        const newH = { x: C.x + (mdx / safeDist) * R, z: C.z + (mdz / safeDist) * R };
        handleWorldPosRef.current = newH;
        if (dist > R) {
          // Grip transition: freeze gripOffset = H − C
          gripOffsetRef.current = { x: newH.x - C.x, z: newH.z - C.z };
          phaseRef.current = 'grip';
        }
      } else if (phaseRef.current === 'grip') {
        // C_new = M − gripOffset; delta = C_new − C_current; handle = M
        const newCx = M.x - gripOffsetRef.current.x;
        const newCz = M.z - gripOffsetRef.current.z;
        const ddx = newCx - currentCentroidRef.current.x;
        const ddz = newCz - currentCentroidRef.current.z;
        currentCentroidRef.current = { x: newCx, z: newCz };
        cumulativeDxRef.current += ddx;
        cumulativeDzRef.current += ddz;
        handleWorldPosRef.current = { ...M };
        onTranslate(cumulativeDxRef.current, cumulativeDzRef.current);
        // Story 4.6 AC #24: camera follows the mouse during grip phase.
        // The new centroid world-pos is the right follow target — it's
        // where the cluster is being moved TO each frame. On pointerup
        // the parent's onDragEnd clears followTarget.
        usePondStore.getState().setFollowTarget({ worldX: newCx, worldZ: newCz });
      }
    };

    const onUp = (ev: PointerEvent) => {
      if (pointerIdRef.current !== ev.pointerId) return;
      phaseRef.current = 'idle';
      detachListeners();
      onDragEnd();
    };

    windowMoveRef.current = onMove;
    windowUpRef.current = onUp;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  useFrame(() => {
    if (!groupRef.current || members.length === 0) return;

    const store = usePondStore.getState();
    const isVisible =
      store.hoveredGroupId === groupId ||
      isHandleHoveredRef.current ||
      phaseRef.current !== 'idle';

    if (contentRef.current) {
      contentRef.current.style.display = isVisible ? 'block' : 'none';
    }

    // Compute handle and centroid world positions.
    let handlePos: { x: number; z: number };
    let centroid: { x: number; z: number };

    if (phaseRef.current !== 'idle') {
      handlePos = handleWorldPosRef.current;
      centroid =
        phaseRef.current === 'grip'
          ? currentCentroidRef.current
          : capturedCentroidRef.current;
    } else {
      const memberPositions = members.map((t) => ({
        x: t.positionX ?? 0,
        z: t.positionY ?? 0,
      }));
      centroid = computeCentroid(memberPositions);
      const R = computeHaloRadius(memberPositions, centroid);
      const bbox = computeBbox(memberPositions);
      handlePos = computeHandleWorldPos(centroid, bbox, R);
    }

    // Position the Three.js group at the handle (drei's Html projects this to screen).
    groupRef.current.position.set(handlePos.x, 0.4, handlePos.z);

    if (isVisible && contentRef.current) {
      // Rotate chevron to point radially outward (centroid → handle direction).
      const { sx, sy } = projectWorldToScreen(handlePos, camera, size.width, size.height);
      const { sx: cx, sy: cy } = projectWorldToScreen(centroid, camera, size.width, size.height);
      const angleDeg = Math.atan2(sy - cy, sx - cx) * (180 / Math.PI);
      contentRef.current.style.transform = `rotate(${angleDeg}deg)`;
    }
  });

  return (
    <group ref={groupRef}>
      <Html center>
        <div
          ref={contentRef}
          style={{
            display: 'none',
            // Solid neon-ringed disc with an outward chevron glyph.
            // Previous 16px text + soft textShadow read as "barely
            // noticeable" in the pond scene — this disc + bold glyph
            // makes the affordance clearly visible at glance.
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: 'rgba(0, 14, 22, 0.8)',
            border: '2px solid #00eeff',
            boxShadow:
              '0 0 12px #00eeff, 0 0 24px rgba(0, 238, 255, 0.6), inset 0 0 8px rgba(0, 238, 255, 0.4)',
            color: '#00eeff',
            fontSize: '22px',
            fontFamily: "'Share Tech Mono', monospace",
            fontWeight: 'bold',
            lineHeight: '32px',
            textAlign: 'center',
            textShadow: '0 0 6px #00eeff',
            // cursor: 'none' so the global custom firefly cursor stays
            // visible when hovering the handle. Previous 'grab' /
            // 'grabbing' values overrode the root `cursor: none` and
            // brought back the system cursor over the handle.
            cursor: 'none',
            userSelect: 'none',
            pointerEvents: 'auto',
            opacity: 1,
          }}
          onPointerDown={handlePointerDown}
          onPointerEnter={() => {
            isHandleHoveredRef.current = true;
          }}
          onPointerLeave={() => {
            isHandleHoveredRef.current = false;
          }}
        >
          ›
        </div>
      </Html>
    </group>
  );
}
