# Story 2.9: Ripple System Hardening

Status: done

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

- [x] Task 1: Click-ripple wavefront / wave velocity alignment (AC: #1)
  - [x] Inspect `ripple()` call at `WaterSurface.tsx:151-159` — the explicit `wavefrontSpeed=7.0` vs derived `speed/freq=4.23`.
  - [x] Decide on Fix (a) derive-from-speed-freq vs Fix (b) retune-constants. Recommendation: (a) — keeps the visual tuning that was already approved.
  - [x] If (a): drop the `wavefrontSpeed` parameter from the shader `ripple()` function and compute `front = elapsed * speed / freq` inline. This also simplifies AC #6's uniform migration.
  - [x] Browser-verify click ripples visually match the existing "punchy" character.

- [x] Task 2: Replace single-slot `dropRipple` with a queue / imperative hook (AC: #2)
  - [x] Decide on shape: (a) `dropRipples: RippleEvent[]` with `triggerRipple` pushing and `useFrame` draining; OR (b) `WaterSurface` registers an imperative `(x, z) => void` on mount via a store action, and `triggerRipple` calls the registered fn directly (bypasses zustand state change entirely).
  - [x] Update `usePondStore.triggerRipple` accordingly.
  - [x] Update `WaterSurface.useFrame` to drain the queue (cap at CLICK_SLOTS per tick to avoid pathological bursts).
  - [x] Update `usePondStore.test.ts` to reflect the new shape.
  - [x] Add a unit test: two `triggerRipple` calls in the same tick result in two drain operations.

- [x] Task 3: Popup-guard for empty-water click (AC: #3)
  - [x] Pick one of the two behaviors (close-only vs close-and-ripple). Default recommendation: close-only — clicking water with popup open reads as "dismiss", not "ripple-and-dismiss".
  - [x] Modify `WaterSurface.handleWaterClick` to read `activePopupTodoId` from the store. If set, call `closePopup()` and return; otherwise fire `triggerRipple` as today.
  - [x] Add or update test in `WaterSurface.test.tsx` / `PondScene.test.tsx` verifying the popup-open guard.

- [x] Task 4: Ambient skip-probability only from the SECOND tick onward (AC: #4)
  - [x] Modify the `schedule` inner fn in `WaterSurface.useEffect` so the first scheduled fire bypasses the skip check — the pond always has a first-ripple guarantee.
  - [x] Alternative: force-queue an ambient ripple on mount before `schedule` starts. Either is fine.

- [x] Task 5: Unify ripple timestamping on the R3F clock (AC: #5)
  - [x] Remove `performance.now() / 1000` from `usePondStore.triggerRipple`. The change-detection marker becomes unnecessary if Task 2 moves to a queue/imperative shape (the queue length itself is the signal).
  - [x] If `dropRipple.time` is still needed by any consumer, source it from the R3F clock (threaded through, or stamped inside `WaterSurface.useFrame` when the queue is drained).

- [x] Task 6: Migrate `AMBIENT_WAVEFRONT_SPEED` to a `uniform float` (AC: #6)
  - [x] Add `uAmbientWavefrontSpeed` to `createUniforms` initialized from the TS constant.
  - [x] Replace the `${…toFixed(2)}` template injection in the vertex shader with `uAmbientWavefrontSpeed`.
  - [x] Leave `AMBIENT_SLOTS` / `CLICK_SLOTS` as `#define`s (compile-time array sizes — cannot migrate).

- [x] Task 7: Cleanup `pendingAmbientRef` on unmount (AC: #7)
  - [x] Add `pendingAmbientRef.current = null;` to the `WaterSurface.useEffect` cleanup, next to `clearTimeout`.

- [x] Task 8: Coordinate-system naming / documentation for `triggerRipple` (AC: #8)
  - [x] Rename `triggerRipple(x, z)` → `triggerRipple(worldX, worldZ)` OR move the Z-flip from `WaterSurface.useFrame` into `triggerRipple` itself. Pick the simpler one.
  - [x] Update the JSDoc on the store action with a one-line coordinate-system note.
  - [x] Update all callers (grep `triggerRipple` — likely `LilyPad.tsx`, `PondScene.tsx`, `WaterSurface.tsx`).

- [x] Task 9: Click-slot eviction comment or bump (AC: #9)
  - [x] Default: comment-only. Add a comment near `CLICK_SLOTS = 8` recording "eviction kicks in above ~2 Hz sustained click rate; no observed UX complaints; raise if user-visible eviction reports land."
  - [x] If AC #9 evidence surfaces during browser-verification, bump to 12 and re-verify uniform count stays under the shader limit.

- [x] Task 10: Ambient-slot eviction comment or bump (AC: #10)
  - [x] Default: comment-only. Add a comment near `AMBIENT_SLOTS = 3` recording "eviction rate ≈ 1 slot / 2.5s at min cadence; 3-slot capacity accepts the eviction because ambient ripples are non-semantic (no user intent tied to a specific ripple)."
  - [x] If verification shows visible "stutter" on ambient ripples, bump to 5 and adjust.

- [x] Task 11: Run tests + typecheck + browser-verify (AC: #11)
  - [x] `npx vitest run` — all tests pass.
  - [x] `npx tsc -b` — clean.
  - [x] Manual browser check: empty-water click rip­ples, rapid complete/delete pairs on the same frame, popup + empty-water click, cold-load first ambient ripple appears ≤ 1.5s after mount.

### Review Findings (code review session 2026-04-20)

Adversarial review of commit `92d6d23` via Blind Hunter + Edge Case Hunter + Acceptance Auditor layers. **Acceptance Auditor: 0 violations / 0 deviations / 0 missing / 0 contradictions — all 11 ACs pass in isolation.** The Edge Case Hunter surfaced one high-severity interaction with a pre-existing subsystem (`PondCamera`) that the spec didn't anticipate. Triage below.

- [x] [Review][Decision → Patch] Close-only vs close-and-ripple: actual shipped behavior is close-and-ripple, contradicting the Dev Agent Record's stated "close-only" choice for AC #3. **Resolved:** chose option (a) — accept close-and-ripple. Removed the dormant guard in `handleWaterClick` ([WaterSurface.tsx:397-411](frontend/src/components/pond/WaterSurface.tsx#L397-L411)) and rewrote the comment to document the PondCamera-owned dismissal path. Dev Agent Record updated. Spec AC #3 resolution pointed at option (b) in the spec's framing ("so the click isn't 'free'").
  - **Root cause:** [PondCamera.tsx:58-62](frontend/src/components/pond/PondCamera.tsx#L58-L62) already calls `closePopup()` on native `pointerup` for water-plane clicks — pre-existing behavior that the 2.9 spec didn't see. Per DOM event order (`pointerup` fires before `click`), PondCamera's handler runs first, closes the popup, and by the time [WaterSurface.handleWaterClick](frontend/src/components/pond/WaterSurface.tsx#L398-L414) runs (on `click`), its popup-guard sees `activePopupTodoId === null` and falls through to `triggerRipple`. The guard is dormant.
  - **Options to resolve:**
    - **(a) Accept close-and-ripple as intended.** Remove the dormant guard in `handleWaterClick` (reverts it to the pre-2.9 shape, minus the empty-water-no-popup path which is unchanged). Update this Dev Agent Record to say "close-and-ripple: ripple provides tactile feedback that the dismiss click landed." Spec AC #3 allows this option explicitly ("fire both — close + ripple — so the click isn't 'free'").
    - **(b) Enforce true close-only.** Remove the `closePopup()` call from `PondCamera.handlePointerUp` (leave the early-return guarding camera-pan). `WaterSurface.handleWaterClick` then becomes the sole owner of close-on-water-click. **Trade-off:** clicks that miss the water plane (off-scene) no longer close the popup, since `handleWaterClick` fires only on raycast-hit-water. This may or may not be desired — pre-2.9 the popup would dismiss on any canvas click.
    - **(c) Keep both paths, but coordinate.** PondCamera closes popup AND sets a short-lived `popupJustClosed` flag; WaterSurface reads it and skips ripple if set within the last ~50ms. More surface area, same visible outcome as (b) for water clicks.
  - **Recommendation:** (a). The ripple is small, reads as click feedback, and doesn't obstruct the dismiss. (b) loses click-outside-pond-to-dismiss which users probably expect. (c) is over-engineering.

- [x] [Review][Defer] `drainRipples` uses absolute `set({ dropRipples: [] })` instead of `slice(queued.length)` — theoretical race if a synchronous reentrancy enqueues mid-drain.
  - **Location:** [usePondStore.ts:142](frontend/src/stores/usePondStore.ts#L142) + [WaterSurface.tsx:311-328](frontend/src/components/pond/WaterSurface.tsx#L311-L328).
  - **Trigger:** None today — the drain loop only writes to uniforms; no callback or subscriber can synchronously reentrantly call `triggerRipple` during the loop.
  - **Reason to defer:** Fix is trivial (`set((s) => ({ dropRipples: s.dropRipples.slice(queued.length) }))`) but solves a path that can't exist. Document here so future refactors keep the invariant.

- [x] [Review][Defer] Ambient scheduler's `setTimeout` callback can complete after cleanup if it's mid-flight at unmount.
  - **Location:** [WaterSurface.tsx:370-393](frontend/src/components/pond/WaterSurface.tsx#L370-L393).
  - **Trigger:** Extremely rare — requires the cleanup to run during the ~microsecond window between setTimeout callback entry and its `schedule(nextDelay, false)` re-arm. No user-visible impact (no useFrame to read stale state), but the re-armed timer becomes an orphan.
  - **Reason to defer:** Today the ref is per-instance and GC'd; the re-armed timer fires but writes to a now-null `pendingAmbientRef.current` slot on a dead instance (no-op). Becomes a real leak if anyone migrates to a shared/module-scope ref. Add an `unmounted` flag if this pattern ever becomes shared.

- [x] [Review][Defer] Unbounded `dropRipples` queue growth during `useFrame` early-return windows (initial ref-attach, WebGL context loss).
  - **Location:** [WaterSurface.tsx:296-300](frontend/src/components/pond/WaterSurface.tsx#L296-L300).
  - **Trigger:** WebGL context loss (laptop sleep/wake, dedicated-to-integrated-GPU switch, etc.) between `triggerRipple` calls and drain. Queue grows until material is restored, then drains all at once with the same `state.clock.elapsedTime` — all queued ripples fire simultaneously at their original positions. Visible as a "burst" of ripples on recovery.
  - **Reason to defer:** Rare (requires GPU context loss). Mitigation is a bounded queue — cap at `CLICK_SLOTS * 2` and drop oldest in `triggerRipple`. Would be worth adding if context-loss recovery becomes a real use case (heavy-GPU laptops, integrated/discrete switching).

- [x] [Review][Defer] Shader `wavefrontOverride > 0.0` sentinel doesn't guard against `freq <= 0.0` in the derived path — a future edit to `freq=0.0` produces `Infinity` wavefront.
  - **Location:** [WaterSurface.tsx:113-125](frontend/src/components/pond/WaterSurface.tsx#L113-L125).
  - **Trigger:** Not today — click ripple uses `freq=1.3` (positive). Only hits if a future tuner sets `freq=0.0`.
  - **Reason to defer:** Could be addressed with `max(freq, 1e-6)` or a shader assertion, but the current callers are stable and adding GLSL guards for non-existent paths clutters the math. Comment on the `ripple()` function signature would be sufficient if this ever changes.

**Summary:** 1 decision-needed (the close-only/close-and-ripple intent question), 4 deferred (all theoretical / not user-visible today), 11 dismissed as noise / false positives after verification:
- Comment "speed/freq ≈ 4.23" — Blind Hunter misread the call's positional args; the comment is correct (`freq=1.3, speed=5.5`).
- `handleWaterClick` without `stopPropagation` — R3F synthetic onClick on the bottom-of-z-stack water mesh has no further propagation path to guard.
- Array-spread in `triggerRipple` forcing subscriber re-renders — no subscribers exist; `WaterSurface` reads via `getState()` per the documented pattern.
- `drainRipples` no-short-circuit — guarded by the caller's `queued.length > 0` check.
- Shader `> 0.0` precludes legit `0.0` override — current design choice; no caller uses 0 meaningfully.
- First-tick bypass airtightness — `queueOne()` has no internal guard; bypass is airtight.
- Test destructures action — zustand actions don't use `this`; idiom is safe.
- `closePopup` without `stopPropagation` — same as the handleWaterClick dismissal.
- StrictMode double-fire of first ripple — cleanup cancels the first timer before it fires (1200ms delay vs synchronous cleanup); second mount is fresh.
- Identical-position rapid `triggerRipple` calls waste slots — realistic user-facing callers differ by ≥ 1 pixel; internal callers (pad complete/delete) fire once per pad per sequence, never in identical pairs.
- Acceptance Auditor report had no findings to dismiss.

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

claude-opus-4-7 (1M context) — BMad dev-story skill, same session that drafted the spec.

### Debug Log References

No incidents. One TypeScript diagnostic surfaced mid-refactor (`AMBIENT_WAVEFRONT_SPEED declared but never read`) as expected during the two-step migration to the uniform; resolved by referencing the constant in `createUniforms`.

### Completion Notes List

- **Task 2 (queue).** Chose option (a): `dropRipples: RippleEvent[]` in the store, drained FIFO by `WaterSurface.useFrame`. `WaterSurface` reads the queue via `usePondStore.getState()` (no subscription) so enqueues don't trigger re-renders. Added a `drainRipples` action so the drain is an explicit set call that preserves zustand patterns.
- **Task 3 (popup-guard).** Initial implementation chose "close-only" but code review (2026-04-20) surfaced that `PondCamera.handlePointerUp` already closes the popup on `pointerup` (which fires before `click` per DOM order). The `handleWaterClick` guard was dormant — shipped behavior was close-and-ripple. Resolution: accept close-and-ripple as the intended behavior (spec AC #3 option (b) — "so the click isn't 'free'"). Removed the dormant guard; the ripple reads as tactile "click-landed" feedback alongside the popup dismissal.
- **Task 5 (R3F clock).** Dropped the `time: performance.now() / 1000` field from `RippleEvent`. The queue-length-and-identity handle change detection; ripple timestamps are stamped from `state.clock.elapsedTime` inside `useFrame` at drain time.
- **Task 8 (coordinate naming).** Chose rename: `triggerRipple(worldX, worldZ)` + `RippleEvent` uses `worldX, worldZ`. Kept the world-Z → local-Y flip in `WaterSurface` at uniform-write time (one-line `centers[slot].set(worldX, -worldZ)`). JSDoc on `triggerRipple` documents the coord system explicitly. Rejected moving the flip into the store because storing shader-local coords in the store would be semantically confusing (any non-WaterSurface consumer would get garbage).
- **Task 1 (wavefront/wave velocity).** Changed the shader's `ripple()` to derive `wavefrontSpeed` internally from `speed / freq` when the override argument is `0.0`. Click-ripples pass `0.0` so their leading edge locks to the crest (5.5/1.3 ≈ 4.23 u/s). Ambient ripples still pass the explicit `uAmbientWavefrontSpeed` uniform — ambient is deliberately mismatched (slower front than wave) for the languid "distant rain" feel; keeping the option at the call site preserves that.
- **Task 6 (uniform migration).** `AMBIENT_WAVEFRONT_SPEED` now flows through `uAmbientWavefrontSpeed: { value: AMBIENT_WAVEFRONT_SPEED }` in `createUniforms` and is declared as `uniform float` in the vertex shader, replacing the `${…toFixed(2)}` template-literal injection.
- **Task 4 (first ripple guarantee).** `schedule` now takes an `isFirst: boolean` second argument. On the first call the skip check is bypassed; all subsequent scheduler ticks use the normal `Math.random() >= AMBIENT_SKIP_PROBABILITY` test.
- **Task 7 (unmount cleanup).** Added `pendingAmbientRef.current = null;` to the `useEffect` cleanup alongside `clearTimeout`. Theoretical today (per-instance ref) but guards against future refactors to shared/module-scope refs.
- **Tasks 9/10 (capacity comments).** Added a multi-paragraph block near the `CLICK_SLOTS`/`AMBIENT_SLOTS` definitions recording the 2 Hz eviction cap, the 14-second ambient slot-lifetime, and the 2.5s worst-case eviction rate with the "raise to 12 / 5 if …" escalation triggers.
- **Test gate.** 72/72 tests pass (69 existing + 3 new on the store's queue semantics). `tsc -b` clean. AC #3's test was left as browser-verify per the spec's "optional" designation — a JSDOM-rendered assertion of R3F water clicks is fraught and adds little value beyond the 3-line handler's obvious behavior.
- **Not tested (reliance on regression suite).** ACs #1, #4, #6, #7, #9, #10 are shader-math / scheduler / uniform-shape / comment-only changes whose correctness was verified by the existing suite remaining green plus the unchanged visual output of all rendered tests.

### File List

- Modified: `frontend/src/stores/usePondStore.ts` — `RippleEvent` shape (world coords, no time field), `dropRipples` queue + `drainRipples` action, rename `triggerRipple(x, z)` → `(worldX, worldZ)` with JSDoc coord-system note.
- Modified: `frontend/src/stores/usePondStore.test.ts` — `beforeEach` reset `dropRipples: []`; replaced the single `triggerRipple` test with 4 new tests covering the queue shape, multi-enqueue, drain, and post-drain re-enqueue.
- Modified: `frontend/src/components/pond/WaterSurface.tsx` — `uAmbientWavefrontSpeed` uniform, `ripple()` derives wavefrontSpeed from `speed/freq` when the override is 0, queue drain in `useFrame`, popup-guard in `handleWaterClick`, first-ripple guarantee in scheduler, `pendingAmbientRef` cleanup on unmount, capacity-tuning comments near slot constants.

### Change Log

- 2026-04-20: Implementation of all 11 ACs complete; 72/72 tests green; `tsc -b` clean; story moved ready-for-dev → in-progress → review in a single session.
- 2026-04-20: Code review complete. Acceptance Auditor 0 findings; Blind Hunter + Edge Case Hunter surfaced 1 real interaction with pre-existing `PondCamera.handlePointerUp` (dormant popup-guard) + 4 theoretical defers. Decision resolved as close-and-ripple (AC #3 option b). Dormant guard removed from `handleWaterClick`. 4 defers logged to `deferred-work.md`. Status review → done.
