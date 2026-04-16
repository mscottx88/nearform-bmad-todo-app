import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { Todo } from '../../types';
import { usePondStore } from '../../stores/usePondStore';
import { PopupActionButton } from './PopupActionButton';

const OFFSET_X = 1.5;
const OFFSET_Y = 1.5;
const OFFSET_Z = -1.5;
const BUTTON_SPACING = 0.4;
const MATERIALIZE_DURATION = 0.15; // seconds
const FLIP_NDC_HIGH = 0.7;
const FLIP_NDC_LOW = 0.3;

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

interface ActionPopupProps {
  todo: Todo;
  closing?: boolean;
  onComplete: () => void;
  onDelete: () => void;
  onSetColor: () => void;
  onGroup: () => void;
}

export function ActionPopup({
  todo,
  closing = false,
  onComplete,
  onDelete,
  onSetColor,
  onGroup,
}: ActionPopupProps) {
  const scaleGroupRef = useRef<THREE.Group>(null);
  const openStart = useRef<number | null>(null);
  const closeStart = useRef<number | null>(null);
  const cachedScale = useRef(0);
  const [flipped, setFlipped] = useState(false);
  const { camera } = useThree();
  const cameraFocus = usePondStore((s) => s.cameraFocus);

  const padX = todo.positionX ?? 0;
  const padZ = todo.positionY ?? 0;

  // Start materialize-in once the camera has finished focusing
  useEffect(() => {
    if (cameraFocus === null && openStart.current === null && !closing) {
      openStart.current = performance.now() / 1000;
    }
  }, [cameraFocus, closing]);

  // Start materialize-out when closing becomes true
  useEffect(() => {
    if (closing && closeStart.current === null) {
      closeStart.current = performance.now() / 1000;
    }
  }, [closing]);

  const probeVec = useRef(new THREE.Vector3());

  useFrame((state) => {
    const sg = scaleGroupRef.current;
    if (!sg) return;

    // Compute materialize scale
    let scale = cachedScale.current;
    if (closeStart.current !== null) {
      const t = Math.min(
        (state.clock.elapsedTime - closeStart.current) / MATERIALIZE_DURATION,
        1,
      );
      scale = cachedScale.current * (1 - easeOut(t));
    } else if (openStart.current !== null) {
      const t = Math.min(
        (state.clock.elapsedTime - openStart.current) / MATERIALIZE_DURATION,
        1,
      );
      scale = easeOut(t);
      cachedScale.current = scale;
    } else {
      scale = 0;
    }
    sg.scale.setScalar(scale);

    // NDC flip check — project anchor point
    const offsetX = flipped ? -OFFSET_X : OFFSET_X;
    probeVec.current.set(padX + offsetX, OFFSET_Y, padZ + OFFSET_Z);
    probeVec.current.project(camera);
    if (!flipped && probeVec.current.x > FLIP_NDC_HIGH) {
      setFlipped(true);
    } else if (flipped && probeVec.current.x < -FLIP_NDC_LOW) {
      setFlipped(false);
    }
  });

  const anchorX = padX + (flipped ? -OFFSET_X : OFFSET_X);

  return (
    <Billboard position={[anchorX, OFFSET_Y, padZ + OFFSET_Z]}>
      <group ref={scaleGroupRef} scale={0}>
        <group position={[0, BUTTON_SPACING * 1.5, 0]}>
          <PopupActionButton label="Complete" onClick={onComplete} color="#39ff14" />
        </group>
        <group position={[0, BUTTON_SPACING * 0.5, 0]}>
          <PopupActionButton label="Delete" onClick={onDelete} color="#ff10f0" />
        </group>
        <group position={[0, -BUTTON_SPACING * 0.5, 0]}>
          <PopupActionButton label="Set Color" onClick={onSetColor} color="#00eeff" />
        </group>
        <group position={[0, -BUTTON_SPACING * 1.5, 0]}>
          <PopupActionButton label="Group" onClick={onGroup} color="#ffd700" />
        </group>
      </group>
    </Billboard>
  );
}
