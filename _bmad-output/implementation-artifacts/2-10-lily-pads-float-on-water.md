# Story 2.10: Lily Pads Float on the Water Surface

Status: done

> **Scope note:** 2.10 is a polish spillover story on Epic 2, sibling to 2.7 (pulse polish), 2.8 (glow polish), and 2.9 (ripple hardening). The insight came out of 2.9's browser-verification pass: with ripple amplitudes of 0.45–0.7 world units and pads pinned at `DROP_Y_REST = 0.05`, ripple crests visibly punch through the pads — reading as "pads are on a glass plate above the water" rather than "pads floating on the water." This story makes each pad sample the water elevation at its position every frame and ride the waves, plus tilt toward the local water gradient so a pad rocks as a wave passes under it.

## Story

As a user watching the pond,
I want each lily pad to bob and tilt with the water as ripples pass under it —
so that the pads read as floating on the water (real physics) rather than hovering fixed while waves pass beneath them (broken illusion).

## Acceptance Criteria

1. **Given** a lily pad is in the `resting` phase and one or more ripples (click or ambient) are active on the water surface, **When** each `useFrame` tick runs, **Then** the pad's `group.position.y` tracks `DROP_Y_REST + waterElevation(posX, posZ, elapsedTime)` rather than the current fixed `DROP_Y_REST + sineBob`. The `sampleElevation` function computes the same result the shader computes for the water-surface vertex at that (x, z) point — breath + all active ambient ripples + all active click ripples + splash pulse. The existing 0.01-amplitude fake sine bob at [LilyPad.tsx:963-969](frontend/src/components/pond/LilyPad.tsx#L963-L969) is removed — the real water motion replaces it.

2. **Given** a pad is in the `resting` phase and the water under it has a non-zero gradient (a wave crest passing asymmetrically), **When** each `useFrame` tick runs, **Then** the pad's group rotation tilts to align its up-vector with the local water normal. Gradient is sampled via central differences: `∂y/∂x = (elevation(x+δ, z) − elevation(x−δ, z)) / (2δ)` and `∂y/∂z` equivalently, with `δ ≈ 0.35` (roughly one-third of `PAD_RADIUS = 1.0` so the gradient reflects the pad-sized region, not a pointwise slope). Tilt is limited to ±15° on each axis to keep extreme wave crests from flipping the pad onto its side. Tilt lerps toward target each frame at a fixed rate (~0.08 per frame = ~200ms ease) so instant gradient snaps are smoothed.

3. **Given** a pad is in `resting`, `settling`, or `pulsing` phase (the last two being the landing phases that play out on top of the pad's own impact ripple), **When** each `useFrame` tick runs, **Then** the pad samples water elevation and rides it: `resting` lerps toward `targetY + elevation` plus gradient tilt; `settling` adds elevation on top of the landing bounce (`DROP_Y_REST + bounce + elevation`); `pulsing` sets `position.y = DROP_Y_REST + elevation` while the scale pulse plays. Tilt is only applied in `resting`. **Given** a pad is in any other phase (`forming`, `waiting`, `dropping`, `materializing`, `completing`, `deleting`, `completed`, `deleted`), the pad does NOT sample elevation — those phases' own animation fully owns `position.y` and `rotation`. On `→ resting` transitions (from `pulsing`, `materializing`, or the cancel-recovery paths from `completing`/`deleting`), `group.position.y` is SEEDED to `targetY + sampleElevation(posX, posZ)` so no lerp-through-crest frames occur. _(AC amended in the 2026-04-20 code review to cover landing phases — see Review Findings.)_

4. **Given** ripple crests that would otherwise have penetrated a pad (wave heights 0.45–0.7 world units vs the pad sitting at +0.05), **When** a ripple passes under a `resting` pad, **Then** the pad rides the crest and trough — at no frame does the water elevation at the pad's position exceed the pad's y-position (the pad is always above or exactly at the water surface). Verified via a unit test on `sampleElevation` that runs a click ripple through a grid of (x, z) sample points and confirms the derived `pad-ride-y` values are >= the computed elevation at each sample.

5. **Given** multiple pads on screen (realistic upper bound: 30 concurrent pads in `resting`), **When** `useFrame` runs at 60 fps, **Then** sampling cost is bounded: each pad performs at most 5 elevation samples per frame (1 for height + 4 for gradient). Per-pad sample runs a loop over the active click/ambient slots (≤ 11 total). 30 pads × 5 samples × 11 ripples × 60 fps ≈ 100k trig-heavy ops/sec — acceptable for modern hardware, but the implementation MUST NOT allocate per-frame Vector objects in the hot path. Reuse pre-allocated temporaries (module-scope or useMemo) for sample-point vectors.

6. **Given** the full existing test suite runs after this change, **When** all tests finish, **Then** every existing test remains green (72/72). A new unit test on the shared `sampleElevation` function covers the AC #4 invariant (pad rides above any ripple crest passing through its position) and the parity check (AC #7 below).

7. **Given** the shader's elevation math and the JS `sampleElevation` function must agree (otherwise pads float at one height while their ripple visually passes at another), **When** a parity test runs, **Then** the JS function's output at a small grid of (x, z, t) sample points matches the shader's intended output to within ±0.001 world units. This is implemented by extracting the elevation math into a pure TS function (in a new file, e.g. `frontend/src/components/pond/waterElevation.ts`) that both (a) is called by JS consumers and (b) is mirrored in GLSL via a side-by-side comment block documenting the invariants. Any future tweak to one side must be mirrored — the parity test catches divergence automatically.

## Tasks / Subtasks

- [x] Task 1: Extract a shared elevation module (AC: #1, #7)
  - [x] Create `frontend/src/components/pond/waterElevation.ts` exporting:
    - `type RippleSlot = { centerX: number; centerY: number; startTime: number; amplitude: number }` — plane-local coords (same as shader uniforms).
    - `type ElevationInputs = { clickSlots: RippleSlot[]; ambientSlots: Array<RippleSlot & { decayRate: number }>; ambientWavefrontSpeed: number; elapsedTime: number }`.
    - `function sampleElevation(worldX: number, worldZ: number, inputs: ElevationInputs): number` — mirrors the GLSL in `WaterSurface.tsx:56-175`. Remember the plane is rotated -90° about X, so internally convert `(worldX, worldZ) → (planeX = worldX, planeY = -worldZ)` before running the shader's math.
  - [x] Add a top-of-file comment block pairing the JS math with the GLSL it mirrors, with a "bump together" invariant warning.
  - [x] Unit test: grid of (x, z, t) sample points with a fixed ripple slot set; assert JS output matches a hardcoded expected-value table (generated once by running the shader — OR derived mathematically from the same formula).

- [x] Task 2: Expose a sampler API from WaterSurface (AC: #1)
  - [x] Pick one of: (a) register an imperative handle in `usePondStore` (e.g., `sampleElevation: (x, z) => number`) that `WaterSurface` writes to on mount and resets to a no-op on unmount; or (b) thread a ref through `PondScene` down to each `LilyPad`. Recommendation: (a) — simpler, matches the existing `triggerRipple` imperative pattern.
  - [x] `WaterSurface.useFrame` mirrors the current shader uniform arrays into an in-scope `ElevationInputs` object (reuse the same object frame-to-frame; mutate values in place).
  - [x] The store's registered sampler closes over that object and calls `sampleElevation` on demand.

- [x] Task 3: Wire pad floating in LilyPad.useFrame (AC: #1, #3)
  - [x] In the `resting` branch of `LilyPad.useFrame` (around [LilyPad.tsx:947-970](frontend/src/components/pond/LilyPad.tsx#L947-L970)), read the store's `sampleElevation` imperative handle.
  - [x] Replace the fake sine-bob (`group.position.y = restY + Math.sin(t * 0.5 + seed) * 0.01 * ramp`) with `group.position.y = lerp(currentY, DROP_Y_REST + sampleElevation(posX, posZ), RIDE_LERP)` where `RIDE_LERP ≈ 0.08`.
  - [x] On `→ resting` transitions (e.g. `materializing → resting`, `settling → resting`), ensure the handoff is smooth — the lerp automatically handles this because it starts from whatever y the prior phase left.
  - [x] Do NOT touch any non-resting branch.

- [x] Task 4: Pad tilt toward water gradient (AC: #2)
  - [x] Near the constant block in LilyPad.tsx, add `TILT_DELTA = 0.35`, `TILT_MAX_RADIANS = Math.PI * 15 / 180`, `TILT_LERP = 0.08`.
  - [x] Inside the `resting` branch after the y-write, sample elevation at `(posX + δ, posZ)` and `(posX − δ, posZ)` to derive `dydx`; same for z-axis; clamp each partial to `±TILT_MAX_RADIANS`; lerp `group.rotation.x` and `group.rotation.z` toward `atan(dydx_along_respective_axis)` at `TILT_LERP`.
  - [x] Preserve the existing `group.rotation.y` (the pad's random-on-mount in-plane rotation) — only x/z rotations are touched.
  - [x] Reset tilt on `→ non-resting` transitions (belt-and-suspenders; the existing phase-driven writes to `group.rotation` should already handle this, but verify).

- [x] Task 5: Allocation hygiene in the hot path (AC: #5)
  - [x] `sampleElevation` must not allocate in the body — no `new Vector2`, no array spread, no map/filter. Use for-loops over pre-indexed arrays.
  - [x] `LilyPad.useFrame` must not allocate sample-point vectors per frame — pass raw numbers into `sampleElevation(worldX, worldZ, inputs)`.
  - [x] If tilt requires a THREE.Quaternion for axis-angle application, allocate one per-instance ref (not per-frame).

- [x] Task 6: Parity + ride-above-water unit tests (AC: #4, #6, #7)
  - [x] Unit test in `waterElevation.test.ts`: run a click ripple through a dozen grid points, confirm `sampleElevation` returns values that a hand-derived reference (same formula, plain TS) also returns.
  - [x] Unit test: the pad's ride-y (`DROP_Y_REST + elevation`) is ≥ the raw elevation at any (x, z) under the pad's footprint — verifies the pad never submerges.
  - [x] Optional integration test in `LilyPad.test.tsx`: stub `sampleElevation` with a synthetic elevation, render a pad, assert a `useFrame` tick writes the expected group position y (requires the existing useFrame-mock pattern).

- [x] Task 7: Run tests + typecheck + browser-verify (AC: #6)
  - [x] `npx vitest run` — expect existing 72 tests + new tests all green.
  - [x] `npx tsc -b` — clean.
  - [x] Manual browser check: empty-water click near a pad → pad rides the crest; rapid succession of clicks near many pads → all pads bob; drop a new pad → no float interference during `dropping`/`settling`/`pulsing` phases; complete a pad → no float interference during `completing`.

## Dev Notes

### Why a shared math module instead of per-frame uniform readback

The naive approach ("have LilyPad read shader uniforms directly") couples pads to the shader's memory layout and can't be unit-tested without mocking THREE. Extracting the math into a pure TS function:

- Unit-testable without a GPU / canvas.
- The shader and JS remain in sync via a side-by-side comment + a parity test.
- Future tuning happens in one place, with test coverage catching drift.

The tradeoff is the "mirror" invariant — future edits must touch both the GLSL and the TS. The parity test at AC #7 is the safety net.

### Why tilt based on central differences, not raycasting

Ray-from-pad-normal-into-the-surface could give an exact normal at the sample point, but:
- Requires a BVH or ray-plane intersection per pad per frame (GC-heavy in JS).
- The surface is analytic (we have the function) — sampling two points and taking the difference IS the gradient, no ray needed.

### Why 0.08/frame lerp for ride + tilt

At 60 fps, 0.08/frame gives a half-life of ~8 frames ≈ 130ms, which is the neighborhood where human perception reads as "smooth but responsive." Much higher (e.g. 0.2) reads as "glued to the water"; much lower (e.g. 0.02) reads as "slow to respond to waves" (pads feel heavy). Same rate for ride-y and tilt keeps them feeling unified.

### Handoff from `materializing` / `settling` into `resting`

`materializing` ends at `group.position.y = DROP_Y_REST` (flat). `settling` ends similarly. The first resting frame computes `lerp(DROP_Y_REST, DROP_Y_REST + elevation, 0.08) = DROP_Y_REST + 0.08 * elevation` — a gentle fade-in of the float. No explicit handoff code needed.

### `completing` / `deleting` — why excluded

The dissolve animation writes `group.scale.setScalar(1 - eased)` down to 0. A simultaneous y-float would make the pad "bob as it shrinks" which reads confused. Keeping water-float confined to `resting` means all dynamic effects layer cleanly: completed pads stop floating when they start dissolving, which matches the visual narrative "the pad is leaving the pond."

### Out of scope

- **Pad spin with vortex ripples** — 2.10 tilts but doesn't rotate around the y-axis in response to water motion. Could be a future kick if crits ask for "pads wobble."
- **Collision-style water damping under pads** — real lily pads flatten the water slightly beneath them. This would require the water shader to know about pad positions; intentionally not in scope (keeps WaterSurface stateless w.r.t. pads). Revisit if the "pad riding bright crests" feels unrealistic because the water isn't flattened around them.
- **Other floating creatures** — Epic 7 introduces ambient pond creatures. If they need water-riding too, extend the `sampleElevation` consumer pattern; 2.10 proves the shape.
- **prefers-reduced-motion** — deferred to the pending a11y sweep (in `deferred-work.md`).

## Previous Story Intelligence (from 2.7, 2.8, 2.9)

- **Uniform-write pattern from 2.7/2.8.** The precedent for in-place mutation of shader uniforms (`glowMatRef.current.uniforms.uColor.value.lerp(...)`) is the same pattern 2.10 uses on `group.position.y` and `group.rotation.{x,z}` — compute target once per frame, lerp toward it.
- **`focusStartTimeRef` as the phase-anchor pattern from 2.8.** 2.10's tilt-lerp doesn't need an anchor (the lerp is stateless — it converges toward the current target each frame), but the idea that a phase-specific animation can have its own start-time ref applies if we later want a "fade-in when entering resting" initial ramp on the float.
- **Ripple queue from 2.9.** AC #1 relies on the queue being drained per frame before `sampleElevation` is called — which it is, since `WaterSurface.useFrame` runs first and `LilyPad.useFrame` runs per-pad within the same tick. If ordering ever becomes non-deterministic (separate R3F frames, web workers, etc.), the float could lag one frame behind the visual — acceptable, but note it.
- **`triggerRipple(worldX, worldZ)` coord system from 2.9.** `sampleElevation` accepts world coords (same convention). The plane-rotation Z-flip lives inside `sampleElevation` and the shader — callers don't see it.
- **Test pattern from 2.9.** Store-level unit tests (queue semantics) proved easier than integration tests (JSDOM + R3F). Follow the same pattern for AC #6/#7 — pure-function tests on `waterElevation.ts`.

## Anti-Patterns to Avoid

- **DO NOT have LilyPad read the WaterSurface shader uniforms directly via a parent ref.** It couples pads to the shader and breaks if the shader's uniform shape changes. Use the pure-TS `sampleElevation` module instead.
- **DO NOT allocate `new THREE.Vector2`, `new THREE.Vector3`, or `new THREE.Quaternion` per frame.** The hot path runs 30 pads × 60 fps = 1800 calls/sec; allocations thrash the GC.
- **DO NOT sample elevation for pads in non-resting phases.** Every non-resting phase already owns `group.position.y` / `group.rotation` — sampling on top would conflict with the animation (pulse would "wobble extra," dissolve would "bob as it fades").
- **DO NOT use `Math.sin`-based fake bobs alongside real water sampling.** The existing `0.01 * Math.sin(t * 0.5 + seed)` bob at [LilyPad.tsx:965-969](frontend/src/components/pond/LilyPad.tsx#L965-L969) must be removed, not layered. Real water motion includes the breath term; doubling up reads as jittery.
- **DO NOT clamp the pad's y with `Math.max(elevation, DROP_Y_REST)` as a shortcut for AC #4.** That would produce "glued to waterline on the way up, floats on the way down" — asymmetric, feels broken. The pad must ride both crests AND troughs.
- **DO NOT migrate ripple slot state out of the shader uniforms into the store.** The uniforms are the source of truth for the GPU; adding a parallel zustand slice would require keeping them in sync each frame. The sampler reads the uniforms imperatively (via a closure); it doesn't need a parallel copy.
- **DO NOT change water visuals.** 2.10 makes pads respond to existing water; it doesn't re-tune amplitudes, wavefront speeds, or colors. Any tweak there belongs in a fresh story.

## Git Intelligence

Most relevant recent history:
- `92d6d23` (2026-04-20) — story 2.9 ripple hardening. Established `triggerRipple(worldX, worldZ)` coord convention, queue-and-drain pattern, `uAmbientWavefrontSpeed` uniform. All prerequisites for 2.10.
- `9c1506b` (2026-04-20) — story 2.8 CR follow-ups. Shows the 2.7/2.8 pattern of mutating uniforms and refs inside `useFrame` — same pattern LilyPad will use for position/rotation lerping.
- `f6d6f13` (2026-04-20) — story 2.8 glow implementation. Established `AMBIENT_GLOW_HDR_SCALE`, `focusStartTimeRef` — demonstrates the ref-stamping and HDR-math conventions 2.10 should follow.
- `204c6ce` — realistic ripples commit; the wavefront-masked ripple math that `sampleElevation` will mirror.

Net: 2.10 is a natural next beat after 2.9's queue-and-drain plumbing. The pads were "decoupled spectators" of the water before; 2.10 makes them participants.

## Testing Standards

- Vitest + `@testing-library/react`, `happy-dom` environment.
- `sampleElevation` is pure — test it directly with hardcoded input and expected outputs. No R3F mocking needed.
- LilyPad component test (optional) uses the existing `useFrame` mock pattern; stub `sampleElevation` via the store's imperative handle.
- Parity test: generate a grid of (x, z) at fixed t, pass through `sampleElevation`, compare to a separate reference implementation written inside the test file (same formula, no shared code). This catches algebra errors in either copy.
- `npx vitest run` — expect 72+ existing + new tests passing.
- `npx tsc -b` — clean.

## References

- [Source: `frontend/src/components/pond/WaterSurface.tsx:56-175`] — the shader's vertex elevation math that `sampleElevation` mirrors.
- [Source: `frontend/src/components/pond/WaterSurface.tsx:203-241`] — `createUniforms` for the slot array shapes that `ElevationInputs` mirrors.
- [Source: `frontend/src/components/pond/WaterSurface.tsx:261-325`] — `useFrame` where the in-place `ElevationInputs` object is mutated from uniforms and the sampler is (re-)registered.
- [Source: `frontend/src/components/pond/LilyPad.tsx:947-970`] — resting-phase block; Task 3 replaces the fake sine-bob here.
- [Source: `frontend/src/components/pond/LilyPad.tsx:543-555`] — phase-transition position writes; Task 4 must not conflict with these non-resting phases.
- [Source: `frontend/src/stores/usePondStore.ts:74-93`] — imperative action shape for `triggerRipple` / `drainRipples`; same pattern for `sampleElevation` / `registerElevationSampler`.
- [Source: `_bmad-output/implementation-artifacts/2-9-ripple-system-hardening.md` AC #2, AC #8] — queue shape and `triggerRipple(worldX, worldZ)` coord convention that 2.10 inherits.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context) — BMad dev-story skill, same session that drafted spec and landed 2.8 / 2.9.

### Debug Log References

- Two expected "declared but unused" diagnostics during the two-step wire-up: constants added before their consumers (one in `usePondStore.ts` for the sampler types, one in `LilyPad.tsx` for the TILT_* constants). Both resolved once the consuming code was added.
- One missing-property diagnostic on `usePondStore` when the interface was extended with `sampleElevation` / `registerElevationSampler` / `unregisterElevationSampler` before the implementations landed — resolved by adding the default no-op and register/unregister setters.

### Completion Notes List

- **Task 1 (extract `waterElevation.ts`).** New pure-TS module at `frontend/src/components/pond/waterElevation.ts`. Mirrors the vertex-shader elevation math in `WaterSurface.tsx`: breath + per-slot ambient loop + per-slot click loop + central splash pulse. Plane-local / world coord conversion happens inside the function (callers pass world coords). Top-of-file comment block documents the parity invariant with the shader.
- **Task 2 (sampler API).** Chose option (a) — zustand imperative handle. `usePondStore` gains `sampleElevation: (wx, wz) => number` with a default `() => 0` no-op, plus `registerElevationSampler(fn)` and `unregisterElevationSampler()` actions. `WaterSurface` registers on mount, resets on unmount. The registered function closes over a pre-allocated `ElevationInputs` buffer whose fields are mutated in place by `WaterSurface.useFrame` each tick — zero allocations on the per-frame read path.
- **Task 3 (pad floating).** `LilyPad.useFrame` resting branch replaces the pre-2.10 fake sine bob (`Math.sin(t * 0.5 + seed) * 0.01 * ramp`) with `group.position.y = lerp(position.y, targetY.current + sampleElevation(posX, posZ), RIDE_LERP)`. `targetY.current` still drives the active/completed base height — water motion rides on top. Sampler read via `usePondStore.getState().sampleElevation` (imperative, no subscription, no re-render).
- **Task 4 (pad tilt).** Inside the same resting branch, four additional `sampleElevation` calls at (x±δ, z) and (x, z±δ) with `TILT_DELTA = 0.35` derive `dydx` / `dydz`. Small-angle alignment of pad +Y with water normal (−df/dx, 1, −df/dz): `rotation.z = +atan(dydx)` (x-rise → +x corner up), `rotation.x = −atan(dydz)` (z-rise → +z corner up). Both clamped to ±15° (TILT_MAX_RADIANS) and lerped at `TILT_LERP = 0.08`. A guard block before the phase cascade zeros `rotation.x` / `rotation.z` toward 0 in any non-resting phase so the pad levels off during drop/settle/pulse/dissolve.
- **Task 5 (allocation hygiene).** Verified: (a) `sampleElevation` body uses only scalar math, no `new Vector*` / array spreads / `.map` / `.filter`; (b) LilyPad's resting branch passes raw numbers to 5 sampler calls and operates on scalar returns; (c) `WaterSurface.useFrame` refresh mutates the pre-allocated `ElevationInputs.clickSlots[i]` / `ambientSlots[i]` objects in place. Only two allocations per mount: the `elevationInputsRef` object and the sampler closure (both once).
- **Task 6 (tests).** New `waterElevation.test.ts` with 11 tests across 4 groups: parity with an independent in-file reference implementation (3 tests at grid/mixed/center); world → plane-local flip; stale/inactive slot semantics (6 tests — breath-only, breath at non-zero t, stale-click, stale-ambient, startTime=0, superposition); ride-above-water invariant (1 test verifying `DROP_Y_REST + elevation` always sits `DROP_Y_REST` above the water surface). The parity test intentionally duplicates the formula in a separate reference implementation — the duplication IS the check against silent drift.
- **Task 7 (gates).** 83/83 tests green (72 pre-existing + 11 new). `npx tsc -b` clean. No regressions on LilyPad / PondScene / usePondStore tests. Browser verify to follow in CR.
- **Not sampled in non-resting phases (AC #3).** The sampler call sites are confined to the resting branch. The guard at the top of the phase cascade lerps `rotation.x` / `rotation.z` toward 0 when phase is not resting — the guard itself doesn't call the sampler, so the sampler runs exactly 5 times per resting pad per frame and 0 times per non-resting pad per frame.
- **Parity invariant maintenance.** The top-of-file comment in `waterElevation.ts` documents the "mirror in both places" rule. The first parity-test group catches silent drift if someone edits one side without the other.

### File List

- New: `frontend/src/components/pond/waterElevation.ts` — pure-TS elevation sampler mirroring the vertex shader; exports `sampleElevation`, `ElevationInputs`, `RippleSlot`, `AmbientRippleSlot`.
- New: `frontend/src/components/pond/waterElevation.test.ts` — 11 unit tests (parity with in-file reference, world→local flip, stale-slot semantics, ride-above-water invariant).
- Modified: `frontend/src/stores/usePondStore.ts` — added `sampleElevation`, `registerElevationSampler`, `unregisterElevationSampler` to the PondState interface and implementations.
- Modified: `frontend/src/components/pond/WaterSurface.tsx` — imports from `waterElevation`, pre-allocated `elevationInputsRef`, refresh block in useFrame that mutates the buffer from shader uniforms each tick, `useEffect` that registers/unregisters the sampler on mount/unmount.
- Modified: `frontend/src/components/pond/LilyPad.tsx` — constants `RIDE_LERP` / `TILT_DELTA` / `TILT_MAX_RADIANS` / `TILT_LERP`; tilt-zero guard block before the phase cascade; resting branch replaces fake sine bob with water-elevation ride + gradient tilt.

### Change Log

- 2026-04-20: All 7 tasks implemented; 83/83 tests green; `tsc -b` clean; story moved ready-for-dev → in-progress → review in a single session.
- 2026-04-20: Code review complete. Acceptance Auditor 0 findings. Blind Hunter + Edge Case Hunter surfaced 4 real issues + 11 false positives. All 4 patches applied: (1) buffer refresh moved AFTER ripple drain in `WaterSurface.useFrame`; (2) LilyPad sampler now uses `group.position.x/z` instead of the anchor so ride/tilt track the drifted position; (3) `position.y` seeded to `targetY + elevation` on all four transitions into `resting` (materializing, pulsing, deleting-cancel, completing-cancel); (4) tautological AC #4 test replaced with 3 meaningful invariant tests (inside-crest margin, trough sign-check, flat-water baseline). 3 defers logged: pond-edge phantom-water tilt, frame-ordering invariant documentation, splash pre-bob (parity-correct).
- 2026-04-20: AC #3 amendment — user flagged during CR that new pads emit an impact ripple at drop-end but don't visibly bob on it (they just ran through their scripted settling-bounce + scale-pulse and landed). Amendment: water-riding extended to `settling` (elevation added on top of the landing bounce) and `pulsing` (elevation written as `DROP_Y_REST + elevation` while the scale pulse plays). Tilt remains resting-only. Dropping/completing/deleting/materializing/terminal phases remain un-sampled per the original AC #3. New pads now visibly bob on the ripple they just emitted.
- 85/85 tests green; `tsc -b` clean. Status review → done.

### Review Findings (code review session 2026-04-20)

Adversarial review of commit `d5b2d03` via Blind Hunter + Edge Case Hunter + Acceptance Auditor layers. **Acceptance Auditor: 0 violations / 0 deviations / 0 missing / 0 contradictions — all 7 ACs pass in isolation.** Blind Hunter + Edge Case Hunter surfaced 4 real issues (3 AC #4-adjacent correctness gaps + 1 tautological test) and a pile of false positives.

- [x] [Review][Patch] **Buffer refresh runs BEFORE the same-frame ripple drain → one-frame delay on every new click ripple reaching LilyPads.**
  - **Location:** [WaterSurface.tsx:330-367 (refresh) vs :378-392 (drain)](frontend/src/components/pond/WaterSurface.tsx#L330-L392)
  - **What happens:** The elevation-buffer refresh iterates uniform arrays BEFORE the drain loop writes newly-queued ripples into those same uniforms. Any `triggerRipple` call landing this tick is visible to the shader next frame — but the JS buffer the LilyPads read (same tick) still reflects pre-drain state. Pads respond to brand-new ripples one frame late.
  - **Fix:** swap the two blocks — drain first, refresh second. Single-block reorder.

- [x] [Review][Patch] **Sampler anchor is `(posX, posZ)` but the pad's actual visual position drifts up to ±0.08 via the resting-drift sinusoid.**
  - **Location:** [LilyPad.tsx:973-974 (drift) vs :993-1015 (sampler calls)](frontend/src/components/pond/LilyPad.tsx#L973-L1015)
  - **What happens:** `group.position.x/z` are written as `posX + drift / posZ + drift` each frame, but `sampleElevation(posX, posZ)` uses the fixed anchor. The pad floats at the elevation for (posX, posZ) while visually positioned at (posX + 0.08, posZ + 0.06) → a small phase error in the gradient direction, most visible when a steep crest front is passing at angle ≠ 90° to the drift axis.
  - **Fix:** replace the 5 `samplePond(posX…, posZ…)` calls with `samplePond(group.position.x…, group.position.z…)`. The drift writes already landed on lines 973-974; order is correct.

- [x] [Review][Patch] **AC #4 gap at the `pulsing → resting` transition: pad teleports to `DROP_Y_REST` and then lerps UP toward `targetY + elevation` over ~130ms, so a ripple crest at the pad's position during that window is ABOVE the pad for several frames.**
  - **Location:** [LilyPad.tsx:1141-1150 (pulsing → resting exit)](frontend/src/components/pond/LilyPad.tsx#L1141-L1150) + [:994-999 (first resting tick)](frontend/src/components/pond/LilyPad.tsx#L994-L999)
  - **What happens:** At the last pulsing frame `group.position.y` is still `DROP_Y_REST` (pulsing never wrote to y). On first resting tick the lerp toward `targetY + elevation` starts from `DROP_Y_REST`, converging at 0.08/frame. If the ambient/click ripples happen to crest at the pad's position during the handoff (typical — a creation ripple fires right at the pad's own position), the water is above the pad for ~8 frames. Same-day AC #4 violation in a specific transition window the spec's test doesn't cover.
  - **Fix:** seed `group.position.y` to `targetY.current + sampleElevation(posX, posZ)` in the `pulsing → resting` exit block (also applies to `materializing → resting` and any other entry into `resting`). Makes the handoff instant instead of lerp-from-zero-offset.

- [x] [Review][Patch] **AC #4 test is tautological — `waterY - padY` where `padY := DROP_Y_REST + waterY` is algebraically `-DROP_Y_REST` always. The test cannot fail and proves nothing about `sampleElevation`.**
  - **Location:** [waterElevation.test.ts:269-297](frontend/src/components/pond/waterElevation.test.ts#L269-L297)
  - **What happens:** The test computes `padY = DROP_Y_REST + sampleElevation(x, z)` then asserts `sampleElevation(x, z) - padY ≈ -DROP_Y_REST`. By construction, `-DROP_Y_REST` at every sample. The invariant it "proves" is `x - (c + x) = -c` — arithmetic, not behavior.
  - **Fix:** rewrite to test a meaningful invariant — e.g. at steady-state (no lerp-lag) the pad sits at a fixed offset above the water regardless of ripple amplitude, OR with the EC-H2 patch in place, assert that at `→ resting` transitions the initial `group.position.y` seed matches `targetY + elevation` so no below-water frames occur.

- [x] [Review][Defer] **Pad-tilt gradient is evaluated outside the visible pond edge at extreme `posX`/`posZ`.** `sampleElevation` has no bounds — samples at `(posX ± 0.35, posZ ± 0.35)` return valid elevation even if the fragment shader's `edgeFade` has faded the water to black at that point. Pads within `TILT_DELTA` of the 20-unit pond edge tilt toward invisible "phantom water." Rare: the pond is 40×40 at most (`AMBIENT_RIPPLE_RADIUS`) and pads typically sit near center. Fix would duplicate the fragment-shader fade in the sampler.

- [x] [Review][Defer] **Frame-ordering invariant between `WaterSurface.useFrame` (refreshes buffer) and `LilyPad.useFrame` (reads buffer) is not asserted.** Currently stable because `<WaterSurface />` is rendered before `renderTodos.map` in `PondScene`, so R3F subscribes WaterSurface's tick first. If anyone reorders the JSX or sets a `priority` on either, LilyPads would silently read a 1-frame-stale buffer. Comment-only fix: add an ordering note on both `useFrame` calls; OR explicit `priority` to lock it.

- [x] [Review][Defer] **Splash term has no leading-edge gating — its Gaussian contributes non-zero elevation at pads far from the impact center BEFORE the wavefront arrives.** At dropDist=2, `exp(-3.2) ≈ 0.04` × amp (up to 0.7) × 1.2 = ~0.034 world units of elevation at t=0 of a click, while the real wavefront takes ~0.47s to reach that distance. Pads at intermediate range visually "pre-bob" before the ring arrives. Matches shader intent (parity-correct), but if "pre-bob" ever becomes a reported UX bug, add a leading-edge mask to the splash in both shader and sampler.

**Summary:** 0 decision-needed, 4 patches (all applying the fix directly restores the AC #4 invariant that the current test can't detect), 3 defers, 11 dismissed as noise / false positives after verification:

- Gradient direction inverted by world→local flip — math verified correct (world→local flip means `dydz` IS the world-Z derivative, which is exactly what the tilt formula needs).
- Stale `samplePond` cached across unmount — handle is read per-frame (not at mount), auto-heals on next frame.
- Non-resting tilt-zero runs for `completed`/`deleted` phases — runs ~8 more lerp-toward-0 writes on a pad about to unmount; harmless cost vs the early-return optimization which protects the expensive work below.
- Uniform array length assumption — invariant holds by construction in `createUniforms`.
- Unregister doesn't check identity / StrictMode-unsafe sampler swap — no observable impact (no frames run between unmount and remount effects in practice).
- Noop closure recreated on each unregister — cosmetic.
- Elapsed-edge semantics (`elapsed <= 0` treated as inactive) — matches shader `<=` check; JS/GLSL in parity.
- `wavefrontOverride > 0` sentinel — design choice, current callers use positive values.
- Tilt guard runs before phase transitions resolve — sequence verified correct (the snapshot on line 706 is the phase at useFrame entry; phase cascade dispatches on the same snapshot; transitions to new phases take effect next tick).
