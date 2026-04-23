// Story 4.6 AC #13, #21–#25: cluster drag handle — DOM overlay positioned
// on the halo circle directed toward the bbox lower-right corner. Uses
// drei's <Html> component so the DOM content is created outside R3F's
// custom reconciler (createPortal from react-dom would fail inside Canvas).
//
// Drag model (revised 2026-04-22 per user direction): the handle is
// FIXED at its anchor (bbox-lower-right of the halo) — it no longer
// slides along the halo boundary while the cursor stays inside. As
// soon as the user starts dragging, the entire cluster translates
// rigidly. Implementation:
//   pointerdown → snapshot baselines + the mouse's world position
//   pointermove → translation = currentMouseWorld − startMouseWorld;
//                 write clusterTranslation so LilyPad + ClusterHalo
//                 apply the offset on top of the baselines
//   pointerup   → onDragEnd callback; PondScene fires PATCHes and
//                 holds clusterTranslation until the refetch arrives
//
// Baselines travel with clusterTranslation so consumers compute
// `baseline + (dx, dz)` rather than `todo.positionX + (dx, dz)` — this
// prevents the 2× offset flash when the refetch delivers new positionX
// values before the post-release clear effect runs (same reason
// LilyPad's single-pad drag has stickyDragRef).
//
// Event routing: setPointerCapture on the handle div so drag events
// (move/up/cancel) fire reliably on the div's own React handlers
// throughout the drag, even when the cursor leaves the div bounds. No
// preventDefault on pointerdown — that would suppress the compatibility
// mousemove events that CursorFirefly relies on.
import { useRef } from 'react';
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
  /** Called on pointerup — caller commits member positions and clears translation. */
  onDragEnd: () => void;
}

export function ClusterDragHandle({
  groupId,
  members,
  onDragEnd,
}: ClusterDragHandleProps) {
  const groupRef = useRef<THREE.Group>(null);
  // Ref to the inner content div rendered by <Html>, for imperative show/hide
  // and rotation updates without React re-renders.
  const contentRef = useRef<HTMLDivElement>(null);
  const { camera, gl, size } = useThree();

  // Drag-active flag — true between pointerdown and pointerup/cancel.
  const isDraggingRef = useRef(false);
  // Mouse world position at pointerdown — frozen for the drag duration
  // so each move's translation is computed relative to start.
  const dragStartWorldRef = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  // Snapshot of each member's pre-drag position, frozen at pointerdown
  // and written into clusterTranslation so consumers (handle useFrame,
  // LilyPad, ClusterHalo) can all compute baseline + offset without
  // reading potentially-updated todo.positionX during the post-release
  // refetch window.
  const baselinesRef = useRef<Map<string, { x: number; z: number }>>(new Map());
  // True while the cursor is over the handle div itself — maintains visibility
  // during the brief window between pad pointerLeave and handle pointerEnter.
  const isHandleHoveredRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);

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
    // Only LEFT mouse button drags the group. Right-button (e.button===2)
    // is reserved for OrbitControls pan (see PondCamera); middle-button
    // (e.button===1) is reserved for MMB ascend/descend. User feedback
    // 2026-04-23: "Only left mouse button should be able to drag the
    // group, not right or middle".
    if (e.button !== 0) return;
    e.stopPropagation();
    // Story 4.6 (user feedback 2026-04-23): swap the firefly for a
    // closed-fist neon cursor while dragging. Cleared in endDrag.
    usePondStore.getState().setCursorMode('grabbing');
    // NOTE: do NOT call e.preventDefault(). preventDefault on pointerdown
    // suppresses the compatibility mouse events that CursorFirefly's
    // window.mousemove listener relies on — the firefly would freeze in
    // place while the handle is being dragged. setPointerCapture alone
    // gives us reliable pointer-event routing without the side effect.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Some browsers throw if the element is no longer connected.
    }
    pointerIdRef.current = e.pointerId;

    const baselines = new Map<string, { x: number; z: number }>();
    for (const m of members) {
      baselines.set(m.id, { x: m.positionX ?? 0, z: m.positionY ?? 0 });
    }
    baselinesRef.current = baselines;

    const baselineArr = Array.from(baselines.values());
    const centroid = computeCentroid(baselineArr);
    const startWorld = getMouseWorld(e.clientX, e.clientY);
    dragStartWorldRef.current = startWorld ?? { ...centroid };

    isDraggingRef.current = true;
    // Initial zero-translation write so LilyPad / ClusterHalo switch to
    // baseline-driven rendering on this same frame.
    usePondStore.getState().setClusterTranslation({
      groupId,
      dx: 0,
      dz: 0,
      baselines,
    });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    if (e.buttons === 0) {
      // Missed pointerup — treat as release so we don't leave the
      // handle stuck in the dragging state.
      endDrag(e);
      return;
    }
    if (!isDraggingRef.current) return;

    const M = getMouseWorld(e.clientX, e.clientY);
    if (!M) return;

    const dx = M.x - dragStartWorldRef.current.x;
    const dz = M.z - dragStartWorldRef.current.z;
    usePondStore.getState().setClusterTranslation({
      groupId,
      dx,
      dz,
      baselines: baselinesRef.current,
    });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Capture may already be released by the browser.
    }
    pointerIdRef.current = null;
    isDraggingRef.current = false;
    // Cursor returns to grab if the pointer is still over the handle,
    // otherwise back to the default firefly. onPointerLeave on the
    // handle div fires immediately after if the cursor left during
    // the drag, so 'grab' here is a safe hovered-default.
    usePondStore.getState().setCursorMode(
      isHandleHoveredRef.current ? 'grab' : 'firefly',
    );
    onDragEnd();
  };

  useFrame(() => {
    if (!groupRef.current || members.length === 0) return;

    const store = usePondStore.getState();
    // Story 4.6: handle stays visible through the drag AND the
    // post-release refetch window (clusterTranslation retained by
    // PondScene until positions arrive). Using clusterTranslation as
    // the visibility/position source avoids a one-tick flash to the
    // pre-drag centroid on mouseup — the `isDraggingRef` flag drops
    // before the backend catches up, so relying on it alone made the
    // handle snap back to its original bbox-lower-right anchor.
    const trans = store.clusterTranslation;
    const transActive =
      trans?.groupId === groupId && trans.baselines.size > 0;
    const isVisible =
      store.hoveredGroupId === groupId ||
      isHandleHoveredRef.current ||
      isDraggingRef.current ||
      transActive;

    if (contentRef.current) {
      contentRef.current.style.display = isVisible ? 'block' : 'none';
    }

    // Position sourcing:
    //   - clusterTranslation set → use baselines + (dx, dz). Holds
    //     through drag and post-release sticky window, so the handle
    //     doesn't jump until the refetched todo positions catch up.
    //   - otherwise → use current memberPositions from props.
    let centroid: { x: number; z: number };
    let R: number;
    let bbox: { minX: number; maxX: number; minZ: number; maxZ: number };

    if (transActive && trans) {
      const baselineArr = Array.from(trans.baselines.values());
      const baseCentroid = computeCentroid(baselineArr);
      const baseBbox = computeBbox(baselineArr);
      centroid = {
        x: baseCentroid.x + trans.dx,
        z: baseCentroid.z + trans.dz,
      };
      R = computeHaloRadius(baselineArr, baseCentroid);
      bbox = {
        minX: baseBbox.minX + trans.dx,
        maxX: baseBbox.maxX + trans.dx,
        minZ: baseBbox.minZ + trans.dz,
        maxZ: baseBbox.maxZ + trans.dz,
      };
    } else {
      const memberPositions = members.map((t) => ({
        x: t.positionX ?? 0,
        z: t.positionY ?? 0,
      }));
      centroid = computeCentroid(memberPositions);
      R = computeHaloRadius(memberPositions, centroid);
      bbox = computeBbox(memberPositions);
    }
    const handlePos = computeHandleWorldPos(centroid, bbox, R);

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
            // visible when hovering the handle.
            cursor: 'none',
            userSelect: 'none',
            pointerEvents: 'auto',
            opacity: 1,
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerEnter={() => {
            isHandleHoveredRef.current = true;
            // Only swap to the grab hand when no drag is in progress —
            // otherwise re-entering the handle mid-drag would overwrite
            // the 'grabbing' fist with the 'grab' open-hand.
            if (!isDraggingRef.current) {
              usePondStore.getState().setCursorMode('grab');
            }
          }}
          onPointerLeave={() => {
            isHandleHoveredRef.current = false;
            // Keep 'grabbing' while a drag is active even if the cursor
            // strays off the handle (setPointerCapture lets the drag
            // continue). Only revert to firefly when truly idle.
            if (!isDraggingRef.current) {
              usePondStore.getState().setCursorMode('firefly');
            }
          }}
        >
          {/* Four-way move glyph — unambiguously reads as "drag me".
              User feedback 2026-04-23: the chevron wasn't obvious as a
              drag handle. ✥ (U+2725) is the Unicode "eight-spoked
              asterisk" which renders as a clean move/relocate icon in
              most fonts; combined with the neon ring it communicates
              drag-affordance at a glance. */}
          ✥
        </div>
      </Html>
    </group>
  );
}
