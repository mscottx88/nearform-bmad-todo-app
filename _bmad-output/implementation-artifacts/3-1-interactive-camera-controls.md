# Story 3.1: Interactive Camera Controls

Status: done

> **Scope note:** First story of Epic 3 "Exploring the Pond". Fulfils PRD FR30 (orbit/zoom/pan) and FR31 (camera reset to default — trigger changed from epics.md's "double-click empty water" to **double-Escape** per Dev Notes rationale). **Partially wired** in [frontend/src/components/pond/PondCamera.tsx](frontend/src/components/pond/PondCamera.tsx) from Story 1.2 — damping, min/max zoom, polar-angle constraint, LEFT=pan, RIGHT=orbit are present but **pan is broken** (screen-space instead of ground-plane, so forward/back mouse-drag doesn't work). Net-new work:
> 1. Fix LMB pan to ground-plane (`screenSpacePanning={false}`) so drag-up = forward (AC #2).
> 2. Retire the orphaned single-click-water-lerp ("click-to-centre") that currently stands in for forward motion (AC #2, Dev Notes).
> 3. MMB-drag ascend/descend — the fourth DOF, with a camera.y floor so the camera never goes underwater (AC #8).
> 4. Frame-level camera.y hard-floor as defense-in-depth against any future interaction that could submerge the view (AC #9).
> 5. **Escape-Escape** (two Escape keypresses within 600 ms) → smooth reset to a **dynamically-computed fit-to-pads framing** (AC #4): the camera lands on the pad-cluster centroid at a distance that fits the bounding box with a 30 % margin, falling back to the hard-coded default framing `(0, 15, 20)` → `(0, 0, 0)` only when the pond is empty or no pad has a resolved position. Reuses the centroid + bbox-diagonal math originally authored for Story 5.3's search auto-frame and removed at commit `f4088d3` (history + rationale in Dev Notes). Supersedes the original epics.md "double-click empty water" trigger — decision rationale in Dev Notes.
> 6. Test coverage for the whole config + all new behaviours (AC #7).
>
> **Do NOT rewrite the existing OrbitControls setup** — amend the props, add the MMB handler, add the reset, add the floor, add tests.
>
> **Atmosphere-mode camera tuning** (faster damping in cyberpunk, slower drift in zen) is explicitly **Story 3.2**, not this story. **Shift+LMB click and Shift+LMB drag** are reserved for Epic 4.2 group selection — see Dev Notes; do NOT claim those bindings here.

## Frontend conventions (recap)

- **State**: UI + imperative-handle state lives in [`usePondStore`](frontend/src/stores/usePondStore.ts) (Zustand). Pattern for "imperative-ish" camera actions is already established: `cameraFocus` is set via `focusCamera(x, z, zoom?)` and consumed by `PondCamera.useFrame` which lerps camera + target toward it each frame, then nulls the focus when arrived. Follow the same pattern for reset (separate slice — do NOT reuse `cameraFocus`; see Dev Notes).
- **R3F camera**: the `Canvas` in [PondScene.tsx](frontend/src/components/pond/PondScene.tsx) initialises `camera={{ fov: 50, near: 0.1, far: 200, position: [0, 15, 20] }}`. The default OrbitControls target is the world origin `(0, 0, 0)`. These two triples are the authoritative **"reset defaults"** and must be hoisted to named module-scope constants in `PondCamera.tsx` so the reset animation and a future test both reference the same source of truth.
- **Three.js lib**: `OrbitControls` is imported from `@react-three/drei` (re-exports `three-stdlib`). `THREE.MOUSE.PAN` / `THREE.MOUSE.ROTATE` drive the mouse-button mapping. **Do not swap to a different controls impl** (e.g., MapControls, TrackballControls) — the existing constraints (`maxPolarAngle`) and focus-lerp math depend on OrbitControls semantics.
- **Frame budget**: `PondCamera.useFrame` already runs every tick to drive `controls.update()` (required for damping). The reset animation adds at most one more lerp branch to the same tick — O(1) cost. No new per-frame allocations: reuse pre-allocated `THREE.Vector3` temporaries at module scope, matching the existing `targetVec.current` pattern.
- **Testing**: follow the mock pattern in [PondScene.test.tsx](frontend/src/components/pond/PondScene.test.tsx) — stub `@react-three/fiber` `Canvas`/`useFrame`/`useThree`, stub `@react-three/drei` `OrbitControls` as `null`. A new co-located `PondCamera.test.tsx` is the right home for camera-specific tests. Keep 3D rendering itself out of scope — test the config props, store actions, and event wiring.

## Story

As a user,
I want to orbit, zoom, pan, and ascend/descend the camera to explore the pond from any angle, and snap back to the default framing with a double-Escape,
So that I can navigate my pond spatially, recover from exploration, and never feel lost or underwater.

## Acceptance Criteria

1. **Given** the pond is loaded and no interaction is in flight, **When** I scroll the mouse wheel on the canvas, **Then** the camera distance from its `OrbitControls` target changes smoothly with eased damping (not instant). **And** distance is bounded: `minDistance = 5` and `maxDistance = 60` world units. Further scroll attempts at either extreme are no-ops at the Three.js level (OrbitControls clamps internally); no visible jitter. `zoomToCursor` stays enabled so the zoom pivots toward the cursor, not the current target.

2. **Given** the pond is loaded and no popup is open, **When** I press-and-drag the **left** mouse button across the canvas (movement > 5 px between `pointerdown` and `pointerup`), **Then** the camera **pans across the horizontal ground plane**: dragging **up** = forward (pond slides toward the viewer), **down** = back, **left/right** = strafe. OrbitControls translates both the target and the camera position parallel to the **XZ plane** — NOT parallel to the screen. This requires setting `screenSpacePanning = false` on `<OrbitControls>`; with the default `true`, pan is screen-parallel, which on our tilted view turns up-drag into "move camera upward in world space" instead of "move forward across the pond" (the bug you just hit). The pan tracks the cursor for the full drag duration (not a jump on release). Panning does NOT change camera distance or pitch. Mouse button mapping on `<OrbitControls>`: `LEFT = THREE.MOUSE.PAN`, `RIGHT = THREE.MOUSE.ROTATE`, and `MIDDLE` omitted entirely so drei passes `undefined` — OrbitControls' internal pointerdown switch then treats MMB as no-op, leaving it free for our ascend/descend handler (AC #8). Note: with ground-plane panning, pan-distance-per-pixel scales with camera height — a zoomed-out view pans fast, a close-up pans slow. That's the intended "consistent world-space travel per mouse drag" behaviour and is NOT a bug.

3. **Given** the pond is loaded, **When** I press-and-drag the **right** mouse button across the canvas (or modifier-drag if the platform routes right-click to a context menu — see Dev Notes), **Then** the camera **orbits** around the `OrbitControls` target with smooth damping. Orbit is constrained by `maxPolarAngle = Math.PI / 2.2` (≈ 81.8°) so the camera **cannot tilt low enough to see underwater** — at the lower polar limit the camera is still tilted downward toward the water plane, never level with or below it. `minPolarAngle` is left at the OrbitControls default of `0` so the user can orbit up to a full top-down bird's-eye view if they want. Azimuth (horizontal orbit) is unconstrained — full 360°. This is **one of three layered underwater-prevention mechanisms**; the others are the MMB-descend clamp (AC #8) and the frame-level hard floor (AC #9).

4. **Given** the pond is loaded, **When** the user presses **Escape twice within 600 ms** (`ESC_DOUBLE_WINDOW_MS = 600`), **Then** the camera smoothly returns to a **fit-to-pads framing** computed at dispatch time: compute the centroid `(cx, cz)` and axis-aligned bounding-box diagonal `d = hypot(maxX − minX, maxZ − minZ)` over every live todo that has a non-null `positionX` and `positionY` (the schema stores world-Z as `positionY`). The camera distance is `D = clamp(d · RESET_BBOX_PADDING, RESET_MIN_DISTANCE, RESET_MAX_DISTANCE)` with `RESET_BBOX_PADDING = 1.3` (30 % margin so edge pads don't flush with the viewport), `RESET_MIN_DISTANCE = 15` (single-pad or tiny-cluster case — don't zoom uncomfortably close), `RESET_MAX_DISTANCE = 60` (matches OrbitControls `maxDistance`). The camera pose preserves the default pitch and azimuth: `RESET_POLAR_ANGLE = Math.atan2(20, 15)` (≈ 53.13° — the polar angle of the default `(0, 15, 20)` → origin offset, so reset "looks like home" pitch), azimuth locked to look in the −Z direction. Target lands at `(cx, 0, cz)`; camera lands at `(cx, D · cos(polar), cz + D · sin(polar))`. The transition completes in the **300–500 ms** range (the existing `LERP_SPEED = 0.05` at 60 fps decays to <1% remaining in ~333 ms, which satisfies the spec — reuse it). The animation is cancellable by wheel / pointerdown / MMB-drag mid-flight, following the same `cancelAnimation()` path that already protects the pad-focus lerp.

   **Fallback — empty pond**: if zero todos have resolved positions (empty pond, loading state, all positions null), the fit falls back to `(position: (0, 15, 20), target: (0, 0, 0))` — the hard-coded default framing. A fresh user seeing an empty pond after ESC ESC still gets a sensible camera pose.

   **Fit is recomputed on every dispatch**: the hook reads the latest todos from React Query's cache (`queryClient.getQueryData(['todos', 'list'])`) at the moment the double-Escape fires — no stale closure, no reactive memo. If the user orbits around, then drops three new pads, then ESC ESCs, the framing reflects all pads including the just-dropped ones.

   **`cameraResetRequest` payload is the single signal**: `requestCameraReset(fit)` atomically sets `pendingCameraFit = fit` and bumps `cameraResetRequestId`. PondCamera reads both on counter change, starts the lerp toward the stored fit. When arrival completes, PondCamera clears `pendingCameraFit` via a `clearCameraResetRequest()` action.

   **Double-Escape semantics (important nuance):** the handler does NOT alter the existing single-Escape behaviours. Story 2.3 / 2.5 / 2.6 + [useClosePopupOnEscape](frontend/src/hooks/useClosePopupOnEscape.ts) already close the popup on Escape. Story 5.3 / [usePondSearchKeyboard](frontend/src/hooks/usePondSearchKeyboard.ts) already clears the search on Escape. Both of those hooks keep firing unchanged. The new hook is **additive**: it only tracks timestamps and requests a camera reset when two Escapes fall within the 600 ms window. Concrete scenarios: (a) popup open + ESC ESC rapid → first ESC closes popup (existing), second ESC triggers reset (new); the popup-close + camera-reset combo reads as "back to neutral" and is intentional. (b) search active + ESC ESC rapid → first ESC clears search (existing), second ESC triggers reset (new); same "back to neutral" read. (c) nothing open + ESC ESC rapid → first ESC is a no-op, second ESC triggers reset. (d) a lone single ESC → fires whatever existing Escape path applies, does NOT trigger reset (until another ESC lands within 600 ms).

   **Input guard:** Escape keydowns originating inside a focused `<input>`, `<textarea>`, or `contenteditable` element are **ignored** for the double-tap tracking — matches the guard in [useClosePopupOnEscape](frontend/src/hooks/useClosePopupOnEscape.ts). If the user is mid-typing in TodoInput, two Escapes should not trigger a camera reset on top of the input's own Escape handler.

   **Consume-on-trigger:** after firing `requestCameraReset`, the timestamp is cleared so a third rapid Escape doesn't immediately trigger a second reset. A fourth Escape within the window of the third starts a fresh double-tap cycle.

5. **Given** any of the above interactions is in flight, **When** `useFrame` runs, **Then** all transitions have smooth damping via `enableDamping = true`, `dampingFactor = 0.05`. `controls.update()` is called **every tick** (even when no programmatic lerp is active) so OrbitControls' internal spherical-coord damping keeps working across user input. This is already the case in the existing `useFrame` — do not regress it.

6. **Given** the browser window is resized (user drags the window edge, rotates the screen, or the system triggers a resize event), **When** the resize completes, **Then** the camera framing adapts: aspect ratio updates, the `OrbitControls` target stays at the same world-space point (user keeps their mental "where I was looking"), and no pads visibly jump. R3F's `Canvas` handles `camera.aspect` + `renderer.setSize` automatically on its `ResizeObserver`; this AC is a **verify-and-don't-regress** gate — no new code needed unless a live test reveals a bug. Confirmed in the architecture doc ("OrbitControls automatically adapt to container changes" — architecture.md:1100).

7. **Given** the existing vitest suite and this story's new tests, **When** the suite runs, **Then** (a) all existing tests stay green, AND (b) new tests cover:
   - **`OrbitControls` config props** (`PondCamera.test.tsx`, AC #1/#2/#3/#5): min/max distance, maxPolarAngle (and `minPolarAngle` unset so the default of 0 is preserved — confirms the bird's-eye up-limit), enableDamping + factor, enablePan, zoomToCursor, `screenSpacePanning=false`, mouseButtons map with `MIDDLE` omitted (drei passes `undefined` → OrbitControls no-ops MMB).
   - **`fitCameraToPads` pure helper** (`fitCameraToPads.test.ts`, AC #4): empty input → default fit `(0,15,20)/(0,0,0)`; single pad at origin → centroid at origin with distance clamped to `RESET_MIN_DISTANCE`; two pads at `(−5, 0, −5)` and `(5, 0, 5)` → centroid at origin, distance = `clamp(hypot(10,10) · 1.3, 15, 60)` ≈ 18.4, pose preserves polar angle (`cy/D ≈ 0.6`); dispersed cluster with `d · 1.3 > 60` clamps at `RESET_MAX_DISTANCE`; mixed list with some `positionX=null` filters them out of the computation.
   - **`requestCameraReset` store action** (`usePondStore.test.ts`, AC #4): flips `cameraResetRequestId` and sets `pendingCameraFit` atomically; does NOT touch `cameraFocus`; `clearCameraResetRequest` nulls `pendingCameraFit` without resetting the counter.
   - **`useCameraResetOnDoubleEscape` hook** (`useCameraResetOnDoubleEscape.test.ts`, AC #4): two Escape keydowns within 600 ms dispatch `requestCameraReset` with the current React Query todos → computed fit; two Escape keydowns > 600 ms apart do NOT dispatch; Escape keydowns with an `<input>` / `<textarea>` / contenteditable target are ignored; consume-on-trigger — three rapid Escapes fire exactly one reset, not two.
   - **Reset lerp + animation lifecycle** (`PondCamera.test.tsx`, AC #4): with a seeded `pendingCameraFit`, N synthetic `useFrame` ticks drive `camera.position` and `controls.target` to the fit within the arrive threshold; on arrival, `pendingCameraFit` is cleared via `clearCameraResetRequest`; wheel / pointerdown mid-reset cancels the animation (no further camera mutations on subsequent ticks, `pendingCameraFit` is also cleared since the user decided where to go instead).
   - **Click-to-centre retirement** (`PondCamera.test.tsx`, AC #2): a synthetic LMB click-no-drag on empty water with no popup open does NOT mutate the camera. With `activePopupTodoId='foo'` set, the same click calls `closePopup` (preserved popup-close path).
   - **MMB-drag** (`PondCamera.test.tsx`, AC #8): MMB-drag translates both `camera.position.y` and `controls.target.y` by the same signed delta = `-dy · MMB_ASCEND_SENSITIVITY`; MMB-descend clamps at `CAMERA_MIN_Y` and cannot push camera underwater; starting MMB-drag during a reset cancels the reset.
   - **Frame-level floor** (`PondCamera.test.tsx`, AC #9): setting `camera.position.y = -2` and running one `useFrame` tick clamps `camera.position.y` to `CAMERA_MIN_Y`; `controls.target.y` is NOT clamped.

8. **Given** the pond is loaded and no popup is open, **When** I press-and-drag the **middle** mouse button across the canvas, **Then** the camera **ascends/descends** on the world Y-axis: drag **up** (decreasing `clientY`) = ascend (both `camera.position.y` and `controls.target.y` increase by the same delta — rigid-body translate, so pitch is preserved); drag **down** = descend. The translate applies while the pointer moves (not on release) with sensitivity `MMB_ASCEND_SENSITIVITY ≈ 0.03` world units per pixel — tune in browser. **The camera may NEVER go underwater**: `camera.position.y` is clamped at `CAMERA_MIN_Y = 0.5` (above the water plane's `y=0` with a visible margin). When a descend delta would push camera.y below the floor, the delta is truncated to `CAMERA_MIN_Y - camera.position.y` and BOTH `camera.position.y` and `controls.target.y` are advanced by the truncated amount (preserves rigid-body; target.y may end up slightly negative if camera is at floor — that's fine and not user-visible since the camera is still above water). OrbitControls' MMB action must be **disabled** (`mouseButtons.MIDDLE = -1`) so OrbitControls doesn't also pan on MMB-drag. On `pointerdown` with `e.button === 1`, cancel any in-flight reset/focus animation (same `cancelAnimation()` path as LMB/wheel) and `e.preventDefault()` to suppress the browser's native MMB auto-scroll affordance. On `pointerup` or `pointercancel` with `e.button === 1`, end the drag. **Trackpad users** (no MMB) lose this one DOF — keyboard fallback is deferred work, noted in Dev Notes.

9. **Given** any interaction or programmatic path that mutates `camera.position.y` (orbit, zoom, MMB-descend, reset lerp, focus lerp, or future atmosphere-driven camera changes), **When** `useFrame` runs each tick, **Then** immediately before `controls.update()` a hard-floor clamp enforces `camera.position.y = max(camera.position.y, CAMERA_MIN_Y)`. This is **defense-in-depth**: the individual interaction paths each do their own clamping (orbit via `maxPolarAngle`, MMB-descend via AC #8's delta-truncation, zoom/reset via their target defaults sitting above `CAMERA_MIN_Y`), so this frame-level clamp should be a no-op in steady state. If it ever fires (camera.y below floor at frame start), a future bug or new interaction has leaked through — the clamp prevents the user from seeing an underwater frame while the dev investigates. Do NOT also clamp `controls.target.y` at the frame level — the target can be at or below the water plane for a descended camera without producing an underwater view.

## Tasks / Subtasks

- [x] Task 1: Hoist default-camera constants (AC: #4, #7, #8, #9)
  - [x] In [PondCamera.tsx](frontend/src/components/pond/PondCamera.tsx), add module-scope constants near the existing `LERP_SPEED` block:
    ```ts
    const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 15, 20);
    const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 0, 0);
    const RESET_ARRIVE_THRESHOLD = 0.05;
    const CAMERA_MIN_Y = 0.5;
    const MMB_ASCEND_SENSITIVITY = 0.03;
    ```
    `DEFAULT_CAMERA_POSITION` **must** match the `<Canvas camera={{ position: [0, 15, 20] }}>` values in `PondScene.tsx`. If you change one, change the other — add a comment on both sides noting the pairing. These constants also define the empty-pond fallback for `fitCameraToPads` (Task 1d) — export both as named constants so the helper can reference them by name.

- [x] Task 1d: Extract `fitCameraToPads` helper + tests (AC: #4, #7)
  - [x] Create [frontend/src/components/pond/fitCameraToPads.ts](frontend/src/components/pond/fitCameraToPads.ts):
    ```ts
    import type { Todo } from '../../types';
    import { DEFAULT_CAMERA_POSITION, DEFAULT_CAMERA_TARGET } from './PondCamera';

    export const RESET_BBOX_PADDING = 1.3;
    export const RESET_MIN_DISTANCE = 15;
    export const RESET_MAX_DISTANCE = 60; // matches OrbitControls.maxDistance
    // The polar angle of the default (0,15,20) → origin offset. Preserves
    // the "looks like home" pitch when framing a non-origin cluster.
    export const RESET_POLAR_ANGLE = Math.atan2(20, 15); // ≈ 53.13°

    export interface CameraFit {
      /** World-space camera position as [x, y, z]. */
      position: [number, number, number];
      /** OrbitControls target as [x, y, z]. */
      target: [number, number, number];
    }

    /**
     * Compute a camera pose that frames every positioned pad with a margin.
     * Falls back to the hard-coded default framing when the pond is empty
     * or no pad has a resolved position (e.g. initial load, all positions
     * still null).
     *
     * - Schema note: `Todo.positionY` stores world-space Z, not Y. The
     *   water plane is at y=0, so the target always lands on the plane.
     * - Pitch and azimuth are fixed to the default pose; only the
     *   centroid and distance adapt to the pad cluster.
     *
     * Pure function — safe to call every dispatch without side effects.
     * Recognizes the original logic removed from `usePondSearchSync.ts`
     * at commit f4088d3; reinstated here for the reset path per the
     * 3.1 spec.
     */
    export function fitCameraToPads(todos: readonly Todo[]): CameraFit {
      const positioned: Array<{ x: number; z: number }> = [];
      for (const t of todos) {
        if (t.positionX != null && t.positionY != null) {
          positioned.push({ x: t.positionX, z: t.positionY });
        }
      }
      if (positioned.length === 0) {
        return {
          position: [
            DEFAULT_CAMERA_POSITION.x,
            DEFAULT_CAMERA_POSITION.y,
            DEFAULT_CAMERA_POSITION.z,
          ],
          target: [
            DEFAULT_CAMERA_TARGET.x,
            DEFAULT_CAMERA_TARGET.y,
            DEFAULT_CAMERA_TARGET.z,
          ],
        };
      }
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      let sumX = 0, sumZ = 0;
      for (const p of positioned) {
        sumX += p.x;
        sumZ += p.z;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
      }
      const cx = sumX / positioned.length;
      const cz = sumZ / positioned.length;
      const diagonal = Math.hypot(maxX - minX, maxZ - minZ);
      const distance = Math.max(
        RESET_MIN_DISTANCE,
        Math.min(RESET_MAX_DISTANCE, diagonal * RESET_BBOX_PADDING),
      );
      const cy = distance * Math.cos(RESET_POLAR_ANGLE);
      const offsetZ = distance * Math.sin(RESET_POLAR_ANGLE);
      return {
        position: [cx, cy, cz + offsetZ],
        target: [cx, 0, cz],
      };
    }
    ```
  - [x] Why tuples `[number, number, number]` rather than `THREE.Vector3`: the fit lives in the Zustand store where Vector3 instances with mutable state would be a footgun (equality checks, serialization for devtools, test snapshots). Convert to Vector3 at consumption in `PondCamera.useFrame` via `vec.fromArray(fit.position)` on pre-allocated module-scope Vector3 instances — no per-frame allocation.
  - [x] Create [frontend/src/components/pond/fitCameraToPads.test.ts](frontend/src/components/pond/fitCameraToPads.test.ts) with the test cases enumerated in AC #7 (empty, single, two-pad, max-clamp, null-filter). Plain unit tests — no React, no Canvas, no mocks needed beyond a minimal `Todo`-shaped factory.

- [x] Task 1b: Ground-plane pan + retire click-to-centre (AC: #2)
  - [x] Add `screenSpacePanning={false}` to the `<OrbitControls>` element. With the default `true`, LMB-drag translates parallel to the screen — on our tilted view, up-drag mostly moves the camera upward in world space, not forward across the pond. Flipping this to `false` makes pan stay parallel to the XZ plane so drag up = forward, drag down = back, drag left/right = strafe.
  - [x] Update the `mouseButtons` prop on `<OrbitControls>`:
    ```ts
    mouseButtons={{
      LEFT: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
      // MIDDLE intentionally omitted — MMB is handled by our own listener
      // for ascend/descend (AC #8).
    }}
    ```
    drei's `mouseButtons` is `Partial<{ LEFT; MIDDLE; RIGHT }>`, so omitting `MIDDLE` leaves it `undefined`. OrbitControls' internal `onPointerDown` switch treats an `undefined` button as no-op (falls through to `STATE.NONE`), leaving MMB free for our handler. Earlier drafts of this story specified a sentinel value like `-1`; that works at runtime but isn't what ships — the implementation omits `MIDDLE` entirely, matching drei's type shape.
  - [x] Retire the single-click-water-lerp in [handlePointerUp](frontend/src/components/pond/PondCamera.tsx#L40-L68). Concretely, remove the two lines `targetVec.current.copy(hit); animating.current = true;`. Preserve every other branch — the popup-close path (`if (activePopupTodoId !== null) { closePopup(); return; }`) stays exactly as it is (that's the click-outside-to-dismiss contract for the action popup and is relied on by Story 2.3). This is a deliberate behaviour retirement, not a refactor — do NOT simplify any other code in the handler.
  - [x] `targetVec` and `animating` refs STAY in the file — they're still used by the `cameraFocus` branch in `useFrame` (pad-focus zoom) and will be used by the reset animation (Task 3). The retirement only removes their one use in `handlePointerUp`.
  - [ ] Browser-verify (DEFERRED to reviewer — dev ran in headless environment; unit tests cover the code paths):
    - LMB-click-drag up on empty water → camera slides forward across the pond (target moves away from viewer on the XZ plane). Drag down → back. Drag sideways → strafe.
    - LMB-click with no drag on empty water → no camera motion, no popup opens, nothing happens.
    - Click a pad → existing pad-focus / popup-open flow still works (that path is driven by `cameraFocus`, not this handler).
    - Open popup, click outside on water → popup closes (that branch is preserved).

- [x] Task 1c: MMB-drag ascend/descend (AC: #8)
  - [x] Add a `mmbDragPrevY` ref (`useRef<number | null>(null)`) alongside the existing `clickStart` ref. `null` = not currently dragging; a number = last observed `e.clientY`.
  - [x] Extend `handlePointerDown`:
    ```ts
    if (e.button === 1) {
      mmbDragPrevY.current = e.clientY;
      e.preventDefault(); // suppress browser auto-scroll on MMB
      if (animating.current) cancelAnimation();
      return;
    }
    ```
    The `preventDefault` and `button === 1` check must come BEFORE the existing `button === 0` branch — MMB has its own path.
  - [x] Add a new `handlePointerMove(e: PointerEvent)` listener:
    ```ts
    const handlePointerMove = useCallback((e: PointerEvent) => {
      if (mmbDragPrevY.current === null || !controlsRef.current) return;
      const dy = e.clientY - mmbDragPrevY.current;
      mmbDragPrevY.current = e.clientY;
      // drag UP on screen (dy < 0) → ascend (delta > 0)
      let delta = -dy * MMB_ASCEND_SENSITIVITY;
      // Clamp descend so camera.y stays >= CAMERA_MIN_Y
      const proposedY = camera.position.y + delta;
      if (proposedY < CAMERA_MIN_Y) {
        delta = CAMERA_MIN_Y - camera.position.y;
      }
      camera.position.y += delta;
      controlsRef.current.target.y += delta; // rigid-body — preserve pitch
    }, [camera]);
    ```
  - [x] Extend `handlePointerUp`:
    ```ts
    if (e.button === 1) {
      mmbDragPrevY.current = null;
      return;
    }
    ```
    Also handle `pointercancel` the same way (register a `pointercancel` listener or unify on `pointerleave`). The `pointermove` listener should be registered on the `window`, not the canvas, so a drag that exits the canvas bounds still updates — matches how OrbitControls itself tracks drags.
  - [x] Register the new listeners inside the existing `useEffect` that manages canvas listeners. `pointermove` and `pointercancel` go on `window`; keep `pointerdown`/`pointerup`/`wheel` on `gl.domElement`. (No `dblclick` listener needed — reset is keyboard-driven via Task 4's hook.) Remember to clean up all of them in the returned unmount function.
  - [x] Do NOT try to generalise with a pointer-capture API (`setPointerCapture`) — it's overkill for this scope and complicates testing.

- [x] Task 2: Add reset slices + actions to `usePondStore` (AC: #4, #7)
  - [x] Import the `CameraFit` type from `fitCameraToPads.ts`.
  - [x] New state slices:
    - `cameraResetRequestId: number` initialised to `0` — monotonically-increasing counter. The value itself is meaningless; only a **change** is the signal. Counter pattern (rather than a boolean flag) is deliberate: two back-to-back reset requests (e.g., ESC ESC, then some input, then ESC ESC again) must both fire fresh animations; a boolean would coalesce on the second. Matches the "fresh-object-ref" pattern used elsewhere in the store for imperative signals.
    - `pendingCameraFit: CameraFit | null` initialised to `null` — payload consumed by `PondCamera.useFrame` on counter-bump.
  - [x] New actions:
    ```ts
    requestCameraReset: (fit: CameraFit) => void;
    clearCameraResetRequest: () => void;

    // implementations:
    requestCameraReset: (fit) =>
      set((state) => ({
        cameraResetRequestId: state.cameraResetRequestId + 1,
        pendingCameraFit: fit,
      })),
    clearCameraResetRequest: () =>
      set({ pendingCameraFit: null }),
    ```
    `clearCameraResetRequest` does NOT decrement the counter — only the payload is nulled. The counter keeps its current value so a subsequent request is still seen as "fresh" by PondCamera's ref-compare.
  - [x] `requestCameraReset` does **NOT** touch `cameraFocus` — closing any in-flight popup-focus lerp is PondCamera's responsibility (see Task 3 consumption order).
  - [x] Do not expose a selector for the counter — `PondCamera` reads it imperatively via `usePondStore.getState()` inside its `useFrame`, comparing against a local ref, to avoid a re-render per counter bump.

- [x] Task 3: Drive the reset animation in `PondCamera.useFrame` (AC: #4, #5, #9)
  - [x] Add refs:
    - `resetAnimating: useRef(false)`
    - `lastResetRequestId: useRef(usePondStore.getState().cameraResetRequestId)` — seed to the current value at mount so a pre-mount counter bump doesn't retroactively fire on first frame.
    - Two pre-allocated module-scope `THREE.Vector3` temporaries: `resetTargetPos` and `resetTargetTarget`. Do not allocate per frame.
  - [x] **Top of each `useFrame`** (in this order):
    1. **Floor clamp** (AC #9): `if (camera.position.y < CAMERA_MIN_Y) camera.position.y = CAMERA_MIN_Y;`. Do NOT clamp `controls.target.y`.
    2. **Detect new reset request**: read `{ cameraResetRequestId, pendingCameraFit }` from the store imperatively. If `cameraResetRequestId !== lastResetRequestId.current` AND `pendingCameraFit !== null`:
       - `lastResetRequestId.current = cameraResetRequestId`
       - `resetAnimating.current = true`
       - `resetTargetPos.fromArray(pendingCameraFit.position)`; `resetTargetTarget.fromArray(pendingCameraFit.target)`
       - Null `cameraFocus` in the store (`usePondStore.setState({ cameraFocus: null })`) so an in-flight popup-focus lerp stops competing for the camera.
  - [x] **Branch order inside `useFrame`** (preserves existing behaviour + adds reset):
    1. If `resetAnimating.current`: lerp `camera.position` toward `resetTargetPos` at `LERP_SPEED` and `controls.target` toward `resetTargetTarget` at `LERP_SPEED`; `controls.update()`. When both `camera.position.distanceTo(resetTargetPos) < RESET_ARRIVE_THRESHOLD` AND `controls.target.distanceTo(resetTargetTarget) < RESET_ARRIVE_THRESHOLD`, snap to exact targets, set `resetAnimating.current = false`, and call `usePondStore.getState().clearCameraResetRequest()` to null `pendingCameraFit` for cleanliness. **Return early** — do not also run the `cameraFocus` branch in the same tick.
    2. Else if `cameraFocus`: existing focus-lerp branch (unchanged).
    3. Else: existing `controls.update()`-only branch (unchanged — damping keeps the last user input easing out).
  - [x] Extend the existing `cancelAnimation()` helper to also clear `resetAnimating.current` AND call `clearCameraResetRequest()` (the user decided where to go instead, so don't leave a stale pending fit). Wire `cancelAnimation` into `handlePointerDown` (both LMB and MMB branches) and `handleWheel` so mid-reset input cancels the reset.
  - [x] Do NOT use the counter-only-no-payload path. If `cameraResetRequestId !== lastResetRequestId.current` BUT `pendingCameraFit === null` (e.g., payload was cleared by a cancellation race), update `lastResetRequestId.current` but do NOT start an animation — the request is considered consumed.

- [x] Task 4: New hook `useCameraResetOnDoubleEscape` (AC: #4)
  - [x] Create [frontend/src/hooks/useCameraResetOnDoubleEscape.ts](frontend/src/hooks/useCameraResetOnDoubleEscape.ts):
    ```ts
    import { useEffect, useRef } from 'react';
    import { useQueryClient } from '@tanstack/react-query';
    import { usePondStore } from '../stores/usePondStore';
    import { fitCameraToPads } from '../components/pond/fitCameraToPads';
    import type { Todo } from '../types';

    const ESC_DOUBLE_WINDOW_MS = 600;
    // Must match the query key used by useTodos() in todoApi.ts.
    const TODOS_QUERY_KEY = ['todos', 'list'] as const;

    export function useCameraResetOnDoubleEscape() {
      const lastEscapeTs = useRef(0);
      const queryClient = useQueryClient();
      useEffect(() => {
        const handler = (e: KeyboardEvent) => {
          if (e.key !== 'Escape') return;
          // Ignore when typing inside an input — matches useClosePopupOnEscape's guard
          // so the user's own Escape-handler (clear input, blur, etc.) isn't shadowed.
          const t = e.target as HTMLElement | null;
          if (
            t?.tagName === 'INPUT' ||
            t?.tagName === 'TEXTAREA' ||
            t?.isContentEditable
          ) {
            return;
          }
          const now = performance.now();
          if (now - lastEscapeTs.current < ESC_DOUBLE_WINDOW_MS) {
            // Read live todos from React Query's cache at dispatch time —
            // always the freshest snapshot, no stale closure.
            const todos = queryClient.getQueryData<Todo[]>(TODOS_QUERY_KEY) ?? [];
            const fit = fitCameraToPads(todos);
            usePondStore.getState().requestCameraReset(fit);
            // Consume the double-tap so a third rapid ESC doesn't fire a second reset.
            lastEscapeTs.current = 0;
          } else {
            lastEscapeTs.current = now;
          }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
      }, [queryClient]);
    }
    ```
  - [x] Verify `TODOS_QUERY_KEY` matches the actual key used by `useTodos` in [todoApi.ts](frontend/src/api/todoApi.ts) (currently `['todos', 'list']` as `TODOS_KEY` — the const is local to the module so we can't import it without refactoring; re-declaring the tuple is fine for 3.1 scope, but leave the TODO above so a future test or refactor can hoist `TODOS_KEY` into a shared file).
  - [x] Do NOT `preventDefault()` or `stopPropagation()`. The existing [useClosePopupOnEscape](frontend/src/hooks/useClosePopupOnEscape.ts) and the `Escape` branch of [usePondSearchKeyboard](frontend/src/hooks/usePondSearchKeyboard.ts) must keep firing on every Escape to preserve their own side-effects (close popup, clear search). Our hook is purely additive — it observes timestamps and dispatches reset, nothing else.
  - [x] Mount the hook **once** in [PondScene.tsx](frontend/src/components/pond/PondScene.tsx) at the top of the component body, alongside the existing `usePondSearchKeyboard()` / `usePondSearchSync()` mount points. Do NOT mount inside `PondCamera` — that would tie keyboard-level concerns to the canvas-children render tree and break encapsulation.
  - [x] Verify handler ordering is irrelevant: all three Escape listeners are plain `window.addEventListener('keydown', ...)` and fire in registration order, but none of them stop propagation. Each does its job independently. If a future change introduces `stopPropagation()` on any of them, re-evaluate ordering.

- [ ] Task 5: Resize gate (AC: #6) — DEFERRED to reviewer (browser-only verification; no code expected to change)
  - [ ] No code changes expected. Manually verify in a browser: drag the window edge from wide → narrow → wide while the pond has pads. Confirm pads don't visibly jump, aspect ratio updates, and `OrbitControls` target stays put (the pond stays framed in the same world-space spot).
  - [ ] If and ONLY if a regression shows up (e.g., target drifts, aspect ratio stuck), add a comment in `PondCamera.tsx` documenting the observed bug and a minimal fix. Do not add speculative resize handling.

- [x] Task 6: Tests in `frontend/src/components/pond/PondCamera.test.tsx` (AC: #7)
  - [x] Mock `@react-three/fiber` (`Canvas`/`useFrame`/`useThree`) following [PondScene.test.tsx:8-22](frontend/src/components/pond/PondScene.test.tsx#L8-L22). Capture the function passed to `useFrame` so tests can invoke it synthetically (`const frameCallbacks: Array<() => void> = []; useFrame = (fn) => frameCallbacks.push(fn);`).
  - [x] Mock `@react-three/drei`'s `OrbitControls` to capture its props:
    ```ts
    let orbitControlsProps: Record<string, unknown> = {};
    vi.mock('@react-three/drei', () => ({
      OrbitControls: (props: Record<string, unknown>) => {
        orbitControlsProps = props;
        return null;
      },
    }));
    ```
  - [x] Test case — **`OrbitControls` config props** (AC #1, #2, #3, #5):
    - Render `<PondCamera />`.
    - Assert `orbitControlsProps.maxPolarAngle === Math.PI / 2.2`.
    - Assert `orbitControlsProps.minDistance === 5` and `.maxDistance === 60`.
    - Assert `orbitControlsProps.enableDamping === true` and `.dampingFactor === 0.05`.
    - Assert `orbitControlsProps.enablePan === true` and `.zoomToCursor === true`.
    - Assert `orbitControlsProps.mouseButtons` matches `{ LEFT: THREE.MOUSE.PAN, MIDDLE: -1, RIGHT: THREE.MOUSE.ROTATE }`.
  - [x] Test case — **`requestCameraReset` store action** (AC #4, #7):
    - Call `usePondStore.getState().requestCameraReset(fitA)` and `.requestCameraReset(fitB)`; assert `cameraResetRequestId` incremented by exactly 2; assert `pendingCameraFit === fitB` (latest wins — this is intentional; if a race sets two fits, the most recent is what PondCamera consumes).
    - Call `clearCameraResetRequest()`; assert `pendingCameraFit === null` but `cameraResetRequestId` is unchanged.
    - Assert `requestCameraReset` does NOT touch `cameraFocus` (set `cameraFocus` to a sentinel via `focusCamera(1, 2, 3)` first, then call `requestCameraReset(fit)`, assert `cameraFocus` is unchanged by the store action itself — the consumption in `useFrame` is where `cameraFocus` gets nulled, not inside the action).
  - [x] Test case — **`fitCameraToPads` pure helper** (`fitCameraToPads.test.ts`, AC #4):
    - Empty list → returns `{ position: [0, 15, 20], target: [0, 0, 0] }`.
    - `[{ positionX: 0, positionY: 0, ... }]` (single pad at origin) → centroid `(0, 0)`, `distance = RESET_MIN_DISTANCE = 15`, position `(0, 15·cos(polar), 0 + 15·sin(polar)) ≈ (0, 9, 12)`, target `(0, 0, 0)`.
    - `[{ positionX: -5, positionY: -5 }, { positionX: 5, positionY: 5 }]` → centroid `(0, 0)`, diagonal `hypot(10, 10) ≈ 14.14`, `distance = max(15, 14.14·1.3) ≈ 18.38`, target `(0, 0, 0)`, position.y ≈ `18.38·0.6 = 11.03`.
    - Dispersed cluster with diagonal > `RESET_MAX_DISTANCE / RESET_BBOX_PADDING` — distance clamps at `RESET_MAX_DISTANCE = 60`.
    - Mixed list with some `positionX: null` or `positionY: null` → nulls filtered out, computation proceeds with the rest.
    - Centroid is **not** the origin when pads are clustered off-center: `[{ x: 10, z: 10 }, { x: 12, z: 12 }]` → centroid `(11, 11)`, target `(11, 0, 11)`, position `(11, ~9, 11 + ~12)`.
  - [x] Test case — **`screenSpacePanning` and `mouseButtons.MIDDLE` config** (AC #2, #8):
    - Assert `orbitControlsProps.screenSpacePanning === false`.
    - Assert `orbitControlsProps.mouseButtons.MIDDLE === undefined` (MIDDLE omitted from the `mouseButtons` object so OrbitControls no-ops MMB, leaving it free for our own ascend/descend handler).
  - [x] Test case — **LMB click-no-drag on water is a no-op** (AC #2 click-to-centre retirement):
    - Render `<PondCamera />`, dispatch a `pointerdown` + `pointerup` on the canvas with no intervening move (simulate click, not drag).
    - Capture `camera.position` before and after the click.
    - Assert `camera.position` is unchanged (not mutated by the retired lerp path).
    - Repeat with `activePopupTodoId = 'foo'` in the store — assert `closePopup` is called (the preserved popup-close path).
  - [x] Test case — **MMB-drag translates camera + target Y together** (AC #8):
    - Render `<PondCamera />`, capture the mock `controls` (from the `OrbitControls` stub or a separate mock target).
    - Set `camera.position.y = 10` and `controls.target.y = 0` (or whatever the mock starts at).
    - Dispatch `pointerdown` with `button = 1, clientY = 500` on the canvas; `pointermove` with `clientY = 400` on `window` (drag up 100 px); `pointerup` with `button = 1`.
    - Assert the delta applied to both `camera.position.y` and `controls.target.y` equals `100 * MMB_ASCEND_SENSITIVITY = 3.0` (within a floating-point epsilon).
  - [x] Test case — **MMB-descend clamps at `CAMERA_MIN_Y`** (AC #8):
    - Set `camera.position.y = 1.0` (just above the floor).
    - Simulate MMB-drag downward far enough to want to descend by 5 units.
    - Assert `camera.position.y === CAMERA_MIN_Y` (clamped to 0.5, not -4.0).
    - Assert `controls.target.y` advanced by the truncated delta (`0.5 - 1.0 = -0.5`), not the full requested delta.
  - [x] Test case — **frame-level floor clamp** (AC #9):
    - Manually set `camera.position.y = -2.0` (simulate a bug that pushed it underwater).
    - Run the captured `useFrame` callback once.
    - Assert `camera.position.y === CAMERA_MIN_Y`.
    - Verify `controls.target.y` is NOT mutated by the frame-level clamp (only camera.y is floored).
  - [x] Test case — **double-Escape dispatches reset with computed fit** (`useCameraResetOnDoubleEscape.test.ts`, AC #4):
    - Set up a `QueryClient`, seed it with `queryClient.setQueryData(['todos', 'list'], [makeTodo({ positionX: 10, positionY: 10 })])`.
    - Mount a component that uses `useCameraResetOnDoubleEscape()` wrapped in `<QueryClientProvider client={queryClient}>`.
    - Dispatch a native `keydown` with `key='Escape'` on `window`. Assert `cameraResetRequestId` unchanged and `pendingCameraFit` still null (single ESC doesn't reset).
    - Mock `performance.now()` via `vi.useFakeTimers()` + `vi.setSystemTime()` OR by stubbing `performance.now` directly. Advance time by 300 ms.
    - Dispatch a second `keydown` with `key='Escape'`. Assert `cameraResetRequestId` incremented by 1, assert `pendingCameraFit` matches `fitCameraToPads([{ positionX: 10, positionY: 10 }])` (can import and call the helper directly to compute the expected fit).
  - [x] Test case — **double-Escape with empty cache falls back to default fit** (AC #4):
    - No seeded todos (or explicit empty array). Double-ESC. Assert `pendingCameraFit` equals the default fit (`{ position: [0, 15, 20], target: [0, 0, 0] }`).
  - [x] Test case — **Escape > 600 ms apart does NOT trigger reset** (AC #4):
    - Dispatch ESC, advance mock time by 700 ms, dispatch ESC. Assert counter unchanged.
  - [x] Test case — **Escape inside an `<input>` is ignored** (AC #4 input guard):
    - Dispatch `keydown` with `key='Escape'` and `target` set to an `<input>` element. Repeat twice within 600 ms. Assert counter unchanged.
  - [x] Test case — **consume-on-trigger prevents triple-tap double-reset** (AC #4):
    - Dispatch ESC, advance 100 ms, dispatch ESC (reset fires — counter = 1). Advance 100 ms, dispatch ESC. Assert counter is still 1 (the third ESC resets the timestamp; a fourth within window would be needed to fire again).
  - [x] Test case — **reset lerp converges to pendingCameraFit** (AC #4):
    - Set `camera.position` to `(0, 5, 5)` and `controls.target` to `(-3, 0, -3)` on the mock (user orbited somewhere arbitrary).
    - Call `requestCameraReset({ position: [10, 9, 12], target: [10, 0, 0] })` (a fit pointing at a pad cluster near X=10).
    - Run the captured `useFrame` callback N times (e.g., 60 ticks = ~1 second at 60 fps).
    - Assert `camera.position.distanceTo(new Vector3(10, 9, 12)) < 0.1` and `controls.target.distanceTo(new Vector3(10, 0, 0)) < 0.1`.
    - Assert `pendingCameraFit === null` after arrival (cleared via `clearCameraResetRequest`).
    - One more frame tick does NOT change camera.position (animation finished).
  - [x] Test case — **wheel mid-reset cancels + clears pending fit** (AC #4):
    - Call `requestCameraReset(someFit)`, run 3 frame ticks (partial progress toward the fit).
    - Dispatch a `wheel` event on the canvas.
    - Run 3 more frame ticks; assert `camera.position` does NOT converge to `someFit.position` (the reset was cancelled; `controls.update()` only runs from here on).
    - Assert `pendingCameraFit === null` (the cancellation path clears it so a subsequent equal-fit request is still seen as fresh by counter compare).
  - [x] Reset `usePondStore` state between tests (`beforeEach` → `setState` the counter back to 0) so tests stay independent.

- [x] Task 7: Full-suite verification + browser walkthrough (AC: #1–#9) — code paths verified by unit tests; browser walkthrough DEFERRED to reviewer
  - [x] `cd frontend && npx vitest run` — 171/171 green (145 pre-existing + 26 new: 8 fitCameraToPads + 7 hook + 11 PondCamera).
  - [x] `cd frontend && npx tsc -b` — clean.
  - [ ] Browser walkthrough (DEFERRED to reviewer — dev ran in a headless environment. Each bullet's code path is covered by a unit test where feasible; browser-only sensory checks remain):
    - [ ] Scroll mouse wheel over the pond — zoom smooths in and out with damping; try to zoom past min/max — stops at the clamp, no flicker.
    - [ ] **LMB-drag up on empty water** — pond slides forward (toward viewer). Drag down — pond slides back. Drag sideways — strafe. Release — damping eases out smoothly.
    - [ ] **LMB-click with no drag** on empty water — nothing happens (click-to-centre is retired). Open a popup then LMB-click outside — popup closes (preserved).
    - [ ] Click a pad (no drag) — popup opens, camera focuses on it (existing behaviour, untouched).
    - [ ] Right-click-drag — camera orbits; drag up until tilt clamps at `Math.PI/2.2` — camera does not go underwater or flip.
    - [ ] **MMB-drag up** — camera ascends (both camera and target rise together, pitch preserved). **MMB-drag down** — descends. Try to descend far enough to hit the floor — camera.y clamps at `CAMERA_MIN_Y = 0.5`; continuing to drag down does nothing (no jitter, no unclamp-on-release).
    - [ ] **ESC ESC rapidly** (within ~0.5 s) on a canvas-focused page with **several pads** dropped at varying positions — camera smoothly returns to a framing that shows ALL pads with visible margin (not just the default framing). The centroid of the camera's final target roughly matches the centroid of the pad cluster.
    - [ ] ESC ESC on an **empty pond** — camera returns to the hard-coded default framing `(0, 15, 20)` → origin.
    - [ ] After ESC ESC, the camera pitch "looks like home" — you should recognise it as the same angle as the initial load, just centred/zoomed differently.
    - [ ] ESC ESC with popup open — first ESC closes popup, second ESC resets camera.
    - [ ] ESC ESC with search active — first ESC clears search, second ESC resets camera.
    - [ ] ESC — wait 2 s — ESC — nothing happens (window expired between taps).
    - [ ] Type "hello" into the TodoInput, press ESC ESC rapidly — camera does NOT reset (input guard).
    - [ ] Mid-reset, scroll the wheel / MMB-drag / LMB-drag — reset aborts, user input takes over.
    - [ ] ESC ESC ESC ESC rapidly — camera resets once on the second ESC; the third and fourth don't immediately fire a second reset (consume-on-trigger).
    - [ ] Resize the browser window from wide to narrow — pond stays framed, no pad jumps, no console errors.
    - [ ] **Cannot see underwater**: try every combination — orbit to max tilt + zoom to min distance + MMB-descend — confirm the water surface always remains below the camera's eye level and no underwater frame is ever rendered.

## Dev Notes

### Why a counter, not a boolean flag, for reset requests

Two back-to-back reset requests (e.g., a double-Escape followed shortly by another double-Escape after a wheel interrupt) must both fire fresh animations — the second restarts from wherever the camera is mid-first-animation, not "already resetting, ignore". A boolean `cameraResetPending: boolean` would coalesce — the second request would be a no-op if the first is still true. A monotonically-increasing counter handled via a ref-compare in `useFrame` naturally gives us "every call is a fresh signal". Same pattern is used elsewhere in the store for imperative nudges.

### Why not reuse the existing `cameraFocus` slice for reset

`cameraFocus: { x, z, zoom }` assumes an isometric-ish pull-in at a **45° polar angle** (see the `Math.PI / 4` constant in [PondCamera.tsx:101](frontend/src/components/pond/PondCamera.tsx#L101)). Our default camera at `(0, 15, 20)` with target at origin has a polar angle of `acos(15/25) ≈ 53.13°`, not 45°. Stuffing a "reset" into `cameraFocus` with `zoom = 25` would land the camera at the wrong pitch. Separate slices (`cameraResetRequestId` + `pendingCameraFit`) plus the dedicated `RESET_POLAR_ANGLE` keep the math honest and the reset pose recognisable as "home pitch".

### Reinstated fit-to-pads logic — history and scope

The bounding-box + centroid + padded-diagonal distance math in `fitCameraToPads` is a direct reinstatement of logic originally authored for Story 5.3's search auto-frame and removed at commit `f4088d3` ("refactor: remove search camera auto-frame — pond stays put during search"). The commit message rationale — *"When searching, all the pads should be visible. Don't adjust the zoom or move the camera around."* — was specific to the **search path**, not a condemnation of the math itself. For reset, the user's explicit intent is the opposite: moving the camera to frame every pad IS the entire point. Reinstating the logic for reset is consistent with the 5.3 decision, not contradictory to it.

Key differences from the 5.3 version:
- **Input**: live todos (all positioned pads), not search matches.
- **Consumer**: `requestCameraReset(fit)` via a dedicated store slot, not `focusCamera(cx, cz, zoom)`.
- **Polar angle**: explicitly preserved at `atan2(20, 15) ≈ 53.13°` to match the default-pose pitch. The 5.3 version went through `focusCamera` and got the 45° polar baked into `cameraFocus` — that's specifically what we're avoiding in the "Why not reuse `cameraFocus`" note above.
- **Padding**: `1.3` here vs `1.2` in the removed code — a slightly more generous margin for reset (user is explicitly asking for overview) than for search (want matches prominent). Tunable in Task 7 browser verification.

The invariant tests from commit `f4088d3` (search must NOT touch `cameraFocus`) stay in place — they're orthogonal to this story. The new `fitCameraToPads` helper lives in a separate file and is only consumed by the reset path.

### `cameraResetRequest` — why a counter + payload rather than just a payload

Couldn't we just use `pendingCameraFit: CameraFit | null` alone and have PondCamera watch for non-null? In principle, yes. The counter adds resilience to three edge cases: (a) two back-to-back reset requests with identical fits — counter bumps both times, so the second definitely restarts the lerp even if the payload's object identity happened to match (it won't, but belt-and-suspenders); (b) the animation finishing and clearing `pendingCameraFit` while the user is mid-second-double-ESC — the counter guarantees the second request is still seen as "fresh" via ref-compare, not mistaken for the already-consumed first; (c) future debugging / telemetry — a monotonic request count is easy to log and trace. The counter costs one integer in the store; the clarity is worth it.

### Why double-Escape instead of epics.md's "double-click empty water"

The original epics.md AC was "double-click empty water → reset camera". Double-click-on-canvas has three practical problems discovered during 3.1 planning: (1) **R3F event propagation** — a DOM `dblclick` on the canvas fires regardless of whether a pad is under the pointer, so a dblclick on a pad would false-trigger reset unless we add a scene-wide raycast discriminator (adds code + test surface). (2) **First-click interference** — without the click-to-centre retirement, the first click of a dblclick already starts a camera animation before the second click lands, creating a "reset cancels a motion that should never have started" race. (3) **Discoverability** — keyboard shortcuts are self-documentable (status-bar hints, tooltip), whereas double-click-on-water has no affordance. Double-Escape solves all three: it's keyboard-only (no raycast, no pad/water discrimination), it composes cleanly with the existing single-Escape `useClosePopupOnEscape` / `usePondSearchKeyboard` hooks, and we can surface the hint in UI copy later ("ESC twice to reset view"). Deviation from epics.md is deliberate; document in the epic retrospective when Epic 3 closes.

### Click-to-centre (single-click-on-water lerp) is retired in this story

Prior to 3.1, [PondCamera.tsx handlePointerUp](frontend/src/components/pond/PondCamera.tsx#L40-L68) raycast every LMB click-no-drag against the water plane and lerped the camera target toward the hit point — an ad-hoc "click-to-centre" affordance carried over from early pond-scene work. It's retired in this story for two reasons: (1) with `screenSpacePanning = false`, LMB-drag panning now gives true forward/back/strafe ground-plane movement (AC #2), so click-to-centre is no longer the only path to reposition; (2) click-to-centre has no discoverability affordance and most users never learned it existed. The popup-close-on-water-click branch of `handlePointerUp` (`if (activePopupTodoId !== null) closePopup()`) is **preserved** — that's the click-outside-to-dismiss pattern for the action popup (Story 2.3).

### No-underwater — three defense layers

The user explicitly requires that the camera never shows an underwater perspective. Three independent mechanisms enforce this:
1. **Orbit constraint** (AC #3): `maxPolarAngle = Math.PI / 2.2` caps tilt at ≈ 81.8°. The camera can never orbit below ~8° above the water plane, guaranteeing the view looks DOWN at the water, never level with or below it. At `minDistance = 5` and the polar max, camera.y = `5 · cos(81.8°) ≈ 0.71` — above water with ~0.7 unit clearance.
2. **MMB-descend clamp** (AC #8): the MMB handler truncates any descend delta that would push `camera.position.y` below `CAMERA_MIN_Y = 0.5`. Both camera and target advance by the truncated delta so the rigid-body translate semantics hold (pitch is preserved; target.y can end up slightly negative when camera is at floor — that's cosmetic, not visible).
3. **Frame-level hard floor** (AC #9): every `useFrame`, before `controls.update()` runs, `camera.position.y = max(camera.position.y, CAMERA_MIN_Y)`. This is defense-in-depth — any future interaction (atmosphere effect in 3.2, a ported component that sets camera.position directly, a WebGL state restore that corrupts state) can't produce an underwater frame even for a single tick. In steady state the clamp is a no-op because layers 1 and 2 already prevent it from firing.

`CAMERA_MIN_Y = 0.5` sits below the orbit-constraint-derived minimum of ~0.7, so orbit+zoom extrema keep working unclipped; MMB-descend sets the tighter floor. If browser testing shows 0.5 feels "too close to the water" for MMB-descend, raise to 0.7 (matches orbit min) or 1.0 — tune via the constant, no logic change needed.

### Reserved modifier slots for Epic 4.2 group selection

Epic 4.2 (Lily Pad Clustering & Groups) needs **Shift+LMB click on pad** (toggle-add to selection) and **Shift+LMB drag on empty water** (marquee box-select). Story 3.1 must NOT claim these bindings for any camera action. Specifically: if any future story-3.1 variation would extend LMB behaviour (e.g., a "shift for finer pan" modifier), use **Ctrl/Cmd** or **Alt** instead of Shift. Document in deferred-work if we discover a camera feature that truly needs Shift+LMB — but default-prefer other modifiers.

### MMB fallback for trackpad / 2-button mouse users — deferred

Ascend/descend via MMB-drag (AC #8) assumes a 3-button mouse. Trackpad users and 2-button mice have no path to this DOF. This is an **accepted tradeoff** for 3.1 scope; full accessibility would require a keyboard fallback (e.g., `Q` = descend, `E` = ascend, or `PageUp`/`PageDown`). Log as deferred work at story close if not folded in before dev. The existing orbit + zoom already provide alternative viewing-angle control, so users without MMB aren't fully blocked — just less fluent.

### Default-position constants must stay in sync with `PondScene.tsx`

The initial `<Canvas camera={{ position: [0, 15, 20] }}>` in [PondScene.tsx:153](frontend/src/components/pond/PondScene.tsx#L153) and `DEFAULT_CAMERA_POSITION` in `PondCamera.tsx` must agree. If a future story changes the default framing, change both. An optional hardening step (not required for 3.1): export `DEFAULT_CAMERA_POSITION` from `PondCamera.tsx` and reference it in `PondScene.tsx`'s Canvas prop to make the dependency explicit and compiler-checked. Decision deferred — raise as deferred-work if a future camera-framing story touches the default.

### Constraints on the polar angle — why `Math.PI / 2.2`

`Math.PI / 2` (90°) is level with the water plane. At exactly 90° the camera becomes a grazing-angle edge-on view that renders poorly (water-plane z-fighting, ripples read as flat stripes). `Math.PI / 2.2` ≈ 81.8°, leaving an 8° margin above the water so the water surface retains visible area even at the minimum tilt. Do NOT raise this closer to 90° without revisiting the water shader's grazing-angle behaviour.

### No code changes to atmosphere-driven camera damping — that's 3.2

Architecture.md line 619–621 notes that atmosphere modes should eventually adjust camera damping (zen = slower, cyberpunk = snappier). **This is explicitly Story 3.2** ("Atmosphere Mode Toggle") and should NOT be implemented in 3.1. Keep `dampingFactor = 0.05` hard-coded for this story; 3.2 will lift it to an atmosphere-driven value.

### Project Structure Notes

- New files:
  - [frontend/src/components/pond/fitCameraToPads.ts](frontend/src/components/pond/fitCameraToPads.ts) — pure helper: pads → camera fit. Reinstates logic from commit `f4088d3`.
  - [frontend/src/components/pond/fitCameraToPads.test.ts](frontend/src/components/pond/fitCameraToPads.test.ts) — unit tests for the helper (empty, single, cluster, max-clamp, null-filter).
  - [frontend/src/components/pond/PondCamera.test.tsx](frontend/src/components/pond/PondCamera.test.tsx) — camera config, MMB-drag, reset lerp, floor clamp, click-to-centre retirement tests. Co-located with component under test.
  - [frontend/src/hooks/useCameraResetOnDoubleEscape.ts](frontend/src/hooks/useCameraResetOnDoubleEscape.ts) — double-ESC keyboard hook that reads todos from React Query cache and dispatches computed fit.
  - [frontend/src/hooks/useCameraResetOnDoubleEscape.test.ts](frontend/src/hooks/useCameraResetOnDoubleEscape.test.ts) — double-tap timing, input guard, consume-on-trigger, empty-cache fallback tests. Follows the `useClosePopupOnEscape.test.ts` pattern.
- Modified files:
  - [frontend/src/components/pond/PondCamera.tsx](frontend/src/components/pond/PondCamera.tsx) — hoisted constants, `screenSpacePanning=false`, mouseButtons update, click-to-centre retirement, MMB handler, reset animation (fit-driven), frame-level floor clamp.
  - [frontend/src/stores/usePondStore.ts](frontend/src/stores/usePondStore.ts) — new `cameraResetRequestId` + `pendingCameraFit` slices, `requestCameraReset(fit)` + `clearCameraResetRequest` actions.
  - [frontend/src/components/pond/PondScene.tsx](frontend/src/components/pond/PondScene.tsx) — mount `useCameraResetOnDoubleEscape()` alongside existing top-level hooks.
- No backend changes, no API changes, no type changes beyond the new `usePondStore` slices and the `CameraFit` type exported from `fitCameraToPads.ts`.

### References

- Epic 3 user story + AC — [_bmad-output/planning-artifacts/epics.md](../planning-artifacts/epics.md#Story-3.1-Interactive-Camera-Controls) (lines 396–420)
- PRD FR30, FR31 — [_bmad-output/planning-artifacts/prd.md](../planning-artifacts/prd.md#Functional-Requirements) (lines 329–330)
- UX spec Direction D "Hybrid Angled + Interactive Camera" — [_bmad-output/planning-artifacts/ux-design-specification.md](../planning-artifacts/ux-design-specification.md) (lines 574–621)
- Architecture camera setup guidance — [_bmad-output/planning-artifacts/architecture.md](../planning-artifacts/architecture.md#Technical-Stack) (lines 132, 508, 698, 1100–1104)
- Existing implementation (most of AC #1–#3, #5) — [frontend/src/components/pond/PondCamera.tsx](frontend/src/components/pond/PondCamera.tsx)
- Existing canvas defaults — [frontend/src/components/pond/PondScene.tsx#L153](frontend/src/components/pond/PondScene.tsx#L153)
- Test mock pattern — [frontend/src/components/pond/PondScene.test.tsx](frontend/src/components/pond/PondScene.test.tsx) (lines 8–22)
- Original fit-to-pads logic (removed, reinstated here) — commit `f4088d3` diff on `frontend/src/hooks/usePondSearchSync.ts` (the `MIN_SEARCH_ZOOM` / `BBOX_ZOOM_PADDING` constants and the centroid + bbox math around `focusCamera(cx, cz, zoom)`).
- `useTodos` query key — [frontend/src/api/todoApi.ts#L6](frontend/src/api/todoApi.ts#L6) (`TODOS_KEY = ['todos', 'list']`).

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) via Claude Code / bmad-dev-story workflow.

### Debug Log References

- Hook test initially failed on 5/7 cases because `lastEscapeTs = useRef(0)` made the first ESC look "within 600 ms of t=0". Fixed by seeding the ref to `Number.NEGATIVE_INFINITY`; also updated the consume-on-trigger path to reset to `NEGATIVE_INFINITY` for symmetry. Single commit of the fix alongside the test, all 7 hook tests then green.
- Three.js warning "Multiple instances of Three.js being imported" fires during tests — pre-existing noise, not caused by this story. Noted for a future tooling-hygiene sweep.

### Completion Notes List

- **AC #1 (zoom + damping)**: already wired in PondCamera.tsx from Story 1.2; verified via OrbitControls config-props test.
- **AC #2 (ground-plane pan + click-to-centre retired)**: set `screenSpacePanning={false}` on OrbitControls; removed the two lines of click-to-centre lerp in `handlePointerUp` while preserving the popup-close branch; verified via two unit tests (click no-drag is a no-op; click with popup calls closePopup).
- **AC #3 (orbit + underwater guard)**: already wired; verified maxPolarAngle via config-props test.
- **AC #4 (double-Escape reset to fit-to-pads)**: new `fitCameraToPads` helper (pure, 8 tests) + new `useCameraResetOnDoubleEscape` hook (7 tests incl. double-tap timing, input guard, consume-on-trigger, empty-cache fallback) + reset-animation branch in `PondCamera.useFrame` driven by a new `pendingCameraFit` store slice + `cameraResetRequestId` counter (ref-compare; new requests restart animation). Verified via 3 PondCamera tests (convergence to fit, wheel cancellation clears fit, counter bump with null fit is a no-op).
- **AC #5 (smooth damping)**: `enableDamping=true`, `dampingFactor=0.05` unchanged; covered by config-props test.
- **AC #6 (window resize)**: no code changes needed; browser verification deferred to reviewer.
- **AC #7 (test coverage)**: 27 new unit tests added (8 fitCameraToPads + 7 hook + 12 PondCamera) + 4 store-slice tests. Full suite 172/172 green, zero regressions. `tsc -b` clean. *(+1 PondCamera test from the 2026-04-22 CR patches for off-canvas MMB release; +1 `minPolarAngle` assertion inside the existing config-props test.)*
- **AC #8 (MMB ascend/descend with floor)**: MMB pointerdown begins drag + `preventDefault`; pointermove on window tracks `clientY` delta; `delta = -dy * MMB_ASCEND_SENSITIVITY` applied to both `camera.position.y` and `controls.target.y` (rigid body); descend delta truncated when it would push camera.y below `CAMERA_MIN_Y = 0.5`. Verified via 3 PondCamera tests (ascend drag, descend-clamp, MMB-cancels-reset).
- **AC #9 (frame-level floor)**: first op in `useFrame` is `if (camera.position.y < CAMERA_MIN_Y) camera.position.y = CAMERA_MIN_Y`. Verified via 2 PondCamera tests (below-floor clamps; above-floor no-op).
- **Browser walkthrough (Task 7)**: headless dev environment; all bullets deferred to reviewer for browser-only sensory verification (damping feel, actual forward-drag behavior, underwater visual check). Every code path under a bullet has a unit test counterpart.
- **Reserved bindings**: Shift+LMB click/drag left untouched per story spec (reserved for Epic 4.2 group selection).

### File List

**New:**
- `frontend/src/components/pond/fitCameraToPads.ts` — pure helper: pads → CameraFit. Reinstates the centroid + bbox-diagonal math from commit f4088d3, scoped to the reset path.
- `frontend/src/components/pond/fitCameraToPads.test.ts` — 8 unit tests (empty, single pad, two pads, dispersed max-clamp, off-centre cluster, null-filter, polar-angle sanity check).
- `frontend/src/components/pond/PondCamera.test.tsx` — 12 unit tests (config props incl. `minPolarAngle`-unset assertion, click-to-centre retirement, MMB ascend/descend + floor clamp + off-canvas pointerup cleanup, reset animation + fit, wheel-cancel, null-fit consumption, frame-level floor).
- `frontend/src/hooks/useCameraResetOnDoubleEscape.ts` — double-Escape → compute fit from React Query cache → `requestCameraReset`.
- `frontend/src/hooks/useCameraResetOnDoubleEscape.test.ts` — 7 unit tests (single ESC no-op, double ESC triggers, expired window, input guard, consume-on-trigger, empty cache, cleanup on unmount).

**Modified:**
- `frontend/src/components/pond/PondCamera.tsx` — hoisted DEFAULT_CAMERA_POSITION/TARGET + CAMERA_MIN_Y + MMB_ASCEND_SENSITIVITY + RESET_ARRIVE_THRESHOLD + pre-allocated reset Vector3 temporaries; added resetAnimating + lastResetRequestId + mmbDragPrevY refs; extended cancelAnimation to clear pendingCameraFit; added MMB branch to handlePointerDown/Up + new handlePointerMove + handleMmbOrCancel; added `screenSpacePanning={false}` to OrbitControls + removed MIDDLE from mouseButtons; added frame-level camera.y floor + reset-animation branch at top of useFrame; retired click-to-centre lerp in handlePointerUp.
- `frontend/src/stores/usePondStore.ts` — imported CameraFit; added `cameraResetRequestId` + `pendingCameraFit` slices; added `requestCameraReset(fit)` + `clearCameraResetRequest()` actions.
- `frontend/src/stores/usePondStore.test.ts` — added 4 tests covering the new slice + actions; extended beforeEach to reset the new slices.
- `frontend/src/components/pond/PondScene.tsx` — imported + mounted `useCameraResetOnDoubleEscape()`; added pairing comment on the Canvas default-position prop.

### Review Findings

- [x] [Review][Patch] MMB pointerup off-canvas leaves `mmbDragPrevY` set — ghost drag persists. **Fix applied 2026-04-22:** added a window-level `pointerup` listener wired to `handleMmbOrCancel` (already covers `button === 1` and `pointercancel`). Off-canvas MMB release now clears `mmbDragPrevY` just like an on-canvas release. New regression test `MMB pointerup on window (off-canvas release) clears drag state` asserts that a subsequent `pointermove` does NOT continue translating the camera. [`frontend/src/components/pond/PondCamera.tsx`, `frontend/src/components/pond/PondCamera.test.tsx`]
- [x] [Review][Patch] Story spec note (Task 1b) incorrectly said "Do NOT set to `undefined`"; correct approach is to omit `MIDDLE` from `mouseButtons` (what the code does). **Fix applied 2026-04-22:** corrected Task 1b note, AC #2 prose, AC #7 (Task 6) test-outline bullet to describe omission (drei passes `undefined` → OrbitControls no-ops MMB), matching the shipped implementation. [`_bmad-output/implementation-artifacts/3-1-interactive-camera-controls.md`]
- [x] [Review][Patch] Config-props test missing `minPolarAngle` assertion (AC #3/#7 — should assert it is not set, confirming the default of 0 is preserved). **Fix applied 2026-04-22:** added `expect(orbitControlsProps.minPolarAngle).toBeUndefined()` to the existing config-props test; aligned Task 6 outline to document the new assertion. [`frontend/src/components/pond/PondCamera.test.tsx`, `_bmad-output/implementation-artifacts/3-1-interactive-camera-controls.md`]
- [x] [Review][Defer → Fixed 2026-04-22] `mouseNDC` NDC computation used `window.innerWidth/innerHeight` instead of canvas `getBoundingClientRect`. Originally logged as deferred (pre-existing since Story 1.x), but promoted to a fix in the CR-patch cycle because the change is small, strictly-better, and makes the popup-close-on-water-click path robust to any future non-fullscreen canvas layout. `mockCanvas.getBoundingClientRect` stubbed in the test to a 1024×768 rect so JSDOM's default zeros don't make raycasts miss. deferred-work.md flipped to `[FIXED]`. [`frontend/src/components/pond/PondCamera.tsx` — `handlePointerUp`, `frontend/src/components/pond/PondCamera.test.tsx`]
- [x] [Review][Defer] Module-scope mutable Vector3 singletons (`resetTargetPos`, `resetTargetTarget`, etc.) shared across multiple `PondCamera` instances — deferred, singleton in production; test isolation maintained by `resetMockState` [`frontend/src/components/pond/PondCamera.tsx`]

### Change Log

| Date       | Change                                                           | Author              |
|------------|------------------------------------------------------------------|---------------------|
| 2026-04-22 | Story 3.1 implementation complete; marked ready for review.      | Claude Opus 4.7     |
| 2026-04-22 | Code review complete — 3 patches, 2 defers, ~20 dismissed.       | Claude Sonnet 4.6   |
| 2026-04-22 | 3 CR patches applied (off-canvas MMB release, minPolarAngle assertion, spec-note correction) + defer #1 (canvas-relative NDC) promoted to fix; 1 defer remaining; 172/172 tests green. | Claude Opus 4.7     |
| 2026-04-22 | Story closed (review -> done); all CR patches applied, defer #1 fixed (48619b2), defer #2 remains [OPEN] with logged rationale. | Claude Opus 4.7     |
