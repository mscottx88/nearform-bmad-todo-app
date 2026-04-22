import { useRef, useEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { usePondStore } from '../../stores/usePondStore';

const LERP_SPEED = 0.05;
const ARRIVE_THRESHOLD = 0.1;

// Reset-animation defaults. DEFAULT_CAMERA_POSITION must match the
// `<Canvas camera={{ position: [0, 15, 20] }}>` values in PondScene.tsx —
// if one changes, change the other. These are also the empty-pond
// fallback for fitCameraToPads.ts, which imports them by name.
export const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 15, 20);
export const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 0, 0);
const RESET_ARRIVE_THRESHOLD = 0.05;

// Hard-floor on camera.y. Enforced every frame (AC #9) and by the
// MMB-descend handler (AC #8). Sits below the orbit+zoom-reachable
// minimum of ~0.71 (maxPolarAngle=π/2.2 × minDistance=5) so orbit
// can still reach its extrema; MMB-descend uses this tighter floor.
const CAMERA_MIN_Y = 0.5;

// World units per mouse pixel for MMB ascend/descend. Tune in browser.
const MMB_ASCEND_SENSITIVITY = 0.03;

const raycaster = new THREE.Raycaster();
const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const mouseNDC = new THREE.Vector2();
const hitPoint = new THREE.Vector3();

// Pre-allocated temporaries for the reset-animation lerp — avoids
// per-frame allocations in useFrame. Mutated in place.
const resetTargetPos = new THREE.Vector3();
const resetTargetTarget = new THREE.Vector3();

export function PondCamera() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera, gl } = useThree();
  const cameraFocus = usePondStore((s) => s.cameraFocus);
  const targetVec = useRef(new THREE.Vector3(0, 0, 0));
  const animating = useRef(false);
  const resetAnimating = useRef(false);
  // Seeded to the counter's current value at mount so a pre-mount bump
  // doesn't retroactively fire a reset on the first frame.
  const lastResetRequestId = useRef(usePondStore.getState().cameraResetRequestId);
  const clickStart = useRef<{ x: number; y: number } | null>(null);
  // null = not currently MMB-dragging; a number = last observed clientY.
  const mmbDragPrevY = useRef<number | null>(null);

  const cancelAnimation = useCallback(() => {
    const wasResetting = resetAnimating.current;
    animating.current = false;
    resetAnimating.current = false;
    usePondStore.setState({ cameraFocus: null });
    if (wasResetting) {
      // User decided where to go instead — clear the pending fit so a
      // subsequent equal-fit request is still seen as fresh by the
      // counter ref-compare.
      usePondStore.getState().clearCameraResetRequest();
    }
  }, []);

  const handlePointerDown = useCallback((e: PointerEvent) => {
    if (e.button === 1) {
      // MMB drag start — begin ascend/descend. Start BEFORE the generic
      // cancelAnimation so we pick up the new drag immediately.
      mmbDragPrevY.current = e.clientY;
      e.preventDefault(); // suppress the browser's MMB auto-scroll UI
      if (animating.current || resetAnimating.current) cancelAnimation();
      return;
    }
    if (e.button === 0) {
      clickStart.current = { x: e.clientX, y: e.clientY };
    }
    if (animating.current || resetAnimating.current) cancelAnimation();
  }, [cancelAnimation]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (mmbDragPrevY.current === null) return;
    const controls = controlsRef.current;
    if (!controls) return;
    const dy = e.clientY - mmbDragPrevY.current;
    mmbDragPrevY.current = e.clientY;
    // drag UP on screen (dy < 0) → ascend (delta > 0)
    let delta = -dy * MMB_ASCEND_SENSITIVITY;
    // Clamp descend so camera.y stays >= CAMERA_MIN_Y. Truncate the
    // delta so the rigid-body (camera + target) translate stays
    // coherent — the target.y advances by the same truncated amount.
    const proposedCameraY = camera.position.y + delta;
    if (proposedCameraY < CAMERA_MIN_Y) {
      delta = CAMERA_MIN_Y - camera.position.y;
    }
    camera.position.y += delta;
    controls.target.y += delta;
  }, [camera]);

  const handleMmbOrCancel = useCallback((e: PointerEvent) => {
    if (e.button === 1 || e.type === 'pointercancel') {
      mmbDragPrevY.current = null;
    }
  }, []);

  const handleWheel = useCallback(() => {
    if (animating.current || resetAnimating.current) cancelAnimation();
  }, [cancelAnimation]);

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (e.button === 1) {
        // MMB released — end the ascend/descend drag.
        mmbDragPrevY.current = null;
        return;
      }
      if (e.button !== 0 || !clickStart.current) return;
      const start = clickStart.current;
      clickStart.current = null;

      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) return;

      // Canvas-relative NDC (not viewport-relative) so the raycast is
      // correct even when the canvas is inset by a sidebar, toolbar, or
      // any future non-fullscreen layout. Using window.innerWidth /
      // innerHeight here was a pre-existing bug carried from Story 1.x.
      const rect = gl.domElement.getBoundingClientRect();
      mouseNDC.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouseNDC, camera);
      const hit = raycaster.ray.intersectPlane(waterPlane, hitPoint);
      if (!hit) return;

      // Click-to-centre is retired in Story 3.1 — with screenSpacePanning=false
      // LMB-drag now gives real ground-plane forward/back motion, so the
      // ad-hoc "click a water point to pan there" affordance is redundant.
      // The popup-close-on-water-click path below is preserved — it's the
      // click-outside-to-dismiss contract for the action popup (Story 2.3).
      const { activePopupTodoId, closePopup } = usePondStore.getState();
      if (activePopupTodoId !== null) {
        closePopup();
      }
    },
    [camera, gl],
  );

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('wheel', handleWheel);
    // pointermove + pointercancel + pointerup on window so a MMB drag
    // that leaves the canvas bounds still updates the camera — and so a
    // MMB release OUTSIDE the canvas still clears the drag state.
    // Without the window-level pointerup, a user who drags off the canvas
    // and releases there would leave `mmbDragPrevY` set, creating a
    // ghost-drag that reactivates on the next pointermove.
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointercancel', handleMmbOrCancel);
    window.addEventListener('pointerup', handleMmbOrCancel);
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('wheel', handleWheel);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointercancel', handleMmbOrCancel);
      window.removeEventListener('pointerup', handleMmbOrCancel);
    };
  }, [gl, handlePointerDown, handlePointerUp, handleWheel, handlePointerMove, handleMmbOrCancel]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    // AC #9: frame-level hard floor on camera.y — defense-in-depth. Runs
    // before any other logic so even a misconfigured reset or future
    // interaction that writes camera.position directly gets caught.
    if (camera.position.y < CAMERA_MIN_Y) {
      camera.position.y = CAMERA_MIN_Y;
    }

    // AC #4: detect new reset request. Ref-compare against the latest
    // counter from the store — only a *change* is the signal.
    const storeSnapshot = usePondStore.getState();
    if (storeSnapshot.cameraResetRequestId !== lastResetRequestId.current) {
      lastResetRequestId.current = storeSnapshot.cameraResetRequestId;
      if (storeSnapshot.pendingCameraFit) {
        resetTargetPos.fromArray(storeSnapshot.pendingCameraFit.position);
        resetTargetTarget.fromArray(storeSnapshot.pendingCameraFit.target);
        resetAnimating.current = true;
        // Stop any in-flight popup-focus lerp from competing for camera position.
        usePondStore.setState({ cameraFocus: null });
      }
      // If the counter bumped but pendingCameraFit is null (cancelled
      // between dispatch and consumption), treat the request as consumed
      // and do nothing — don't start an animation with no target.
    }

    if (resetAnimating.current) {
      // AC #4: reset animation — lerp camera.position + controls.target
      // in parallel toward the stored fit at LERP_SPEED.
      camera.position.lerp(resetTargetPos, LERP_SPEED);
      controls.target.lerp(resetTargetTarget, LERP_SPEED);
      controls.update();
      const posArrived = camera.position.distanceTo(resetTargetPos) < RESET_ARRIVE_THRESHOLD;
      const tgtArrived = controls.target.distanceTo(resetTargetTarget) < RESET_ARRIVE_THRESHOLD;
      if (posArrived && tgtArrived) {
        camera.position.copy(resetTargetPos);
        controls.target.copy(resetTargetTarget);
        resetAnimating.current = false;
        usePondStore.getState().clearCameraResetRequest();
      }
      return;
    }

    // New pad focus takes priority — always run the full pan+zoom animation
    // so the clicked pad reliably ends up centered at the focus distance.
    // Update targetVec every frame while cameraFocus is set to override any
    // earlier target (e.g. a water-click raycast hit that fired during the
    // same pointer event before R3F dispatched the pad's onClick).
    if (cameraFocus) {
      targetVec.current.set(cameraFocus.x, 0, cameraFocus.z);
      animating.current = true;
    }

    if (animating.current) {
      const zoomDist = cameraFocus?.zoom;
      const speed = zoomDist ? LERP_SPEED * 1.5 : LERP_SPEED;

      if (zoomDist) {
        const angle = Math.PI / 4;
        const idealTarget = targetVec.current;
        const idealCamX = idealTarget.x;
        const idealCamY = idealTarget.y + zoomDist * Math.sin(angle);
        const idealCamZ = idealTarget.z + zoomDist * Math.cos(angle);

        controls.target.lerp(idealTarget, speed);
        camera.position.x = THREE.MathUtils.lerp(camera.position.x, idealCamX, speed);
        camera.position.y = THREE.MathUtils.lerp(camera.position.y, idealCamY, speed);
        camera.position.z = THREE.MathUtils.lerp(camera.position.z, idealCamZ, speed);
      } else {
        const dx = (targetVec.current.x - controls.target.x) * speed;
        const dz = (targetVec.current.z - controls.target.z) * speed;
        controls.target.x += dx;
        controls.target.z += dz;
        camera.position.x += dx;
        camera.position.z += dz;
      }

      controls.update();

      const targetDist = controls.target.distanceTo(targetVec.current);
      const camDist = zoomDist
        ? Math.abs(camera.position.y - (targetVec.current.y + zoomDist * Math.sin(Math.PI / 4)))
        : 0;
      if (targetDist < ARRIVE_THRESHOLD && camDist < ARRIVE_THRESHOLD) {
        animating.current = false;
        if (cameraFocus) {
          usePondStore.setState({ cameraFocus: null });
        }
      }
    } else {
      // Keep OrbitControls' internal damping/spherical state in sync with
      // the camera every frame, even when we're not running a focus lerp —
      // otherwise post-animation input (wheel zoom, drag) misfires.
      controls.update();
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      maxPolarAngle={Math.PI / 2.2}
      minDistance={5}
      maxDistance={60}
      enableDamping
      dampingFactor={0.05}
      enablePan
      zoomToCursor
      // Pan parallel to the XZ (ground) plane, NOT the screen. On our
      // tilted view, screen-space panning made up-drag translate the
      // camera upward in world space instead of forward across the pond.
      screenSpacePanning={false}
      // MIDDLE is intentionally omitted — MMB is handled by our own
      // listener below for ascend/descend (AC #8). With MIDDLE undefined,
      // OrbitControls' internal switch falls through to STATE.NONE and
      // leaves the button free.
      //
      // Story 4.2: LEFT is also intentionally omitted so plain left-
      // button drag is always a pad interaction (click or drag), never a
      // camera pan. Ctrl+RMB still pans via OrbitControls' built-in
      // modifier swap on the ROTATE button — so users retain both
      // pan and rotate without the left-button channel fighting the
      // pad-drag gesture.
      mouseButtons={{
        RIGHT: THREE.MOUSE.ROTATE,
      }}
    />
  );
}
