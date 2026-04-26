/**
 * Story 6.7: the secondary view that paints the Oracle Frog into
 * the AgentPanel's "aquarium window" rectangle.
 *
 * Mounted INSIDE the main `<Canvas>` (via PondScene). Reads the
 * track-div DOM ref from `useOracleViewStore` — the panel publishes
 * its ref there on mount.
 *
 * ## Why this isn't drei `<View>`
 *
 * drei's `<View>` calls `gl.setViewport(rect)` to clip the secondary
 * render to the panel's bounding rect, but **its `finishSkissor`
 * does NOT restore the viewport** to full canvas. Worse, drei's
 * unmount cleanup ALSO calls `prepareSkissor(rect)` (to clear the
 * rect on tear-down) without restoring afterward. The end result:
 *
 *   - When the panel opens, frame N+1's `<EffectComposer>` runs
 *     `composer.render()`, which delegates to three.js's
 *     `renderer.setRenderTarget(null)` — three.js then re-applies
 *     the renderer's stored `_viewport` (which drei left as the
 *     panel rect). The main scene is rendered into the rect; the
 *     rest of the canvas stays black ("pond distorts").
 *   - When the panel closes, drei's cleanup re-leaks the viewport
 *     at unmount. The main render is permanently broken until
 *     a window resize re-calls `setSize` ("pond disappears").
 *
 * The minimal manual render below sets viewport+scissor, renders,
 * then **explicitly restores both** to full-canvas dimensions.
 * No leak, no drei dependency, no cleanup-order coupling.
 *
 * ## Mount lifecycle
 *
 * - When `trackRef` is null (panel closed), the component renders
 *   nothing — no portal, no useFrame. Auto-render of the main
 *   scene works as if this component didn't exist.
 * - When `trackRef` is set (panel open), we createPortal the
 *   secondary scene contents into a virtual `THREE.Scene`, register
 *   a `useFrame` at priority 2 (after `<EffectComposer>` at 1) that
 *   does the per-frame scissor render.
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAgentStore } from '../../stores/useAgentStore';
import { useOracleViewStore } from '../../stores/useOracleViewStore';
import { OracleFrog } from './OracleFrog';
import { OracleLilyPad, ORACLE_PAD_RADIUS } from './OracleLilyPad';

const ORACLE_HOME_FALLBACK = { x: -3.5, z: 3.5 };

const FROG_BASE_RADIUS = 0.45;
const FROG_PAD_FILL_RATIO = 0.85;

export function OracleAquariumView() {
  const trackRef = useOracleViewStore((s) => s.trackRef);
  if (trackRef === null) return null;
  return <ManualAquariumView track={trackRef} />;
}

interface InnerProps {
  track: HTMLDivElement;
}

function ManualAquariumView({ track }: InnerProps) {
  const persistedHome = useAgentStore((s) => s.oraclePadPosition);
  const home = persistedHome ?? ORACLE_HOME_FALLBACK;
  const { gl, size } = useThree();

  // Virtual scene + dedicated camera for the aquarium view. Both
  // are stable references (useState initialiser pattern) so they
  // don't churn on re-render.
  const [virtualScene] = useState(() => new THREE.Scene());
  const virtualCamera = useMemo(() => {
    // FOV 50° matches the main pond camera so the framing reads
    // consistently between views. Earlier 35° was too tight per
    // user feedback (2026-04-25): "the zoom in the oracle view box
    // is waaay too close — should see the whole frog and a portion
    // of its surroundings".
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    return cam;
  }, []);

  // Camera framing per AC 5: position offset above + back from the
  // pad, look at a point at pad-surface level. Pulled back to ~3.0
  // units in z and 1.5 in y (vs the earlier 1.2 / 0.6) so the
  // whole frog plus a margin of pond surface fits in the panel.
  useEffect(() => {
    virtualCamera.position.set(home.x, 1.5, home.z + 3.0);
    virtualCamera.lookAt(home.x, 0.05, home.z);
    virtualCamera.updateProjectionMatrix();
  }, [virtualCamera, home.x, home.z]);

  // Per-frame scissor render at priority 2. EffectComposer's render
  // at priority 1 has already finished by this point, so we paint
  // OVER the main scene only inside the panel's track rect.
  useFrame(() => {
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    // Convert DOM rect (top-left origin) to WebGL viewport (bottom-
    // left origin). The canvas's bounding rect tells us where the
    // canvas itself sits in the document — usually (0,0,vw,vh) but
    // not always.
    const canvas = gl.domElement.getBoundingClientRect();
    const left = rect.left - canvas.left;
    const top = rect.top - canvas.top;
    const width = rect.width;
    const height = rect.height;
    const bottom = canvas.height - top - height;

    // Update camera aspect to match the rect — otherwise the frog
    // would stretch when the panel resizes. Mutating a ref-held
    // Three.js camera + the renderer is the standard R3F animation
    // pattern; the lint rule is conservatively flagging mutation
    // of objects sourced from useThree, which is fine inside a
    // useFrame callback. Cast to mutable references to opt out.
    const camMutable = virtualCamera as THREE.PerspectiveCamera & {
      aspect: number;
    };
    if (camMutable.aspect !== width / height) {
      camMutable.aspect = width / height;
      camMutable.updateProjectionMatrix();
    }

    // ── Save renderer state ──
    const glMutable = gl as THREE.WebGLRenderer & { autoClear: boolean };
    const prevAutoClear = glMutable.autoClear;

    // ── Set up scissored secondary render ──
    glMutable.autoClear = false;
    glMutable.setViewport(left, bottom, width, height);
    glMutable.setScissor(left, bottom, width, height);
    glMutable.setScissorTest(true);

    // ── Render virtual scene into the rect ──
    glMutable.render(virtualScene, virtualCamera);

    // ── CRITICAL: restore renderer state to full canvas. drei's
    //    `<View>` skips this and that's the whole reason we hand-
    //    rolled this component. ──
    glMutable.setScissorTest(false);
    glMutable.autoClear = prevAutoClear;
    glMutable.setViewport(0, 0, size.width, size.height);
    glMutable.setScissor(0, 0, size.width, size.height);
  }, 2);

  // Reset on unmount too — when the panel closes, the LAST frame
  // before unmount already restored viewport (since the cleanup
  // happens after the frame), but if the unmount lands between
  // useFrame ticks we want to be safe. This effect's cleanup also
  // doubles as a belt-and-braces reset for any other component
  // (drei View, custom imperatives) that might leave the viewport
  // in a weird state.
  useEffect(() => {
    return () => {
      gl.setViewport(0, 0, size.width, size.height);
      gl.setScissor(0, 0, size.width, size.height);
      gl.setScissorTest(false);
      gl.autoClear = true;
    };
  }, [gl, size.width, size.height]);

  return (
    <>
      {createPortal(
        <SecondarySceneContents home={home} />,
        virtualScene,
      )}
    </>
  );
}

interface SceneProps {
  home: { x: number; z: number };
}

/**
 * Contents of the aquarium view's virtual scene. The camera lives
 * outside the JSX (built imperatively in ManualAquariumView via
 * `useMemo`) — drei's `<PerspectiveCamera makeDefault>` would try
 * to register itself with the parent's R3F state, which doesn't
 * apply inside a manual `gl.render` call.
 */
function SecondarySceneContents({ home }: SceneProps) {
  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight
        position={[home.x, 2, home.z + 0.5]}
        intensity={0.6}
        color="#00eeff"
      />
      <OracleLilyPad position={[home.x, 0, home.z]} />
      <group
        position={[home.x, 0.05, home.z]}
        scale={(FROG_PAD_FILL_RATIO * ORACLE_PAD_RADIUS) / FROG_BASE_RADIUS}
      >
        {/* Boost emissive — the secondary view doesn't get the
            main scene's <EffectComposer> bloom, so the frog reads
            brighter on its own. */}
        <OracleFrog emissiveScale={1.6} />
      </group>
    </>
  );
}
