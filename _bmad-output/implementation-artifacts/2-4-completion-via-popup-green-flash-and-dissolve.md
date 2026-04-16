# Story 2.4: Completion via Popup — Green Flash + Dissolve

> **Supersedes** [2-3-completion-egg-hatch-to-complete.superseded.md](./2-3-completion-egg-hatch-to-complete.superseded.md). Introduced via the Correct Course workflow on 2026-04-16 after the PRD dropped creature-based controls (egg, aphid, chameleon, trash lizard) in favor of an in-scene neon wireframe Action Popup. Renumbered from 2.3 to 2.4 on 2026-04-16 to resolve a forward-dependency (this story depends on Story 2.3 — Action Popup primitive — which must land first).

Status: backlog

## Story

As a user,
I want to click Complete on a focused pad's popup and watch the pad flash green and dissolve as a creature emerges into the ecosystem,
so that completing a task feels rewarding without relying on a fragile egg-hatch animation.

## Dependencies

- **Story 2.3** (In-Scene Neon Wireframe Action Popup) must land first — the popup primitive is the entry point for this action.
- **Story 7.2** rarity selection logic moves into the popup Complete handler (see Technical Notes).

## Acceptance Criteria

1. **Given** an active todo's Action Popup is open (see Story 2.3), **When** I click the Complete action, **Then** the pad pulses green for ~200ms.

2. **Given** the green flash begins, **When** the flash peaks, **Then** a creature emerges from the pad — creature type selected by rarity tier (common ~50%, uncommon ~35%, rare ~12%, legendary ~3%) — and joins the ecosystem with autonomous movement.

3. **Given** the creature has emerged, **When** the flash completes, **Then** the pad dissolves into the water surface over 600-900ms with a fade and subtle ripple.

4. **Given** the dissolve completes, **When** the popup is still open, **Then** the popup closes and the camera returns to its prior position (300-500ms eased).

5. **Given** the complete action is triggered, **When** the frontend calls the backend, **Then** `PATCH /api/todos/{id}` sets `completed=true, completed_at=NOW()` and a creature record is created server-side with `todo_id`, `creature_type`, `rarity`.

6. **Given** a todo is marked `completed=true`, **When** the pond re-renders, **Then** the completed todo no longer renders in the pond and is excluded from search results (the record persists in the database for ecosystem creature counts).

7. **Given** rare or legendary rarity is rolled, **When** the creature emerges, **Then** an additional celebration effect triggers per Story 7.2 (extra particles / secondary ripple / ecosystem reaction).

8. **Given** ~20% of completions regardless of rarity, **When** the creature emerges, **Then** a bonus ambient animation fires (extra fireflies, fish jump, or frog croak — randomized).

## Tasks / Subtasks

- [ ] Task 1: Remove obsolete egg-hatch code (AC: all)
  - [ ] Delete `frontend/src/components/creatures/CompletionEgg.tsx`
  - [ ] Delete `frontend/src/hooks/useCreatureHatch.ts`
  - [ ] Remove egg-state fields and hatched-shell rendering from `LilyPad.tsx`
  - [ ] Remove uncomplete path (no reactivation in v1 — completion is terminal)
  - [ ] Delete or update any tests referencing CompletionEgg / egg click

- [ ] Task 2: Implement popup Complete handler (AC: 1, 2, 5, 7, 8)
  - [ ] Create `frontend/src/hooks/usePopupComplete.ts` — rarity roll, server call, creature spawn orchestration, dissolve trigger
  - [ ] Move rarity selection logic (was in `useCreatureHatch.ts`) into `usePopupComplete.ts`
  - [ ] Wire Complete button in `ActionPopup.tsx` → `usePopupComplete()`
  - [ ] Call `PATCH /api/todos/{id}` with `completed=true`
  - [ ] Dispatch creature spawn into ecosystem manager (existing pattern)

- [ ] Task 3: Pad green flash animation (AC: 1)
  - [ ] Add a `greenFlash` state to `LilyPad.tsx` triggered by the complete handler
  - [ ] Shader or material swap for ~200ms green pulse
  - [ ] Match timing with creature emergence beat in AC 2

- [ ] Task 4: Unified dissolve animation (AC: 3, 4)
  - [ ] Extract shared dissolve animation (alpha fade + subtle ripple) into `useLilyPadDissolve.ts` or equivalent — reusable by Story 2.4 (Delete)
  - [ ] 600-900ms duration with eased alpha to 0 and ripple radiating outward
  - [ ] On dissolve complete: remove pad from rendered set
  - [ ] Close popup and trigger camera return via existing camera focus system (see `PondCamera.tsx`)

- [ ] Task 5: Backend completion endpoint (AC: 5)
  - [ ] Update or confirm `PATCH /api/todos/{id}` accepts `completed=true` and sets `completed_at=NOW()`
  - [ ] Server-side creature record creation during the completion request (instead of a separate `POST /api/creatures` call — that endpoint is being removed)
  - [ ] Response includes the created creature record so the frontend can spawn it without an extra round trip

- [ ] Task 6: Render filtering (AC: 6)
  - [ ] Update pond rendering to filter out `completed=true` and `deleted=true` records from the active set
  - [ ] Verify ecosystem creature count still reflects completed todo count (the completed records persist)
  - [ ] Verify search endpoint (Story 5.2) excludes completed/deleted from default results

- [ ] Task 7: Casino celebration variants (AC: 7, 8)
  - [ ] Rare/legendary rarity tier visual amplification (particle burst, secondary ripple, ecosystem reaction)
  - [ ] 20% bonus ambient animation trigger (extra fireflies, fish jump, frog croak)
  - [ ] Randomness seeded to feel varied across sessions

- [ ] Task 8: Tests
  - [ ] Unit test for `usePopupComplete` — rarity distribution, server call, state transitions
  - [ ] Integration test for Complete flow end-to-end (popup open → Complete click → flash → creature → dissolve → backend update)
  - [ ] Regression test: completed todos do not appear in pond render or search

## Technical Notes

- **Rarity selection** moves from `useCreatureHatch.ts` into `usePopupComplete.ts`. Enum becomes `common | uncommon | rare | legendary` (the `resident` tier is removed with Epic 6).
- **Creature spawn source** changes from "cracked egg" to "pad during green flash" — visually it's a creature emerging in a burst of light from the pad's center before the pad dissolves.
- **No uncomplete path** — removed per PRD simplification. Once a todo is completed, the record persists but is hidden; there is no surface to reactivate it in v1.
- **Shared dissolve** — the dissolve animation in Task 4 is intentionally reusable by Story 2.4 (Delete). The difference is the preceding flash color (green vs red) and whether a creature spawns.
- **Camera return** — leverage the existing `cameraFocus` system in `PondCamera.tsx` (recent uncommitted optimization kept: skip zoom when already close).

## Out of Scope

- Uncompleting a todo (removed in v1)
- Completed todo recovery / restoration (no recovery in v1)
- Completion undo (popup dismisses before Complete click if user wants to abort)
