// Story 4.6 AC #13: cluster drag handle visibility is driven by
// hovering the HALO AREA (the circle encompassing a group's pads),
// not by hovering an individual pad. This component listens to
// canvas-level pointermove events, raycasts against the water plane,
// and tests each group's halo radius against the mouse world
// position — updating `hoveredGroupId` accordingly.
//
// Why a pointermove listener instead of a transparent R3F mesh: adding
// a hover-hitbox mesh at the halo radius would either intercept
// water-clicks (breaking popup-close-on-water-click) or sit behind
// the water (never receiving events). The window-level listener
// pattern mirrors what PondCamera already does for click-to-close —
// clean, no event-bubbling conflicts, and zero per-frame cost
// outside of active mouse movement.
//
// Mount exactly once inside the Canvas (needs useThree for camera +
// canvas handle). Renders nothing.
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { usePondStore } from '../../stores/usePondStore';

// Module-scope scratch objects — reused each move to avoid per-event
// allocation on a high-frequency mousemove.
const _hoverRaycaster = new THREE.Raycaster();
const _hoverNDC = new THREE.Vector2();
const _hoverPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hoverHit = new THREE.Vector3();

export function GroupHaloHover() {
  const { camera, gl } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;

    const onMove = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      _hoverNDC.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      _hoverRaycaster.setFromCamera(_hoverNDC, camera);

      const store = usePondStore.getState();
      if (!_hoverRaycaster.ray.intersectPlane(_hoverPlane, _hoverHit)) {
        if (store.hoveredGroupId !== null) store.setHoveredGroupId(null);
        return;
      }

      const mx = _hoverHit.x;
      const mz = _hoverHit.z;
      const meta = store.groupMeta;
      let matched: string | null = null;
      for (const [gid, m] of meta) {
        const dx = mx - m.centroid.x;
        const dz = mz - m.centroid.z;
        // Squared-distance compare avoids a per-group sqrt.
        if (dx * dx + dz * dz <= m.R * m.R) {
          matched = gid;
          break;
        }
      }
      // setHoveredGroupId no-ops on identical values, so idle movement
      // inside the same halo doesn't churn the store.
      store.setHoveredGroupId(matched);
    };

    // Window-level (not canvas-level) so the listener keeps firing when
    // the cursor moves over the ClusterDragHandle div — drei's <Html>
    // portals the handle OUTSIDE the canvas's DOM subtree, so a
    // canvas-bound listener would briefly stop updating as the cursor
    // transitions canvas → handle, causing the handle to blink out for
    // one frame before isHandleHoveredRef picks it back up.
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
    };
  }, [camera, gl]);

  return null;
}
