# Story 2.9: Ripple System Hardening

Status: ready-for-dev

> **Scope note:** 2.9 is a tech-debt / hardening spillover story — not part of the original Epic 2 plan in `epics.md`. Consolidates 10 deferred items accumulated across the 2.4 / 2.5 / 2.6 code reviews (see `_bmad-output/implementation-artifacts/deferred-work.md`). All items touch the ripple system (`WaterSurface.tsx` + `usePondStore.triggerRipple` + callers). Grouped here so one coherent diff fixes the whole cluster rather than spreading fixes across future feature stories where they'd be out of context. No new user-facing features; success is "same visual feel, fewer latent bugs, less fragile code."

## Story

As a developer working on the pond,
I want the ripple system's latent bugs, fragile idioms, and single-point-of-coalesce hazards hardened in one focused pass —
so that future feature work on the pond (Epic 4 clustering, Epic 5 search, Epic 7 ecosystem) can add ripple triggers without re-discovering the same trapdoors, and so that rapid user input / pathological timing doesn't produce visible artifacts.

## Acceptance Criteria

> _Items are ordered by user-visibility: ACs #1–#4 are visible glitches; #5–#8 are latent / fragility fixes; #9–#10 are capacity tuning. All 10 track directly to entries under `deferred-work.md` § "code review of story 2-6-loading-and-error-states" and § "2-5-deletion-via-popup-red-flash-and-dissolve"._

1. **Given** the user clicks empty water or a pad triggers a click-ripple, **When** the click ripple renders, **Then** the expanding wavefront's leading edge (`wavefrontSpeed = 7.0`) moves at the same phase velocity as the sinusoidal wave it gates (`speed / freq = 5.5 / 1.3 ≈ 4.23`). Either (a) drop the explicit `wavefrontSpeed` argument and derive it inside `ripple()` as `speed / freq`, or (b) re-tune `speed` / `freq` so the ratio equals 7.0 while keeping the "punchy click" character. No frame where the leading edge visibly races ahead of the wave crest.

2. **Given** two `triggerRipple(x, z)` calls land in the same JavaScript tick (e.g. two pads complete on the same animation frame, or a rapid double-click), **When** the next `useFrame` tick runs, **Then** BOTH ripples are applied to distinct click slots. The current store shape (`dropRipple: RippleEvent | null` — a single slot) collapses simultaneous calls into one. Fix: replace the single field with either a bounded queue (`dropRipples: RippleEvent[]` drained each useFrame) or have `triggerRipple` write directly to the shader uniforms via a scene-level imperative callback (registered at `WaterSurface` mount). Either shape is acceptable as long as the "two calls same tick = two ripples" invariant is verifiable.

3. **Given** the Action Popup is open (`activePopupTodoId !== null`), **When** the user clicks on empty water, **Then** `handleWaterClick` closes the popup instead of (or in addition to) firing a ripple. Current behavior: `WaterSurface.handleWaterClick` calls `triggerRipple` unconditionally, leaving the popup open while the water ripples — confusing interaction. Fix options: (a) have `handleWaterClick` read `activePopupTodoId` from the store and call `closePopup()` first, suppressing the ripple; (b) fire both (close + ripple) so the click isn't "free". Pick one; document why.

4. **Given** a fresh browser load and the `AMBIENT_SKIP_PROBABILITY = 0.2` skip logic, **When** the first scheduled ambient ripple tick fires at `AMBIENT_RIPPLE_FIRST_DELAY_MS = 1200` ms, **Then** a ripple is guaranteed to queue (skip-probability does not apply to the first ripple). Current code: `schedule(AMBIENT_RIPPLE_FIRST_DELAY_MS)` calls `queueOne` only after the 20% skip check; in pathological RNG sequences the pond can look frozen for up to `AMBIENT_RIPPLE_FIRST_DELAY_MS + AMBIENT_RIPPLE_MAX_DELAY_MS ≈ 8.2s` after load. Fix: guarantee the first scheduled tick fires a ripple (either by skipping the probability check on the initial call, or by force-queuing a ripple on `WaterSurface` mount before the scheduler starts).

5. **Given** the shader uniform `uTime` is written every frame from `state.clock.elapsedTime` (R3F clock), **When** `triggerRipple` stamps `dropRipple.time`, **Then** the timestamp is derived from the same R3F clock (not `performance.now() / 1000`). Currently the store uses `performance.now() / 1000` as the change-detection marker — it works today because `lastRippleRef` only compares for `!==`, not arithmetic — but mixing two monotonic time sources in the ripple code path is a latent footgun (any future caller that does math on `dropRipple.time - uTime` will produce garbage). Fix: make `triggerRipple` accept an `elapsedTime` argument (threaded from the caller's `useFrame`) or expose a scene-level registration so the stamping happens inside useFrame. Document the decision in a comment on `triggerRipple`.

6. **Given** the GLSL shader references `AMBIENT_WAVEFRONT_SPEED`, **When** the shader is compiled, **Then** the value arrives via a proper `uniform float uAmbientWavefrontSpeed` rather than a JS template-literal injection (`${AMBIENT_WAVEFRONT_SPEED.toFixed(2)}`). Fix: add a uniform, initialize it in `createUniforms`, read it in the shader. The template-literal idiom is fragile — it truncates precision via `toFixed(2)` and can't be changed at runtime. `AMBIENT_SLOTS` and `CLICK_SLOTS` stay as `#define`s (they control array sizes, which must be compile-time constants); only the numeric value migrates to a uniform.

7. **Given** the `WaterSurface` component unmounts (e.g. StrictMode dev double-invocation, navigation away, HMR), **When** cleanup runs, **Then** `pendingAmbientRef.current` is cleared to `null` alongside the `clearTimeout` call. Currently the cleanup only clears the timeout; a pending ambient queued but not yet consumed by `useFrame` stays in the ref. The ref is per-instance so this is theoretical today, but if anyone refactors the scheduler to a shared/module-scope ref the leak becomes real.

8. **Given** the story 2.7 / 2.6 fix to mirror world-Z into local-Y at uniform-write time (`centers[slot].set(x, -z)`), **When** a new caller of `triggerRipple(x, z)` is added (e.g. Epic 7 ecosystem creatures splashing), **Then** the caller's documentation-obvious expectation is "pass world (x, z)". Current `triggerRipple` signature doesn't enforce this. Fix: rename the store action parameters to `(worldX, worldZ)` and add a JSDoc comment on the type / action that names the coordinate system explicitly. Alternatively, move the Z-flip into the store action so the uniform write doesn't need to know about it. Pick one.

9. **Given** click ripples at sustained > 2 Hz (CLICK_SLOTS = 8, 4 s visibility window), **When** the 9th-plus-within-4s click lands, **Then** either (a) the round-robin evicts the oldest in-flight ripple with a smoothly faded-out slot (not a sudden disappear) OR (b) CLICK_SLOTS is bumped to a value that absorbs the maximum realistic click rate (document the rate assumption). Accepted status-quo: the current behavior is a hard overwrite — ACs #9 defers this to a comment-only change UNLESS evidence of user-visible eviction exists. If kept as-is, add a comment in `WaterSurface.tsx` recording the 2 Hz cap.

10. **Given** ambient ripples (AMBIENT_SLOTS = 3, up to 14 s visibility, 2.5–7 s cadence), **When** the scheduler fires faster than the slowest-decaying ripple fades, **Then** the overwrite of an in-flight ambient slot is either (a) avoided by raising AMBIENT_SLOTS to absorb the worst case, or (b) documented with the cap and expected eviction rate. Math: 3 slots × 14 s = 42 slot-seconds; 2.5 s cadence × 1 (no skips) = 16.8 fires/42s → every 2.5 s the oldest slot gets overwritten. If kept as-is, add a comment quantifying the eviction rate; if bumped, raise AMBIENT_SLOTS and verify bundle-size / shader uniform limits.

11. **Given** the full existing test suite runs after this change, **When** all tests finish, **Then** every existing test remains green (69/69). No new integration tests required unless AC #2 (slot-coalesce) needs one — in that case, a unit test against `triggerRipple`'s new shape (e.g. queue length grows on rapid calls) is acceptable.

## Tasks / Subtasks

- [ ] Task 1: Click-ripple wavefront / wave velocity alignment (AC: #1)
  - [ ] Inspect `ripple()` call at `WaterSurface.tsx:151-159` — the explicit `wavefrontSpeed=7.0` vs derived `speed/freq=4.23`.
  - [ ] Decide on Fix (a) derive-from-speed-freq vs Fix (b) retune-constants. Recommendation: (a) — keeps the visual tuning that was already approved.
  - [ ] If (a): drop the `wavefrontSpeed` parameter from the shader `ripple()` function and compute `front = elapsed * speed / freq` inline. This also simplifies AC #6's uniform migration.
  - [ ] Browser-verify click ripples visually match the existing "punchy" character.

- [ ] Task 2: Replace single-slot `dropRipple` with a queue / imperative hook (AC: #2)
  - [ ] Decide on shape: (a) `dropRipples: RippleEvent[]` with `triggerRipple` pushing and `useFrame` draining; OR (b) `WaterSurface` registers an imperative `(x, z) => void` on mount via a store action, and `triggerRipple` calls the registered fn directly (bypasses zustand state change entirely).
  - [ ] Update `usePondStore.triggerRipple` accordingly.
  - [ ] Update `WaterSurface.useFrame` to drain the queue (cap at CLICK_SLOTS per tick to avoid pathological bursts).
  - [ ] Update `usePondStore.test.ts` to reflect the new shape.
  - [ ] Add a unit test: two `triggerRipple` calls in the same tick result in two drain operations.

- [ ] Task 3: Popup-guard for empty-water click (AC: #3)
  - [ ] Pick one of the two behaviors (close-only vs close-and-ripple). Default recommendation: close-only — clicking water with popup open reads as "dismiss", not "ripple-and-dismiss".
  - [ ] Modify `WaterSurface.handleWaterClick` to read `activePopupTodoId` from the store. If set, call `closePopup()` and return; otherwise fire `triggerRipple` as today.
  - [ ] Add or update test in `WaterSurface.test.tsx` / `PondScene.test.tsx` verifying the popup-open guard.

- [ ] Task 4: Ambient skip-probability only from the SECOND tick onward (AC: #4)
  - [ ] Modify the `schedule` inner fn in `WaterSurface.useEffect` so the first scheduled fire bypasses the skip check — the pond always has a first-ripple guarantee.
  - [ ] Alternative: force-queue an ambient ripple on mount before `schedule` starts. Either is fine.

- [ ] Task 5: Unify ripple timestamping on the R3F clock (AC: #5)
  - [ ] Remove `performance.now() / 1000` from `usePondStore.triggerRipple`. The change-detection marker becomes unnecessary if Task 2 moves to a queue/imperative shape (the queue length itself is the signal).
  - [ ] If `dropRipple.time` is still needed by any consumer, source it from the R3F clock (threaded through, or stamped inside `WaterSurface.useFrame` when the queue is drained).

- [ ] Task 6: Migrate `AMBIENT_WAVEFRONT_SPEED` to a `uniform float` (AC: #6)
  - [ ] Add `uAmbientWavefrontSpeed` to `createUniforms` initialized from the TS constant.
  - [ ] Replace the `${…toFixed(2)}` template injection in the vertex shader with `uAmbientWavefrontSpeed`.
  - [ ] Leave `AMBIENT_SLOTS` / `CLICK_SLOTS` as `#define`s (compile-time array sizes — cannot migrate).

- [ ] Task 7: Cleanup `pendingAmbientRef` on unmount (AC: #7)
  - [ ] Add `pendingAmbientRef.current = null;` to the `WaterSurface.useEffect` cleanup, next to `clearTimeout`.

- [ ] Task 8: Coordinate-system naming / documentation for `triggerRipple` (AC: #8)
  - [ ] Rename `triggerRipple(x, z)` → `triggerRipple(worldX, worldZ)` OR move the Z-flip from `WaterSurface.useFrame` into `triggerRipple` itself. Pick the simpler one.
  - [ ] Update the JSDoc on the store action with a one-line coordinate-system note.
  - [ ] Update all callers (grep `triggerRipple` — likely `LilyPad.tsx`, `PondScene.tsx`, `WaterSurface.tsx`).

- [ ] Task 9: Click-slot eviction comment or bump (AC: #9)
  - [ ] Default: comment-only. Add a comment near `CLICK_SLOTS = 8` recording "eviction kicks in above ~2 Hz sustained click rate; no observed UX complaints; raise if user-visible eviction reports land."
  - [ ] If AC #9 evidence surfaces during browser-verification, bump to 12 and re-verify uniform count stays under the shader limit.

- [ ] Task 10: Ambient-slot eviction comment or bump (AC: #10)
  - [ ] Default: comment-only. Add a comment near `AMBIENT_SLOTS = 3` recording "eviction rate ≈ 1 slot / 2.5s at min cadence; 3-slot capacity accepts the eviction because ambient ripples are non-semantic (no user intent tied to a specific ripple)."
  - [ ] If verification shows visible "stutter" on ambient ripples, bump to 5 and adjust.

- [ ] Task 11: Run tests + typecheck + browser-verify (AC: #11)
  - [ ] `npx vitest run` — all tests pass.
  - [ ] `npx tsc -b` — clean.
  - [ ] Manual browser check: empty-water click rip­ples, rapid complete/delete pairs on the same frame, popup + empty-water click, cold-load first ambient ripple appears ≤ 1.5s after mount.

## Dev Notes

### Surface area

All changes are confined to:
- `frontend/src/components/pond/WaterSurface.tsx` — shader + `useFrame` + scheduler
- `frontend/src/stores/usePondStore.ts` — `triggerRipple` action + `RippleEvent` shape
- `frontend/src/stores/usePondStore.test.ts` — shape change
- Call sites of `triggerRipple` — minor (rename) or none

No changes to `LilyPad.tsx` beyond possibly renaming `triggerRipple` argument labels if Task 8 chooses the rename route.

### Why consolidate these 10 items

Scattering these across future feature stories has two costs: (a) each fix needs its own context-gathering pass for ripple math that isn't obvious; (b) Epic 4 / 5 / 7 authors will find the trapdoors the hard way. Consolidating them into one diff means one round of shader-math verification and one round of browser testing covers all 10 at once.

### Out of scope

- **Ripple visuals / tuning** — current amplitudes, decay rates, wavelengths, and scheduler cadences are user-approved. This story changes SHAPE and ROBUSTNESS, not FEEL. If any visual change is needed to land AC #1 (wavefront/wave alignment), document it inline and call it out during review — don't silently re-tune.
- **New ripple triggers** — Epic 7 creatures, Epic 5 search "submerge" effect, Epic 4 cluster-move are all future callers. This story only hardens the existing pipe.
- **Ripple interaction with bloom / glow** — the Bloom post-process and per-pad glow (story 2.8) are orthogonal to ripple shader math.

### Design decisions that need picking

Tasks 2, 3, and 8 each have an A / B choice. The recommended defaults are called out in the task description; any deviation should be flagged in the PR description so review can catch ripple-semantic surprises early.

## Previous Story Intelligence (from Stories 1.2, 2.4, 2.5, 2.6)

- **Ripple slot architecture established in 1.2.** Per-slot uniform arrays (`uDropCenter[CLICK_SLOTS]`, etc.) with round-robin indexing came in with the initial pond; the shader does a per-slot accumulation loop. Keep the per-slot contract — 2.9 changes the JS-side delivery mechanism, not the shader-side slot loop.
- **Z-flip at uniform write time added in 2.6.** `triggerRipple(world-x, world-z)` → `centers[slot].set(x, -z)` handles the -90° plane rotation. AC #8 considers moving this to the store action; whichever side owns the flip, it must run exactly once.
- **`pendingAmbientRef` (scheduler → useFrame handoff) pattern from 1.2.** setTimeout schedules ambients asynchronously but only useFrame writes shader uniforms. 2.9 extends the same handoff pattern to click ripples (Task 2 option a).
- **R3F clock as the canonical time source from 2.4.** All story-2.x animation sequences use `state.clock.elapsedTime`. The ripple code's use of `performance.now()` predates this convention and is the only remaining wall-clock usage in the pond rendering path.
- **Test suite pattern from 2.4/2.5/2.6.** `useFrame` and `useThree` are mocked; new tests for AC #2 should follow the `usePondStore.test.ts` unit-test style rather than the JSDOM-rendered `WaterSurface.test.tsx` style, since the changes are in the store action.

## Anti-Patterns to Avoid

- **DO NOT re-tune the visual feel.** Amplitudes, decay rates, wavelengths, scheduler cadences, and slot counts are user-approved. If a shape change (Task 1, Task 2) causes a visual regression, fix the new code to match the old feel — don't retro-tune the constants to "look fine either way."
- **DO NOT add a new postprocess pass or water-shader uniform beyond `uAmbientWavefrontSpeed`.** The shader is tight; adding uniforms costs both shader-compilation-time overhead and a longer diff that's harder to review.
- **DO NOT migrate slot counts (`AMBIENT_SLOTS`, `CLICK_SLOTS`) to uniforms.** They're array sizes; array sizes must be compile-time constants in GLSL.
- **DO NOT replace the setTimeout scheduler with a useFrame-driven schedule.** The current approach keeps wall-clock scheduling off the render loop — switching to useFrame-scheduled ambients couples the cadence to frame rate and breaks on tab-throttling.
- **DO NOT add a `lastRippleRef` equivalent to the new queue shape (Task 2).** If the queue drains on every useFrame the "has this changed" marker becomes unnecessary — that's the point of the shape change.
- **DO NOT gate the popup-close on the ripple amplitude or any shader-math value (Task 3).** The popup-close decision is UX state, not rendering state.
- **DO NOT break the `<WaterSurface>` test passthrough pattern.** `shaderMaterial` / `planeGeometry` are already stubbed; new uniforms should pass through vitest without new mocks.

## Git Intelligence

Relevant recent history:
- `9c1506b` (2026-04-20) — story 2.8 CR follow-ups. Touched `ActionPopup.tsx`'s wheel-forwarding, unrelated to ripple code path.
- `204c6ce` (pre-2.6) — "realistic ripples — expanding wavefronts, punchy clicks, overlapping ambients" — this is the commit that introduced CLICK_SLOTS, AMBIENT_SLOTS, and the current wavefront-mask shader. ACs #1, #6, #9, #10 all touch code from this commit.
- `ff6c25a` — "flip Z in uDropCenter — ripples now appear at the actual click point" — the Z-flip behind AC #8.
- `7eba72e` — "ripple the water at the click point on empty-water clicks" — introduced the `handleWaterClick` → `triggerRipple` path that AC #3 hardens.
- `f385146` — "sparse ambient ripples — one every 4-8s, random pos, fades on its own" — the scheduler that ACs #4, #7 fix.

Net: the ripple system was built in a tight sequence of commits during stories 1.2 and 2.6. All the deferred items trace back to those commits; nothing has meaningfully touched this code since, so 2.9 is a clean, focused pass.

## Testing Standards

- Vitest + `@testing-library/react`, `happy-dom` environment.
- Mock R3F `useFrame` / `useThree`; existing `<Bloom>` / `<EffectComposer>` passthroughs apply.
- AC #2 unit test: `usePondStore.test.ts` — call `triggerRipple` twice synchronously, assert queue length / registered-callback was called twice.
- AC #3 test (optional): in `PondScene.test.tsx` or a new `WaterSurface.test.tsx`, simulate `activePopupTodoId !== null` and verify `handleWaterClick` behavior.
- No new useFrame clock-advancing tests required for ACs #1, #4, #6, #7, #9, #10 — these are shader-math / scheduler / uniform-shape changes whose correctness is better verified in a browser.
- `npx vitest run` — all 69 existing tests remain green.
- `npx tsc -b` — clean.

## References

- [Source: `frontend/src/components/pond/WaterSurface.tsx:11-54`] — ripple constants and slot counts.
- [Source: `frontend/src/components/pond/WaterSurface.tsx:79-96`] — `ripple()` shader function; AC #1 / #6 both modify it.
- [Source: `frontend/src/components/pond/WaterSurface.tsx:120-124`] — `AMBIENT_WAVEFRONT_SPEED` template-literal injection (AC #6).
- [Source: `frontend/src/components/pond/WaterSurface.tsx:142-169`] — per-slot click-ripple shader loop with the `wavefrontSpeed=7.0` mismatch (AC #1).
- [Source: `frontend/src/components/pond/WaterSurface.tsx:261-311`] — `useFrame` ripple/ambient uniform writes (ACs #2, #5, #8).
- [Source: `frontend/src/components/pond/WaterSurface.tsx:317-349`] — `useEffect` ambient scheduler with the skip-first-ripple issue (AC #4) and the cleanup that misses `pendingAmbientRef` (AC #7).
- [Source: `frontend/src/components/pond/WaterSurface.tsx:357-359`] — `handleWaterClick` → `triggerRipple` path (AC #3).
- [Source: `frontend/src/stores/usePondStore.ts:74, 109-110`] — `triggerRipple` action signature + wall-clock stamping (ACs #2, #5, #8).
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md` § "code review of story 2-6-loading-and-error-states (2026-04-17)"] — 10 of the 11 deferred items consolidated here.
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md` § "code review of story 2-5-deletion-via-popup-red-flash-and-dissolve (2026-04-17)"] — the `uDropCenter` collision entry is a dupe of the single-slot-coalesce (AC #2).

## Dev Agent Record

### Agent Model Used

_To be filled by dev agent on implementation start._

### Debug Log References

_To be filled during implementation._

### Completion Notes List

_To be filled during implementation._

### File List

_To be filled during implementation — expected: `frontend/src/components/pond/WaterSurface.tsx`, `frontend/src/stores/usePondStore.ts`, `frontend/src/stores/usePondStore.test.ts`, possibly `frontend/src/components/pond/PondScene.tsx` (if Task 8 rename touches it), plus one new or extended test file for AC #2 / #3._

### Change Log

_To be filled during implementation._
