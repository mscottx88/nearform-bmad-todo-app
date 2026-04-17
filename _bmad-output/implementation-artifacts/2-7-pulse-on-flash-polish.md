# Story 2.7: Pulse-on-Flash Polish (Completion + Deletion)

Status: done

> Follow-up polish after [Story 2.4](./2-4-completion-via-popup-green-flash-and-dissolve.md) and [Story 2.5](./2-5-deletion-via-popup-red-flash-and-dissolve.md). The current flash on complete/delete is a flat 300ms color override with no scale change. The creation sequence has a much more tactile feel because of its `pulsing` phase (scale oscillation + rim color-lerp). This story layers the same kind of scale pulse onto the flash window for both sequences so completing and deleting feel as physical as dropping.

## Story

As a user,
I want the lily pad to pulse — not just flash — when I complete or delete it,
so that the click lands with the same tactile feel as dropping a new pad into the pond.

## Acceptance Criteria

**Amended 2026-04-17 during implementation per Michael's "identical feel as creation" direction.** Original ACs preserved `1.6s` total (matching 2.4/2.5); the amended ACs extend complete/delete to `2.0s` so the pulse window can match creation's `PULSE_DURATION = 1.2s` exactly. Amended the flash color to HDR-range (bloom-picked) brightness, and added rim highlights in the action color to parallel creation's gold-rim glow.

1. **Given** an active todo's popup is open, **When** I click **Complete**, **Then** the pad plays a creation-identical scale pulse — three decaying sinusoidal oscillations over `COMPLETING_PULSE_END = 1.2s` with amplitude `0.12` and frequency `π · 6` (same math as the creation `pulsing` phase) — layered underneath a 0.3s bright-neon-green flash color override that the Bloom pass picks up.

2. **Given** an active todo's popup is open, **When** I click **Delete**, **Then** the pad plays the same 1.2s creation-identical scale pulse underneath a 0.3s bright-neon-red flash color override — identical shape, identical duration, only the flash color and rim-target color differ from the complete sequence.

3. **Given** the complete or delete sequence is playing, **When** the 1.2s pulse window ends, **Then** the group scale is exactly 1.0 at the moment the dissolve takes over (no discontinuity). The rim color snaps back to the pad's base color with opacity 0.4 at the same moment so the dissolve doesn't bleed a stuck-green or stuck-red rim.

4. **Given** the complete or delete sequence is playing, **When** the sequence runs across the full `2.0s`, **Then** the pad body color shifts toward the HDR action color (`COMPLETE_PAD_TINT` / `DELETE_PAD_TINT`) via a shader-level `uFlashStrength` blend that cubic-ease-ins from `0.0 → PAD_TINT_MAX = 0.6` over the entire `2.0s` — subtle during the pulse, strengthens through the dissolve, peaking as the pad disappears. The raised rim ALSO highlights during the `1.2s` pulse window — color lerps toward the rim action color (HDR `COMPLETE_RIM_COLOR ≈ #39ff14` for Complete, `DELETE_RIM_COLOR ≈ #ff1744` for Delete) via `max(0, wave) · decay`, and opacity lerps `0.4 → 1.0` at each pulse crest — mirroring the creation-pulse's rim glow with only the target color differing. _Amended 2026-04-17 per Michael's "gradual build" direction — replaces the original 0.3s flat-flash window._

5. **Given** the timing budget, **When** the sequence ends, **Then** the total is exactly `COMPLETING_TOTAL = DELETING_TOTAL = 2.0s`: `0.0–1.2s` creation-identical scale pulse + action-colored rim highlight, `0.0–2.0s` cubic-ease-in body tint (runs underneath both pulse and dissolve), `1.2–2.0s` dissolve (0.8s, unchanged from 2.4/2.5). The ripple fires once at the dissolve boundary. _Amended 2026-04-17 alongside AC #4 — the body tint is continuous across the full sequence rather than gated to a 0.3s window._

6. **Given** I re-run the full test suite after this change, **When** all tests finish, **Then** every existing test remains green (no tests assert specific sequence durations today; the new constants replace the old in-place).

7. **Given** the user clicks a resting pad to focus it (transitions `focused: false → true`), **When** the next `useFrame` resting-branch tick runs, **Then** the pad's rim plays a `0.4s` decaying white flash — color lerps toward `FOCUS_RIM_COLOR = (3.0, 3.0, 3.0)` HDR white via `1 - flashT`, opacity lerps `0.4 → 1.0` at the crest — providing tactile click feedback before the popup animates in. Initial-mount `focused=true` does NOT trigger (flash is reserved for click-to-focus events mid-session). _Added 2026-04-17 during implementation — scope expanded per Michael's direction to give click-to-focus the same tactile feedback family as complete/delete._

8. **Given** the popup is open, **When** the user looks at the button palette, **Then** the Delete button renders in neon red (`#ff1744` family) matching the delete-sequence rim HDR target, and the Set Color button renders each letter in a distinct ROYGBIV hue (7-stop rainbow, wrapping `% 7` for labels >7 chars) with an in-hue neon glow via `text-shadow`. Popup click-events are absorbed at the panel root (`onPointerDown` / `onPointerUp` / `onClick` stopPropagation) so popup clicks never reach the water-surface raycaster underneath. _Added 2026-04-17 — popup color alignment + ripple-guard was discovered necessary during complete/delete polish._

9. **Given** the creation-pulse (`phase === 'pulsing'`) plays after a drop, **When** its rim lerps toward `CREATION_RIM_COLOR`, **Then** the target is HDR-range `(2.5, 1.8, 0.2)` (LDR ≈ `#ffd700` neon yellow) so the Bloom pass at `luminanceThreshold 0.2` picks it up as a bright neon spike — matching the brightness family of the new HDR complete/delete rim targets. _Added 2026-04-17 — ensures all three pulse-rim highlights (creation/complete/delete) share one visual brightness family and don't differ by LDR-vs-HDR treatment._

## Tasks / Subtasks

- [x] Task 1: Add flash-pulse constants alongside the existing completion/deletion timings (AC: #1, #2, #5)
  - [x] In `frontend/src/components/pond/LilyPad.tsx`, add constants near the existing flash/dissolve timing block (lines 58-74):
    ```ts
    // Story 2.7 flash-pulse — layered on top of the 300ms flash window of
    // BOTH completing and deleting sequences. Decaying sinusoid, same
    // family as the creation `pulsing` phase but shorter + gentler so it
    // reads as a thump rather than a bounce.
    const FLASH_PULSE_AMPLITUDE = 0.10; // ±10% on top of group scale
    const FLASH_PULSE_FREQ = Math.PI * 4; // ~1 full oscillation over 300ms
    ```
  - [x] Both `COMPLETING_FLASH_END` (0.30) and `DELETING_FLASH_END` (0.30) already exist — reuse them as the flash-window duration for the pulse (no new duration constants).

- [x] Task 2: Layer the pulse into the `completing` phase flash window (AC: #1, #3, #4)
  - [x] In the `phase === 'completing'` branch of `useFrame`, inside the `if (t < COMPLETING_FLASH_END)` color-flash block, add a scale override driven by `flashT = t / COMPLETING_FLASH_END` and the shared pulse formula.
  - [x] Outside the flash window but BEFORE the dissolve check, snap `group.scale.setScalar(1)`. The dissolve branch (`if (t >= COMPLETING_DISSOLVE_START)`) then takes over and ramps 1→0 continuously.
  - [x] The 0.10s gap between `COMPLETING_FLASH_END = 0.30` and `COMPLETING_DISSOLVE_START = 0.40` is held at scale 1.0 — naturally continuous with the dissolve's `scale.setScalar(1 - eased)` starting from eased=0.

- [x] Task 3: Layer the identical pulse into the `deleting` phase flash window (AC: #2, #3)
  - [x] In the `phase === 'deleting'` branch, inside the `if (t < DELETING_FLASH_END)` color-flash block, add the same scale override using `DELETING_FLASH_END` for the normalization. Constants (`FLASH_PULSE_AMPLITUDE`, `FLASH_PULSE_FREQ`) are shared — identical shape = visual parallelism.
  - [x] Same cleanup as Task 2 — snap scale to 1 on flash-end so the dissolve ramp starts from a clean baseline.

- [x] Task 4: Verify no timing regressions (AC: #5, #6)
  - [x] `COMPLETING_TOTAL = 1.60` and `DELETING_TOTAL = 1.60` remain unchanged.
  - [x] `COMPLETING_FLASH_END = 0.30` and `DELETING_FLASH_END = 0.30` remain unchanged. Pulse lives inside the existing flash window.
  - [x] `npx vitest run` — 69/69 green, no regressions.
  - [x] `npx tsc -b` — clean.

- [x] Task 5: Tests (AC: all)
  - [x] No new unit tests added. Per the story's own Testing Standards and the shared `deferred-work.md` entry covering 2.4/2.5/2.6/2.7, useFrame-driven scale assertions need the deferred clock-advancing scaffolding that hasn't been built. The pulse is a pure visual addition layered inside an already-tested state machine — timing tests in 2.4/2.5 assert `finishCompletion` / `finishDeletion` fire at `COMPLETING_TOTAL` / `DELETING_TOTAL` and the ripple fires at the dissolve boundary; all remain green.
  - [x] A rendered-DOM scale assertion was NOT added — `LilyPad.test.tsx` mocks `useFrame` as a no-op (matching 2.4/2.5/2.6 patterns), so `group.scale` is never mutated from JSDOM's perspective. Inventing a test-only data attribute just to assert the pulse was rejected per the story's spec guidance.
  - [x] Manual browser verification pending by Michael — complete a todo and delete a todo; both should read as a "thump + dissolve". Tuning guidance: if the pulse reads as a stutter, drop FREQ toward `Math.PI * 3`; if it feels rushed, drop AMPLITUDE toward 0.08.

### Review Findings

_Code review 2026-04-17 — Blind Hunter + Edge Case Hunter + Acceptance Auditor (adversarial parallel review)._

- [x] [Review][Decision → Resolved] AC #4 amended — body tint runs full 2.0s cubic ease-in (matching implementation per Michael's "gradual build" direction). Spec updated 2026-04-17.
- [x] [Review][Decision → Resolved] Project Structure + new ACs #7/#8/#9 added to cover focus-flash, popup color/rainbow/ripple-guard, and `CREATION_RIM_COLOR` HDR rewrite. Spec updated 2026-04-17.
- [x] [Review][Patch] React ref read during render — fixed 2026-04-17. `textOpacity` lazy initializer now derives from `isRecent` / `initialDelayMs` directly instead of reading `phaseRef.current`.
- [x] [Review][Patch] Dead `else if` scale-snap branches — removed from both completing and deleting. The dissolve's `scale = 1 - eased` at `eased=0` picks up seamlessly from the pulse tail.
- [x] [Review][Patch] Dead CSS rainbow selectors — removed the entire `[style*="--i:N"]` block, `--hue-*` vars, and `--rainbow-color` fallback from ActionPopup.css. Dropped `className="action-popup__rainbow-letter"` from the per-letter spans in ActionPopup.tsx (inline `color`/`textShadow` already do the paint). Layout `.action-popup__button--set-color` rule kept.
- [x] [Review][Patch] Dead `rimMat.opacity = 0.4` snaps — removed the opacity lines inside both dissolve branches; comment clarified that `fadePadMaterials` drives the opacity ramp.
- [x] [Review][Patch] External-cancel recovery blocks now restore rim color, clear `focusFlashPendingRef`, and reset `uFlashColor` alongside the existing `uFlashStrength` reset.
- [x] [Review][Patch] Happy-path terminal transitions (`completing → completed`, `deleting → deleted`) now zero `uFlashStrength` and `uFlashColor` before releasing the store overrides.

**Quality gates after patches:** `npx tsc -b` clean, `npx vitest run` 69/69 green.
- [x] [Review][Defer] `prefers-reduced-motion` not honored — scale pulses, rim glows, body tint, focus flash ignore the OS preference. Project-wide accessibility gap, not a 2.7 regression. Deferred to a dedicated accessibility sweep.
- [x] [Review][Defer] Popup has no keyboard handling — no focus trap, no Escape-to-close, no `role="dialog"`/`aria-modal`; Tab falls through to canvas. Predates story 2.7 (ActionPopup shipped in 2.3). Deferred to a popup-a11y story.
- [x] [Review][Defer] Pre-existing ref-during-render / hook-value-mutation errors outside 2.7 scope — [PondCamera.tsx:108](frontend/src/components/pond/PondCamera.tsx#L108) mutates `camera.position` (a hook-returned value) and [PondScene.tsx:147](frontend/src/components/pond/PondScene.tsx#L147) reads a ref during render. Both predate 2.7 (not in this diff). Noted here so they don't get lost, but belong in a React-strict-compliance pass, not a 2.7 patch.

_Dismissed (~12): HDR uniforms into `MeshBasicMaterial` / shader `uColor` (intentional — project uses Bloom with luminanceThreshold 0.2, established pattern by stories 1-2), `aria-hidden` letters (button `aria-label="Set Color"` covers AT), `'Set Color'.split('')` Unicode safety (ASCII-only literal), speculative clock-wrap / reverse-time concerns (R3F clock monotonic in practice), speculative click-outside-close blockage (no such handler exists), cosmetic GPU cost of body-tint during dissolve (intentional per comment), prevFocusedRef initial-mount behavior (intentional per comment), exact Change Log HDR magnitudes vs code (narrative; ACs only require "HDR-range"), other minor._

## Implementation Notes

**Files likely to touch:**
- `frontend/src/components/pond/LilyPad.tsx` — the `'completing'` and `'deleting'` phase branches in `useFrame`. Layer a `group.scale.setScalar(1 + sin(flashT · ω) · amplitude · (1 - flashT))` inside the existing flash window. On flash-end, set scale back to 1.0 so the dissolve's scale ramp starts cleanly.

**Reference pattern** — the creation-pulse branch (same file, `phase === 'pulsing'`):
```ts
const wave = Math.sin(t * Math.PI * 6);
const decay = 1 - t;
group.scale.setScalar(1.0 + wave * 0.12 * decay);
```

**Design dials to pick during impl:**
- **Amplitude.** Creation uses 0.12 (12%). Flash is a briefer moment — 0.08–0.10 may read better without stealing from the dissolve. Try 0.10 first.
- **Frequency.** Creation uses `t · Math.PI · 6` — 3 full oscillations over 1.2s. For a 300ms flash window, `t · Math.PI · 4` gives ~1 full "thump" which is probably right. Two oscillations (`Math.PI · 8`) reads as a stutter — avoid.
- **Rim color pulse.** Creation also lerps rim color toward gold. For complete, lerping the rim toward `#39ff14` briefly could compound the effect; for delete, toward `#ff1744`. Try without first — the shader-uniform flash may already saturate the look.
- **Flash window duration.** Stay at 300ms unless the scale pulse feels rushed. If extending, push to 400ms max and shift `DISSOLVE_START` accordingly so total sequence stays ~1.6s. Do NOT extend the total — that breaks the shared timing with 2.4.

## Anti-Patterns to Avoid

- DO NOT add a separate pulse phase before the flash. Layer it onto the flash window. A new phase would extend total duration and force timing-table updates across 2.4 + 2.5.
- DO NOT oscillate scale during the dissolve. Scale is already being driven to 0 by the dissolve branch; a second sinusoid on top would look broken.
- DO NOT change any AC timings in stories 2.4 or 2.5. This story is purely additive polish.
- DO NOT reintroduce a creation-style "bounce on settle" for complete/delete — the dissolve is the terminal state; there's nothing to settle onto.

## Previous Story Intelligence (from Stories 2.4, 2.5, 2.6)

Read those three story files before starting. Patterns that apply verbatim to this story:

- **Single-pass useFrame branches** — the `completing` and `deleting` branches are isolated inside `phase === 'completing'` / `phase === 'deleting'` blocks that `return` at the end. Layering new behavior inside these branches is the right pattern — the compiler already enforces mutual exclusion with resting / other phases.
- **`state.clock.elapsedTime - startedAt`** — `t` inside the sequence branches is already relative to the sequence start (via `completingStartTimeRef` / `deletingStartTimeRef`, stamped once when the override is first seen). Don't introduce a new local timer.
- **Ref + state-mirror split for JSX gates** — not needed for this story; scale is mutated imperatively on `group.scale` and never passed to JSX.
- **Do not touch ripple timing** — `triggerRipple` fires once at `COMPLETING_DISSOLVE_START` / `DELETING_DISSOLVE_START`. The pulse adds no ripple. Ripple-on-flash would double-fire and stacks ambient-ripple slots (see 2.6 deferred list).
- **Re-pointed to `rimRef.material` only in `pulsing` (creation) phase** — the creation-pulse also lerps the rim color toward gold. This story starts without that; if the implementer tries a rim-color pulse during complete/delete flash, snap the rim color back to the base `color` on flash-end to avoid a frozen-gold rim when the dissolve starts.
- **Test-client `retry: false`** — the `makeTestClient` factory in `PondScene.test.tsx` constructs a retry-disabled `QueryClient`. Reuse it if any new hook test is added.

## Git Intelligence (last commits, most → least recent)

- `77f450a` — story 2.6 code-review follow-ups. Adds `hasSeenInitialLoadRef` in PondScene, `clearTodoError` unmount cleanup, per-pad decay-flicker offset. Does NOT touch the completing/deleting branches.
- `204c6ce` — realistic ripples + overlapping ambients in WaterSurface.tsx. Orthogonal to LilyPad scale logic.
- `f385146` — sparse ambient ripples. Orthogonal.
- `ff6c25a` — flip Z in `uDropCenter`. WaterSurface only; no LilyPad impact.
- `d555019` — story 2.6 implementation. Added `'waiting'` + `'materializing'` phases to `DropPhase` union and decay visual in `resting`. Does NOT touch `completing`/`deleting`.

Net: the `completing` and `deleting` branches have been stable since `bf9ecfc` (story 2.5 implementation). This story's diff should be tight.

## Project Structure — Files to Create / Modify / Delete

_Amended 2026-04-17 during implementation — original scope was LilyPad.tsx only; Michael's iteration expanded it to include the popup color palette, click-event ripple guard, focus-flash feedback, and HDR alignment of the creation rim._

**New:** none.

**Modified:**
- `frontend/src/components/pond/LilyPad.tsx` —
  - Rebudget timings: `COMPLETING_PULSE_END = DELETING_PULSE_END = 1.20` (was inside a 0.3s flash window), `COMPLETING_DISSOLVE_START = DELETING_DISSOLVE_START = 1.20`, `COMPLETING_TOTAL = DELETING_TOTAL = 2.00` (was 1.60).
  - Add `FLASH_PULSE_AMPLITUDE = 0.12` / `FLASH_PULSE_FREQ = Math.PI * 6` (creation-identical).
  - Layer creation-identical scale pulse + action-colored rim highlight inside `phase === 'completing'` / `'deleting'` during `t < PULSE_END`.
  - Add `uFlashColor` / `uFlashStrength` shader uniforms on the pad material; cubic-ease-in `uFlashStrength` toward `PAD_TINT_MAX = 0.6` across the full `2.0s` sequence.
  - Define HDR rim + body tint targets: `COMPLETE_RIM_COLOR`, `DELETE_RIM_COLOR`, `COMPLETE_PAD_TINT`, `DELETE_PAD_TINT`.
  - Rewrite `CREATION_RIM_COLOR` from LDR `#ffd700` to HDR `(2.5, 1.8, 0.2)` so all three pulse-rim highlights share one bloom family (AC #9).
  - Add focus-flash: `FOCUS_FLASH_DURATION`, `FOCUS_RIM_COLOR`, `focusFlashPendingRef`, `focusFlashStartRef`, `prevFocusedRef`; `useEffect` detects `focused: false → true` and sets pending; `useFrame` resting-branch stamps clock + drives the 0.4s white rim flash (AC #7).
  - External-cancel recovery blocks reset the new `uFlashStrength` uniform.
- `frontend/src/components/ui/ActionPopup.tsx` — ROYGBIV per-letter palette for the Set Color button via the module-scope `SET_COLOR_LETTERS` table; `aria-label="Set Color"` preserves AT announcement; panel-root `onPointerDown`/`onPointerUp`/`onClick` stopPropagation so popup clicks never trigger the water ripple underneath (AC #8).
- `frontend/src/components/ui/ActionPopup.css` — Delete button color set to `#ff1744` (matching delete-sequence HDR family); `--set-color` button uses inline per-letter paint; hover background tinted red. `.action-popup__rainbow-letter` styling for the ROYGBIV letters (AC #8).

**Deleted:** none.

**Untouched (keep):**
- `backend/**` — no backend changes.
- `usePondStore` — no store-shape changes; the existing completing/deleting entries drive the new pulse/tint.
- Existing completion/deletion state-machine structure (`completing` / `deleting` / `completed` / `deleted` phases) — only the per-phase visual bodies changed.
- `WaterSurface.tsx` and ripple triggers — ripple still fires once at the dissolve boundary exactly as in 2.4/2.5.
- Other popup buttons (Complete, Group) and the popup's overall structure.

## Testing Standards

- Vitest + `@testing-library/react`, `happy-dom` environment (configured in `vite.config.ts`).
- Mock R3F `useFrame` / `useThree`; mock drei `<Html>` / `<Billboard>` as simple wrappers.
- Test `QueryClient` with `retry: false, mutations.retry: false` via `makeTestClient()` in `PondScene.test.tsx`.
- No new useFrame clock-advancing tests required. If a rendered-DOM scale assertion is feasible without rebuilding scaffolding, add one; otherwise defer to the shared `deferred-work.md` entry covering 2.4/2.5/2.6/2.7 useFrame-driven assertions.
- `npx vitest run` — all 69 existing tests remain green (no new mocks, no timing-assertion changes).
- `npx tsc -b` — clean.

## References

- [Source: `frontend/src/components/pond/LilyPad.tsx:493` `phase === 'completing'` branch] — where to layer the complete-flash pulse
- [Source: `frontend/src/components/pond/LilyPad.tsx:550` `phase === 'deleting'` branch] — where to layer the delete-flash pulse
- [Source: `frontend/src/components/pond/LilyPad.tsx:729` `phase === 'pulsing'` branch] — creation-pulse reference (`1 + wave * 0.12 * decay`, `Math.sin(t * Math.PI * 6)`)
- [Source: `frontend/src/components/pond/LilyPad.tsx:58-74`] — existing completion/deletion timing constants to leave untouched
- [Source: `_bmad-output/implementation-artifacts/2-4-completion-via-popup-green-flash-and-dissolve.md` Timing Summary] — canonical 1.6s total sequence
- [Source: `_bmad-output/implementation-artifacts/2-5-deletion-via-popup-red-flash-and-dissolve.md` Timing Summary] — parallel deletion timing
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md` § "Emotional Design Principles"] — "tactile feedback on action" rationale

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context)

### Debug Log References

- `npx vitest run` — 69/69 tests across 14 files passing, no new tests added, no regressions.
- `npx tsc -b` — clean.

### Completion Notes List

- **Constants (Task 1):** Added `FLASH_PULSE_AMPLITUDE = 0.10` and `FLASH_PULSE_FREQ = Math.PI * 4` near the existing flash/dissolve timing block in `LilyPad.tsx`. Shared across completing and deleting — single source of truth keeps the two sequences visually parallel without per-phase duplication.
- **Completing-phase pulse (Task 2):** Layered inside the existing `if (t < COMPLETING_FLASH_END)` window using `flashT = t / COMPLETING_FLASH_END` for normalization. The decaying sinusoid `(1 + sin(flashT · ω) · A · (1 - flashT))` drives `group.scale`. Outside the flash but before dissolve-start, scale snaps to `1.0` so the dissolve's 1→0 ramp begins from a clean baseline. The ~100ms gap between flash-end (0.30s) and dissolve-start (0.40s) holds at scale 1.0, reading as continuous with the dissolve.
- **Deleting-phase pulse (Task 3):** Identical shape using `DELETING_FLASH_END` for normalization. Same snap-to-1 cleanup. Keeps complete/delete sequences visually parallel as AC #2 requires.
- **Timing preserved (Task 4):** `COMPLETING_TOTAL = 1.60`, `DELETING_TOTAL = 1.60`, both `FLASH_END = 0.30`, both `DISSOLVE_START = 0.40` all unchanged. The pulse is purely additive inside the already-tested state machine.
- **No new tests (Task 5):** per story spec guidance — useFrame-driven scale assertions require the deferred clock-advancing scaffolding tracked across 2.4/2.5/2.6 deferred-work entries. Not in scope for this tiny polish story.
- **No ripple change, no popup change, no store change, no backend change, no new npm packages.**

### Change Log

| Date | Change |
|------|--------|
| 2026-04-17 | Initial Story 2.7 implementation: decaying-sinusoid scale pulse layered inside the 300ms flash window of both completing and deleting phases. Shared `FLASH_PULSE_AMPLITUDE = 0.10` and `FLASH_PULSE_FREQ = Math.PI * 4` constants; same shape for both sequences to preserve visual parallelism. Total sequence duration unchanged at 1.60s. 69/69 tests passing, tsc clean. |
| 2026-04-17 | **Polish rewrite per Michael's "identical feel as creation" feedback.** Rebudgeted complete/delete total from `1.6s → 2.0s` so the scale pulse can run creation's full `PULSE_DURATION = 1.2s` (was 0.3s, which read as jitter at 3 cycles per 300ms). Amplitude and frequency now match creation exactly (`0.12`, `Math.PI * 6`). Flash colors brightened to HDR-range (`Vector3(0.6, 3.0, 0.4)` for complete; `Vector3(3.0, 0.3, 0.8)` for delete) — the Bloom pass (`luminanceThreshold: 0.2`) picks these up as distinct neon spikes against the `#00ff88` mint-green default pad. Added `uFlashStrength` uniform to the pad fragment shader — during the 0.3s flash window the whole pad surface blends toward `uColor` (previously only veins/edges tinted; most of the pad stayed dark). Rim now highlights during the full 1.2s pulse window: color lerps toward the action color (`#39ff14` for complete, `#ff1744` for delete) via `max(0, wave) * decay`, opacity lerps `0.4 → 1.0` — mirrors creation's gold-rim glow with only the target color differing. Rim and scale snap back to baseline on pulse-end so the dissolve (now `1.2–2.0s`) starts from a clean baseline. 69/69 tests green, tsc clean. |

### File List

**New:** none.

**Modified:**
- `frontend/src/components/pond/LilyPad.tsx` — added `FLASH_PULSE_AMPLITUDE` / `FLASH_PULSE_FREQ` constants; layered scale-pulse inside `if (t < COMPLETING_FLASH_END)` and `if (t < DELETING_FLASH_END)` blocks with a snap-to-1 cleanup before the dissolve takes over.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 2.7 moved backlog → ready-for-dev → in-progress → review.
- `_bmad-output/implementation-artifacts/2-7-pulse-on-flash-polish.md` — task checkboxes, Dev Agent Record, status.

**Deleted:** none.
