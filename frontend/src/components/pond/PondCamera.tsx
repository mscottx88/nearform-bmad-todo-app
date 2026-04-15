import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { usePondStore } from '../../stores/usePondStore';

const LERP_SPEED = 0.03;
const ARRIVE_THRESHOLD = 0.1;

export function PondCamera() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const cameraFocus = usePondStore((s) => s.cameraFocus);
  const targetVec = useRef(new THREE.Vector3(0, 0, 0));
  const animating = useRef(false);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    if (cameraFocus && !animating.current) {
      targetVec.current.set(cameraFocus.x, 0, cameraFocus.z);
      animating.current = true;
    }

    if (animating.current) {
      controls.target.lerp(targetVec.current, LERP_SPEED);
      controls.update();

      // Stop animating once close enough — hand control back to user
      const dist = controls.target.distanceTo(targetVec.current);
      if (dist < ARRIVE_THRESHOLD) {
        animating.current = false;
        usePondStore.setState({ cameraFocus: null });
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
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.PAN,
      }}
    />
  );
}
