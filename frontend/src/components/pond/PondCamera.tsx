import { useRef, useEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { usePondStore } from '../../stores/usePondStore';

const LERP_SPEED = 0.05;
const ARRIVE_THRESHOLD = 0.1;

const raycaster = new THREE.Raycaster();
const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const mouseNDC = new THREE.Vector2();
const hitPoint = new THREE.Vector3();

interface SceneHandledEvent {
  sceneHandled?: boolean;
}

export function PondCamera() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera, gl } = useThree();
  const cameraFocus = usePondStore((s) => s.cameraFocus);
  const targetVec = useRef(new THREE.Vector3(0, 0, 0));
  const animating = useRef(false);
  const clickStart = useRef<{ x: number; y: number } | null>(null);

  const cancelAnimation = useCallback(() => {
    animating.current = false;
    usePondStore.setState({ cameraFocus: null });
  }, []);

  const handlePointerDown = useCallback((e: PointerEvent) => {
    if (e.button === 0) {
      clickStart.current = { x: e.clientX, y: e.clientY };
    }
    if (animating.current) cancelAnimation();
  }, [cancelAnimation]);

  const handleWheel = useCallback(() => {
    if (animating.current) cancelAnimation();
  }, [cancelAnimation]);

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (e.button !== 0 || !clickStart.current) return;
      const start = clickStart.current;
      clickStart.current = null;

      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) return;

      // If a 3D scene element (pad or popup button) absorbed this click, skip water logic
      if ((e as PointerEvent & SceneHandledEvent).sceneHandled) return;

      mouseNDC.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      );
      raycaster.setFromCamera(mouseNDC, camera);
      const hit = raycaster.ray.intersectPlane(waterPlane, hitPoint);
      if (!hit) return;

      const { activePopupTodoId, closePopup } = usePondStore.getState();
      if (activePopupTodoId !== null) {
        closePopup();
        return;
      }

      targetVec.current.copy(hit);
      animating.current = true;
    },
    [camera],
  );

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('wheel', handleWheel);
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [gl, handlePointerDown, handlePointerUp, handleWheel]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;

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
      mouseButtons={{
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.ROTATE,
      }}
    />
  );
}
