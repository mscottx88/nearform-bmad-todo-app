/**
 * Story 6.7: the secondary drei `<View>` that paints the Oracle Frog
 * into the AgentPanel's "aquarium window" rectangle.
 *
 * This component lives INSIDE the main `<Canvas>` (rendered from
 * PondScene). It reads the track-div DOM ref from
 * `useOracleViewStore` — the panel publishes its ref there on mount
 * — so the camera viewport tracks the panel's oracle area each frame.
 *
 * Render-order note: drei `<View>` registers a `useFrame` at
 * `index=index` (default 1). `<EffectComposer>` also registers at
 * priority 1. To make the secondary view paint OVER the composer's
 * main-scene render rather than be clobbered, we explicitly pass
 * `index={2}` so the View's per-frame scissor render runs AFTER
 * the composer's main-scene render in the same frame.
 *
 * When the panel is closed, `trackRef` is null. We render nothing —
 * drei's CanvasView would otherwise no-op on a null ref but mounts
 * a useFrame at priority 1, which would still flip the auto-render
 * off. Skip the View entirely when there's no track.
 */

import { View, PerspectiveCamera } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useAgentStore } from '../../stores/useAgentStore';
import { useOracleViewStore } from '../../stores/useOracleViewStore';
import { OracleFrog } from './OracleFrog';
import { OracleLilyPad, ORACLE_PAD_RADIUS } from './OracleLilyPad';

const ORACLE_HOME_FALLBACK = { x: -3.5, z: 3.5 };

const FROG_BASE_RADIUS = 0.45;
const FROG_PAD_FILL_RATIO = 0.85;

export function OracleAquariumView() {
  const trackRef = useOracleViewStore((s) => s.trackRef);
  const persistedHome = useAgentStore((s) => s.oraclePadPosition);
  const home = persistedHome ?? ORACLE_HOME_FALLBACK;

  // Skip rendering entirely when there's no track — see file header
  // for why null tracks are gated rather than passed through.
  if (trackRef === null) return null;

  // drei View accepts an HTMLElement track ref. We hold a real
  // HTMLDivElement in the store; wrap it in a `{ current: el }`
  // shape that React treats as a ref so drei's per-frame
  // `track.current?.getBoundingClientRect()` reads work.
  return (
    <>
      <View
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        track={{ current: trackRef } as any}
        // index higher than EffectComposer's renderPriority (1) so we
        // paint AFTER the composer's main render in the same frame.
        index={2}
      >
        <SecondarySceneContents home={home} />
      </View>
      {/* Critical: restore the WebGL viewport AFTER drei's View
          finishes its scissor render. drei's prepareSkissor sets
          `gl.setViewport(left, bottom, width, height)` to constrain
          the secondary view's render to the panel's track rect, but
          the matching `finishSkissor` ONLY restores
          `setScissorTest(false)` and `autoClear` — it does NOT
          reset the viewport. Without this restore, the next frame's
          EffectComposer renders the entire main scene into the
          *previous frame's secondary-view rect* (i.e., a small
          rectangle inside the agent panel), and the rest of the
          canvas stays black ("lost the pond"). Run at index 3 so
          this fires AFTER the secondary view's index 2. */}
      <ViewportReset />
    </>
  );
}

function ViewportReset() {
  const { gl, size } = useThree();
  useFrame(() => {
    // Reset to the full canvas viewport so the NEXT frame's main
    // scene (rendered by <EffectComposer> at priority 1) draws
    // across the full canvas area, not a leftover rect.
    gl.setViewport(0, 0, size.width, size.height);
    gl.setScissor(0, 0, size.width, size.height);
    gl.setScissorTest(false);
  }, 3);
  return null;
}

interface SceneProps {
  home: { x: number; z: number };
}

/**
 * Scene contents for the aquarium window — its own camera + lights
 * + a duplicate of the oracle pad/frog meshes. Both views read
 * `agentState` from the same store so the duplicate animates in
 * lockstep with the main-scene frog.
 */
function SecondarySceneContents({ home }: SceneProps) {
  // Camera framing per AC 5: position offset above + in front of
  // the pad, looking at a point slightly above the pad's surface so
  // the frog reads centred. FOV 35° is narrower than the main
  // camera's 50° so the frog reads close in the panel rect.
  const cameraPos: [number, number, number] = [home.x, 0.6, home.z + 1.2];
  const cameraTarget: [number, number, number] = [home.x, 0.1, home.z];

  // Drei's PerspectiveCamera doesn't take a lookAt prop; we orient
  // it imperatively via a one-shot effect on the rendered camera.
  const cameraReady = useCameraLookAt(cameraTarget);

  return (
    <>
      <PerspectiveCamera
        makeDefault
        fov={35}
        position={cameraPos}
        ref={cameraReady}
      />
      {/* Lights dedicated to the aquarium — slightly cooler tone
          than the main scene's pond ambient so the frog reads as
          framed by its own lighting, not "tinted by the pond". */}
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
        {/* Boost emissive a bit — the secondary view doesn't get
            the main scene's <EffectComposer> bloom, so the frog's
            material needs to read brighter on its own. */}
        <OracleFrog emissiveScale={1.6} />
      </group>
    </>
  );
}

/**
 * Wires a one-shot lookAt + projection-matrix update onto the
 * PerspectiveCamera ref drei renders. Returned as a ref-callback
 * so drei calls it the moment the camera mounts.
 */
function useCameraLookAt(target: [number, number, number]) {
  const targetRef = { current: target };
  // Memoise via useEffect-shape: drei applies the ref once on
  // mount; the camera doesn't move during a session today, so we
  // only need to lookAt once. If the home position ever changes
  // mid-session (story 6.7 v1 doesn't expose that affordance), the
  // outer SecondarySceneContents re-mounts via a key change and
  // this runs again.
  return (cam: unknown) => {
    if (cam !== null && typeof cam === 'object' && 'lookAt' in cam) {
      const c = cam as {
        lookAt: (x: number, y: number, z: number) => void;
        updateProjectionMatrix: () => void;
      };
      c.lookAt(targetRef.current[0], targetRef.current[1], targetRef.current[2]);
      c.updateProjectionMatrix();
    }
  };
}

