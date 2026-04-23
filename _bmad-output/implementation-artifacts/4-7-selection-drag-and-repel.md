# Story 4.7: Selection-Drag & Repel

Status: backlog

> **Scope note — replacement for the removed Story 4.6.** Persistent
> groups (shared halo, drag handle, pop-in/pop-out, group labels,
> group colors, `/api/groups` endpoints) were deleted per
> `planning-artifacts/sprint-change-proposal-2026-04-23.md`.
> Selection via shift/ctrl-click survived — this story makes it the
> ONLY "grouping" primitive and extends it to behave like a
> temporary group during drag.
>
> **What ships:**
> 1. **Selection-as-temporary-group**: when ≥ 1 pad is selected and
>    the user drags any pad that IS in the selection, EVERY selected
>    pad translates together by the same (dx, dz). Non-selected pads
>    nearby slide out of the way (existing `activeDragAnchor` nudge,
>    extended to check every selected-pad's position as an anchor,
>    not just the dragged one).
> 2. **Release commits positions for the whole selection**: each
>    selected pad fires its own `PATCH /api/todos/{id}` with the new
>    `(position_x, position_y)`. Existing `stickyDragRef` pattern
>    pins each pad at its new position until the refetch lands so
>    there's no flash-back.
> 3. **Drag a non-selected pad — solo drag, unchanged.** Selection
>    is ignored when the dragged pad's id is not in `selectedPadIds`;
>    existing single-pad drag (Story 4.2) applies. Non-selected
>    nearby pads still repel via `activeDragAnchor`.
>
> **No backend changes.** The PATCHes fire one per selected pad as
> they already do today; a batch endpoint is a future optimisation.
>
> **No new store slices.** `selectedPadIds` + `activeDragAnchor`
> already exist; this story extends their consumption in LilyPad's
> drag pipeline.

---

## Frontend conventions (recap)

- **Store state** lives in [frontend/src/stores/usePondStore.ts](frontend/src/stores/usePondStore.ts). `selectedPadIds: Set<string>` is already populated by the existing Shift/Ctrl-click handler in LilyPad (`togglePadSelection`); Escape clears via `clearSelection` in the existing `useClosePopupOnEscape` path.
- **Drag pipeline** lives in [frontend/src/components/pond/LilyPad.tsx](frontend/src/components/pond/LilyPad.tsx) — `handlePadPointerDown`, `onWindowMove`, `onWindowUp`. The `isDraggingRef` / `stickyDragRef` / `dragPosRef` triple already handles single-pad drag + post-release sticky pinning.
- **Nudge** lives in the `useFrame` resting-branch else block in LilyPad. `activeDragAnchor` is read imperatively each frame; when set and not this pad, the pad computes a radial push to `NUDGE_RADIUS = 2 × SELECTION_RING_OUTER`. This stays. The story extends it so the anchor test is broadened to "is any selected pad nearby?" (for the case where the drag is the selected group moving as a unit).
- **Testing**: pure store actions via `usePondStore.setState`; drag mechanics via `LilyPad.test.tsx`'s existing mouse-event helpers (`fireClickAt`, window-level pointermove).

---

## Story

As a user, I want Shift/Ctrl-clicking a few lily pads and then dragging one of them to move all of them together — and I want the pads I didn't select to slide aside as the group passes — so that I can reposition logical clusters of todos without the overhead of persistent group objects.

---

## Acceptance Criteria

### Selection-as-temporary-group drag

1. **Given** `selectedPadIds.size ≥ 2` and pad P is in `selectedPadIds`, **When** I drag P by more than the 4 px threshold, **Then** P and every other pad in `selectedPadIds` translates by the same world-space (dx, dz) every pointermove. The relative layout of the selection is preserved.

2. **Given** `selectedPadIds.size === 0`, **When** I drag any pad, **Then** only that pad moves (existing Story 4.2 behavior) — no selection machinery engages.

3. **Given** `selectedPadIds.size ≥ 1` and pad P is NOT in `selectedPadIds`, **When** I drag P, **Then** only P moves (the selection is ignored for this drag). The selection set is NOT cleared by the drag.

4. **Given** selected pads are mid-translation during a drag, **Then** the dragged pad follows the cursor exactly (as in Story 4.2 — raycast to water plane). Other selected pads offset by the same (dx, dz) from their pre-drag positions.

### Release + persist

5. **Given** I release a selection-drag, **Then** each selected pad fires `PATCH /api/todos/{id}` with `{ position_x: preDragX + dx, position_y: preDragZ + dz }`. Each pad sets its own `stickyDragRef.current = true` and pins at its new position until its refetched `positionX/Y` catches up (same sticky-pin pattern single-pad drag uses). No flash-back when refetch arrives.

6. **Given** any individual PATCH fails after retry exhaustion, **Then** the existing decay visual (Story 2.6) lights up on just that pad — the other selected pads remain healthy. No rollback of the successful members.

### Non-selected pads slide aside

7. **Given** a selection-drag is in progress, **Then** every non-selected pad in the pond reads `activeDragAnchor` + the LIVE positions of every other selected pad and computes the CLOSEST among them. If the closest selected pad is within `NUDGE_RADIUS = 2 × SELECTION_RING_OUTER`, the non-selected pad applies the existing radial push. Magnitude + smoothing are unchanged (push to exactly `NUDGE_RADIUS` from the closest anchor; lerp at 0.35).

8. **Given** a non-selected pad built up a significant nudge during the drag (> 0.05 world units on either axis), **When** the drag ends, **Then** its nudged position is committed via `PATCH /api/todos/{id}` (existing release-commit logic from the current single-pad drag).

### Selection visual & controls

9. **Given** `selectedPadIds.size > 0`, **Then** every selected pad renders the white pulsing outer rim at `SELECTION_RING_OUTER = 1.22` (existing visual from Story 4.6 Task 5). No halo ring, no shared glow, no label.

10. **Given** Escape is pressed with no popup and no search active, **Then** `clearSelection()` empties `selectedPadIds`. The white rings fade out per the existing animation.

11. **Given** I plain-click any pad (no modifier), **Then** the selection is NOT cleared — `activePopupTodoId` is set for the clicked pad and the ActionPopup opens. (Matches today's behavior; called out here because it's easy to regress.)

### Quality gate

12. **Given** the full test suite runs, **Then** all existing `299+` frontend tests stay green plus new tests cover: multi-pad drag translates the whole selection, non-selected pad drag ignores selection, non-selected pad slides aside when dragged-selection approaches, release commits every nudged pad's position. Backend `114+` tests unchanged.

---

## Tasks / Subtasks

- [ ] **Task 1: Pre-drag selection snapshot** (AC: #1, #3)
  - [ ] In `LilyPad.tsx`'s `handlePadPointerDown`, after the modifier-click early-return and the drag-start state setup, snapshot whether this drag is a selection-drag:
    ```ts
    const isSelectionDrag = usePondStore.getState().selectedPadIds.has(todo.id);
    isSelectionDragRef.current = isSelectionDrag;
    if (isSelectionDrag) {
      // Snapshot every selected pad's pre-drag world position. Read
      // from the current renderTodos via a store-registered getter
      // or a new per-pad "baselinePosition" ref populated at drag
      // start — whichever is less invasive.
      const selectionSnapshot = new Map<string, { x: number; z: number }>();
      // populate from currentTodos...
      selectionSnapshotRef.current = selectionSnapshot;
    } else {
      selectionSnapshotRef.current = null;
    }
    ```
  - [ ] The snapshot is frozen for the duration of the drag so a refetch mid-drag doesn't perturb the translation baseline.
  - [ ] Task 1 decides the shape of `selectionSnapshotRef`: a `Map<padId, PreDragPosition>`.

- [ ] **Task 2: Broadcast translation during drag** (AC: #1, #4)
  - [ ] In `onWindowMove`, after computing the new drag position, if `isSelectionDragRef.current === true`:
    ```ts
    const dx = newX - dragStartWorldRef.current.x;
    const dz = newZ - dragStartWorldRef.current.z;
    // Decide: global store slice, or passthrough to siblings via
    // a new setSelectionTranslation({ dx, dz, baselines })?
    ```
  - [ ] **Recommended**: reuse the existing `setActiveDragAnchor` for the repulsion part (unchanged), AND publish a new lightweight `selectionDragOffset: { dx, dz, baselines: Map<id, {x,z}> } | null` slice that ALL selected pads read each frame and apply on top of their pre-drag baseline. Null when not selection-dragging.
  - [ ] Alternative (simpler, no new slice): each SELECTED pad reads the DRAGGED pad's position via `activeDragAnchor` + its own baseline, then computes its offset from the DRAGGED pad's baseline. This keeps state flat but requires every selected pad to know the dragged pad's baseline. Same snapshot map works.

- [ ] **Task 3: Non-selected pad repulsion against MULTIPLE anchors** (AC: #7)
  - [ ] In `LilyPad.tsx`'s nudge branch, extend the closest-anchor check so when `selectionDragOffset` is set, the pad iterates every selected pad's CURRENT world position (= baseline + (dx, dz)) and computes the MINIMUM distance. Use that for the `NUDGE_RADIUS` compare. This is O(selection.size) per frame per pad — trivial for realistic selection sizes (< 20).

- [ ] **Task 4: Release commits every selected pad's new position** (AC: #5, #6)
  - [ ] In `onWindowUp`, if `isSelectionDragRef.current === true`, iterate `selectionSnapshotRef.current` and for each entry fire `updateTodo.mutate({ id, positionX: baseline.x + dx, positionY: baseline.z + dz })`. Each pad's own `stickyDragRef` should flip true (via a store slice `stickyGroupReleaseSnapshot: Map<id, {x, z}>`, or have each LilyPad observe its own selection membership and self-pin when it sees `selectionDragOffset` transition from non-null to null).
  - [ ] The DRAGGED pad's existing single-pad release path stays intact for when `isSelectionDrag` is false.
  - [ ] Clear `selectionDragOffset` + `isSelectionDragRef` + `selectionSnapshotRef` in the release cleanup.

- [ ] **Task 5: Tests** (AC: #12)
  - [ ] `LilyPad.test.tsx`: extend the existing drag tests with a selection-drag case — pre-select two pads via `togglePadSelection`, drag one, assert both move. Drag a NON-selected pad with a selection active, assert only it moves.
  - [ ] Store tests for the new `selectionDragOffset` slice (if introduced) — identity-preserving no-op on unchanged values.
  - [ ] `computeSpreadPositions` tests stay unchanged.
  - [ ] `npx vitest run` — all existing + new tests green.
  - [ ] `npx tsc --noEmit`.

- [ ] **Task 6: Quality gate**
  - [ ] `npx vitest run` + `npx tsc --noEmit` clean.
  - [ ] Backend `pytest` + `ruff` + `mypy --strict` clean (no backend changes, but re-run as sanity).

---

## Dev Notes

### Why a new `selectionDragOffset` slice (vs reusing `activeDragAnchor`)

`activeDragAnchor` is a single point — the DRAGGED pad's live position. It's sufficient for non-selected pads to compute their repulsion. But selected SIBLINGS also need to move by the same (dx, dz) that the dragged pad moved by. Deriving (dx, dz) from the anchor's current position vs. its pre-drag baseline requires each sibling to ALSO hold the dragged pad's baseline — duplicated state. Cleaner to put the (dx, dz) + baselines map directly into a single slice that siblings read once.

### Stickiness per member on release

Single-pad drag's `stickyDragRef` lives in LilyPad's component scope. For selection-drag, each selected LilyPad needs to know to flip its own sticky ref on release. Two routes:

1. **Observer pattern**: each LilyPad watches `selectionDragOffset` in a useEffect. When it transitions from non-null to null AND this pad was in `selectionSnapshotRef`, stamp `dragPosRef = baseline + (dx, dz)` + `stickyDragRef = true`. Trade-off: every selected pad re-renders when the slice changes (twice per drag — set + clear); cheap but non-zero.
2. **Publish pattern**: PondScene's drag-end handler iterates selection and calls a per-pad "commit sticky" via a store-level map. Keeps LilyPad passive. Trade-off: another store slice.

Option 1 is probably cleanest. The useEffect is narrow and the re-render count is bounded.

### What happens if the user toggles selection mid-drag

Shift-click toggles selection only on a STATIONARY click (no drag). The drag pipeline consumes the pointer before shift-click logic, so mid-drag there's no selection toggling. Escape might fire and clear selection — but that's fine: the drag uses `selectionSnapshotRef` (frozen at drag-start), not the live store. The only visible effect of an Escape mid-drag would be the white rings fading out immediately; the pads keep moving together until release.

### Deferred

- **Batch PATCH endpoint** (`PATCH /api/todos/positions`) would reduce release-time traffic to one request. Architecture already notes it. Promote if release feels sluggish with 10+ selected pads.
- **Group-object persistence** is gone entirely — no persistent grouping. If a future story needs it (e.g. saved workspaces), reintroduce the `groups` table and a `GroupSet` model distinct from ephemeral selection.

---

## Dev Agent Record

_To be completed during implementation._

### Implementation Notes

### Debug Log

### Completion Checklist

- [ ] All ACs implemented and manually verified
- [ ] All tasks checked off
- [ ] All tests green
- [ ] TypeScript clean
- [ ] Backend ruff + mypy clean (no backend changes but sanity-checked)
- [ ] Committed at task checkpoints per CLAUDE.md
