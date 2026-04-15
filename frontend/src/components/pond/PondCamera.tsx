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

export function PondCamera() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera, gl } = useThree();
  const cameraFocus = usePondStore((s) => s.cameraFocus);
  const targetVec = useRef(new THREE.Vector3(0, 0, 0));
  const animating = useRef(false);
  const clickStart = useRef<{ x: number; y: number } | null>(null);

  // Left click: track for click-vs-drag; any press cancels centering
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

      // Only trigger on click (not drag)
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) return;

      mouseNDC.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      );
      raycaster.setFromCamera(mouseNDC, camera);
      const hit = raycaster.ray.intersectPlane(waterPlane, hitPoint);
      if (hit) {
        targetVec.current.copy(hit);
        animating.current = true;
      }
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

    // New pad focus takes priority
    if (cameraFocus && !animating.current) {
      targetVec.current.set(cameraFocus.x, 0, cameraFocus.z);
      animating.current = true;
    }

    if (animating.current) {
      const zoomDist = cameraFocus?.zoom;
      const speed = zoomDist ? LERP_SPEED * 1.5 : LERP_SPEED;

      if (zoomDist) {
        // Zoom mode: lerp to exact final position (45° angle, fixed distance)
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
        // Pan mode: slide camera and target together (preserves perspective)
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
