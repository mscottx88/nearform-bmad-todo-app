import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Firefly } from './creatures/Firefly';
import { WaterStrider } from './creatures/WaterStrider';

// Reuse the existing creature components for the two types currently
// implemented; fall back to <Firefly> for every other type so the visual
// plays even before the dedicated component lands (AC #3 fallback clause).

interface EmergingCreatureProps {
  creatureType: string;
  color: string;
  basePosition: [number, number, number];
  // R3F clock seconds when the emerge began. Supplied by the parent LilyPad,
  // which captures it on the first frame of the `completing` phase.
  startTime: number;
  duration?: number;
}

// Local easing. Duplicated from LilyPad to keep EmergingCreature standalone.
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function EmergingCreature({
  creatureType,
  color,
  basePosition,
  startTime,
  duration = 0.5,
}: EmergingCreatureProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Mark this subtree so LilyPad's dissolve `group.traverse` skips the
  // creature's materials (the emerge fade animates opacity independently).
  // Also set `material.transparent = true` once on mount instead of every
  // frame — toggling `transparent` per-frame without `needsUpdate` causes
  // shader recompiles and wrong depth sort.
  useEffect(() => {
    const group = groupRef.current;
    // In unit tests, R3F is mocked and `<group>` ends up as an HTMLUnknownElement
    // with no `userData` or `traverse` — feature-detect rather than hard-fail.
    if (!group || !('userData' in group) || typeof group.traverse !== 'function') return;
    group.userData.skipDissolve = true;
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) {
          for (const m of mat) m.transparent = true;
        } else {
          mat.transparent = true;
        }
      }
    });
  }, []);

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    const t = (state.clock.elapsedTime - startTime) / duration;

    if (t <= 0 || t >= 1) {
      // Before start or after finish — keep the group invisible. Parent
      // decides when to unmount; we just hide gracefully outside the window.
      group.visible = false;
      return;
    }
    group.visible = true;

    // Rise 0.6 units above the pad surface with ease-out.
    const rise = easeOut(t) * 0.6;
    group.position.set(basePosition[0], basePosition[1] + rise, basePosition[2]);

    // Opacity: fade in over first 30%, hold to 70%, fade out last 30%.
    let opacity: number;
    if (t < 0.3) opacity = t / 0.3;
    else if (t < 0.7) opacity = 1;
    else opacity = Math.max(0, 1 - (t - 0.7) / 0.3);
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) {
          for (const m of mat) m.opacity = opacity;
        } else {
          mat.opacity = opacity;
        }
      }
    });
  });

  // Render the base creature in its own position-coordinate frame; we only
  // translate the outer group, so base creature's own useFrame drift is
  // layered on top as usual. `firefly` + any unimplemented type falls back
  // to Firefly (AC #3 fallback clause). `asEmerging` disables the child's
  // self-drift / self-pulse so the parent's rise + fade aren't overwritten.
  return (
    <group ref={groupRef} position={basePosition}>
      {creatureType === 'water_strider' ? (
        <WaterStrider position={[0, 0, 0]} color={color} asEmerging />
      ) : (
        <Firefly position={[0, 0, 0]} color={color} asEmerging />
      )}
    </group>
  );
}
