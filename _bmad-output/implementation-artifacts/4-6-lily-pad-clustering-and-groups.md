# Story 4.6: Lily Pad Clustering & Groups

Status: ready-for-dev

> **Scope note — the deferred grouping system from original Epic 4.2.** PRD FR10–FR12 (group pads, ungroup, cluster label) plus the cluster-drag and drag-in/out-of-clusters portion of FR13. The basic single-pad drag landed in Story 4.2.
>
> **Good news: most of the plumbing is already in the codebase.** The initial Alembic migration already created the `groups` and `group_memberships` tables. The SQLAlchemy models (`Group`, `GroupMembership`) live in `backend/src/models/group.py`. `GroupNotFoundError` exists in `backend/src/exceptions.py`. The frontend `Group` type is in `frontend/src/types/index.ts`. The `ActionPopup` already renders a "Group" button with an `onGroup` stub. No new Alembic migration needed. No new migration ever — one migration only, no backwards-compat shims.
>
> **What ships:**
> 1. **Backend group API** — `POST /api/groups`, `PATCH /api/groups/{id}`, `DELETE /api/groups/{id}`. No migration needed.
> 2. **`group_id` on `TodoResponse`** — `GET /api/todos` returns each todo's optional `group_id`.
> 3. **Multi-select** — Shift/Ctrl-click pads to build a selection set (ring-pulse visual). Used to choose which pads to include when creating a group.
> 4. **Extended ActionPopup** — clicking any pad opens the existing `ActionPopup` as before. When the pad **is already in a group**, a thin separator line is appended below the existing four buttons, followed by three group-specific actions: **Ungroup**, **Spread Out** (just this group), and **Label** (inline input). When the pad is **not** in a group, the existing "Group" button creates a group from this pad + any currently-selected pads (requires ≥ 1 other pad selected).
> 5. **Cluster visual** — grouped pads share an expanded outer glow ring (second `GlowSource`). Label floats above the cluster centroid as a CSS overlay.
> 6. **Cluster drag** — dragging a grouped pad moves all group members as a rigid unit.
> 7. **Drag into/out of cluster** — dropping near a group's centroid adds the pad; dropping far away removes it. Either transition triggers an automatic spread-out of the affected group members.
> 8. **`/spread-out` group awareness** — `spreadOutCommand.ts` passes real group memberships so clusters move as units.
>
> **No `SelectionPopup` component.** All group actions live inside the existing `ActionPopup`. No G/U keyboard shortcuts. No centroid popup.

---

## Frontend conventions (recap)

- **State**: `usePondStore` for selection + cluster data. Follows the `Set<string>` pattern used for `searchResults`.
- **`groupId` on `Todo`**: add `groupId: string | null` to `frontend/src/types/index.ts`.
- **`ActionPopup` extension**: the existing `ActionPopup.tsx` gains an optional group section rendered below a `<hr>` separator when `isGrouped` is true. New props: `isGrouped`, `onUngroup`, `onSpreadGroup`, `groupLabel`, `onSetLabel`. Keep the existing four-button layout completely unchanged for non-grouped pads.
- **Group API hooks**: new `frontend/src/api/groupApi.ts` following the React Query mutation pattern from `todoApi.ts`.
- **Cluster glow**: second `<GlowSource radius={2.8} strength={0.4} color="#ffffff" />` sibling in LilyPad when `todo.groupId` is non-null.
- **Cluster drag**: imperative group-delta pattern — the dragged pad's position delta is broadcast to all group members via a store slice; each member reads it in its own `useFrame`.

---

## Backend conventions (recap)

- **Sync only** — no `async def`, per CLAUDE.md Principle VI.
- **Schema**: `backend/src/schemas/group.py` — `GroupCreate`, `GroupUpdate`, `GroupResponse`.
- **Service**: `backend/src/services/group_service.py` — `create_group`, `get_group`, `update_group`, `delete_group`.
- **Router**: `backend/src/api/groups.py` — prefix `/api/groups`. Wire into `backend/src/main.py`.
- **`TodoResponse.group_id`**: add `group_id: uuid.UUID | None = None`; populate via left-join on `group_memberships` in `list_todos`.

---

## Story

As a user,
I want to group lily pads via the existing Action Popup — seeing group actions inline when a grouped pad is clicked, and selecting pads before opening a non-grouped pad's popup to create a group — so that spatial organisation flows naturally through the same popup I already use for every other action.

---

## Acceptance Criteria

### Multi-select (for group creation)

1. **Given** no popup is open, **When** I Shift-click or Ctrl-click (Meta on macOS) a pad, **Then** that pad is added to the selection set and renders a white outer rim oscillation (scale 1.0–1.05 at 2 Hz). Shift/Ctrl-clicking the same pad again removes it. Selection persists until cleared.

2. **Given** a selection exists, **When** I press Escape (no popup, no search active), **Then** the selection is cleared.

### ActionPopup — non-grouped pad

3. **Given** a pad is NOT in a group, **When** I click it (normal click, no modifier), **Then** the `ActionPopup` opens with its existing four buttons (Complete, Delete, Set Color, Group) — unchanged from today. Any currently-selected pads remain selected (plain click on a non-grouped pad does NOT clear the selection).

4. **Given** the ActionPopup is open on a non-grouped pad AND `selectedPadIds.size ≥ 1`, **When** I click **Group**, **Then** `POST /api/groups` is called with `member_ids: [popupTodo.id, ...selectedPadIds]`. On success: selection is cleared, popup closes, pads drift toward each other in a ring formation (500ms via `padTargetPositions`), todos query is invalidated. If `selectedPadIds.size === 0`, the Group button is disabled (grayed out, `pointer-events: none`) — you cannot group a single pad.

### ActionPopup — grouped pad (extended layout)

5. **Given** a pad IS in a group, **When** I click it (normal click), **Then** the `ActionPopup` opens with the existing four buttons first, then a thin separator (`<hr>` styled as a 1px neon-cyan line at 0.2 opacity), then three group buttons in order: **Ungroup**, **Spread Out**, **Label**.

6. **Given** the extended ActionPopup is open, **When** I click **Ungroup**, **Then** `DELETE /api/groups/{groupId}` is called. On success: popup closes, pads drift apart with an outward ripple from the former centroid, todos query is invalidated.

7. **Given** the extended ActionPopup is open, **When** I click **Spread Out**, **Then** `computeSpreadPositions` runs scoped to just the group's members (not the whole pond); result is pushed into `padTargetPositions`; popup closes. Each pad fires its own `PATCH` on arrival at its target.

8. **Given** the extended ActionPopup is open, **When** I click **Label**, **Then** an inline `<input>` field expands within the popup (no separate modal). If the group already has a label, it pre-fills the input. Pressing Enter with text → `PATCH /api/groups/{id} { label: text }` and the input collapses. Pressing Enter with empty text → `PATCH /api/groups/{id} { label: null }` (removes label). Pressing Escape collapses the input without saving.

9. **Given** the extended ActionPopup is open, **When** I take any action (Ungroup, Spread Out, or commit a Label), **Then** the existing Complete/Delete/Set Color buttons remain fully functional — they do not change for grouped pads.

### Cluster visual

10. **Given** a pad is a member of a group, **When** it renders, **Then** it shows a second outer glow ring (`radius = 2.8`, `strength = 0.4`, `color = "#ffffff"`) alongside its primary halo. Solo pads show no second ring.

11. **Given** a group has a non-null label, **When** at least one member is visible, **Then** a `<div>` floats above the cluster centroid (world-to-screen projected imperatively each frame) in `Share Tech Mono`, neon-cyan, `font-size: 11px`, `opacity: 0.8`.

### Cluster drag

12. **Given** a pad is in a group, **When** I drag it (story 4.2 mechanics), **Then** all other group members move by the same world-space delta in real time. On release, `PATCH /api/todos/{id}` fires for every group member.

13. **Given** I drag a solo pad and release within 1.5 world units of another group's centroid, **Then** `PATCH /api/groups/{id}` adds the pad to that group. The group members then automatically spread out (AC #14).

14. **Given** any of these events — pad joins a group (snap-in), pad leaves a group (snap-out), or Group created via popup — **When** the backend responds successfully, **Then** `computeSpreadPositions` runs automatically on the affected group members and pushes targets into `padTargetPositions`.

15. **Given** I drag a grouped pad outside the group's snap radius and release on empty water, **Then** the pad is removed from the group (`PATCH /api/groups/{id}` with the remaining member IDs; `DELETE /api/groups/{id}` if only one member would remain). Remaining members auto-spread (AC #14).

### Backend

16. **Given** `POST /api/groups { member_ids, label? }` with all valid active todos none already in a group, **Then** 201 `{ id, label, member_ids, created_at }`. Returns 400 if any ID is already in a different group.

17. **Given** `PATCH /api/groups/{id} { label?, member_ids? }`, **Then** partial update. `member_ids` replaces the full membership set. Returns 404 if not found.

18. **Given** `DELETE /api/groups/{id}`, **Then** 204; group row deleted (CASCADE removes memberships); todos untouched.

19. **Given** `GET /api/todos`, **Then** each todo includes `group_id: uuid | null`.

### /spread-out group awareness

20. **Given** `/spread-out` runs with grouped pads present, **Then** grouped pads move as rigid units — `spreadOutCommand.ts` builds `groupings` from `todo.groupId` and passes them to `computeSpreadPositions`.

### Quality gate

21. **Given** full test suite runs, **Then** all existing 259 frontend tests plus new tests pass. New tests: selection toggle, Group button disabled when no pads selected, Group button calls `POST /api/groups` with popup id + selectedPadIds, extended section rendered when `isGrouped=true`, Ungroup calls `DELETE`, Spread Out scopes to group members, Label input commits on Enter / clears on empty / cancels on Escape, cluster glow ring rendered when `groupId` non-null, cluster drag moves all members, snap-to-group triggers auto-spread, snap-out triggers auto-spread on remaining members.

---

## Tasks / Subtasks

- [ ] **Task 1: Backend — schemas and service** (AC: #16–#19)
  - [ ] Create `backend/src/schemas/group.py`:
    ```python
    import uuid
    from datetime import datetime
    from pydantic import BaseModel, ConfigDict

    class GroupCreate(BaseModel):
        member_ids: list[uuid.UUID]
        label: str | None = None

    class GroupUpdate(BaseModel):
        label: str | None = None
        member_ids: list[uuid.UUID] | None = None

    class GroupResponse(BaseModel):
        model_config = ConfigDict(from_attributes=True)
        id: uuid.UUID
        label: str | None
        member_ids: list[uuid.UUID]
        created_at: datetime
    ```
  - [ ] Create `backend/src/services/group_service.py` (all sync, `db: Session`):
    - `create_group(db, data: GroupCreate) -> GroupResponse` — validate no member already in a group; insert `Group` + `GroupMembership` rows; commit; return `GroupResponse` with `member_ids` loaded via follow-up query.
    - `get_group(db, group_id: uuid.UUID) -> Group` — raises `GroupNotFoundError`.
    - `update_group(db, group_id: uuid.UUID, data: GroupUpdate) -> GroupResponse` — partial update; for `member_ids`, delete old rows then insert new.
    - `delete_group(db, group_id: uuid.UUID) -> None` — delete `Group` row; CASCADE handles memberships.
  - [ ] Extend `todo_service.list_todos` to return `group_id` via left-join on `GroupMembership`:
    ```python
    rows = (
        db.query(Todo, GroupMembership.group_id)
        .outerjoin(GroupMembership, Todo.id == GroupMembership.todo_id)
        .filter(Todo.archived == False, or_(*clauses))
        .order_by(Todo.created_at.desc())
        .all()
    )
    ```
    Assemble `TodoResponse` from `(Todo, group_id)` tuples in the route handler.
  - [ ] Add `group_id: uuid.UUID | None = None` to `backend/src/schemas/todo.py:TodoResponse`.
  - [ ] Write `backend/tests/services/test_group_service.py`: create round-trip, create fails if member already grouped, update label only, update member_ids replaces set, delete removes group (todos stay), `list_todos` includes `group_id`.

- [ ] **Task 2: Backend — API router** (AC: #16–#18)
  - [ ] Create `backend/src/api/groups.py` with `POST`, `PATCH /{group_id}`, `DELETE /{group_id}`. All sync route handlers.
  - [ ] Wire `groups.router` into `backend/src/main.py`.
  - [ ] Write `backend/tests/api/test_groups.py`: POST creates → 201; POST with already-grouped member → 400; PATCH label → 200; PATCH member_ids → 200; DELETE → 204; DELETE missing → 404.

- [ ] **Task 3: Frontend — types + API hooks** (AC: #4, #6–#8, #12–#15, #20)
  - [ ] Add `groupId: string | null` to `frontend/src/types/index.ts:Todo`.
  - [ ] Create `frontend/src/api/groupApi.ts` with `useCreateGroup`, `useUpdateGroup`, `useDeleteGroup`. All invalidate `TODOS_KEY` on success.

- [ ] **Task 4: Store — selection slice** (AC: #1–#2)
  - [ ] In `usePondStore.ts`, add `selectedPadIds: Set<string>`, `togglePadSelection(id)`, `clearSelection()`. Initialise to `new Set()`. Immutable updates.
  - [ ] Tests: toggle adds, toggle again removes, clear empties.

- [ ] **Task 5: LilyPad — selection visual + Shift/Ctrl click** (AC: #1–#2)
  - [ ] In `LilyPad.tsx`'s `onPointerDown`: if `e.shiftKey || e.ctrlKey || e.metaKey`, call `togglePadSelection(todo.id)` and return early (no drag, no popup).
  - [ ] Subscribe `isSelected = usePondStore((s) => s.selectedPadIds.has(todo.id))`.
  - [ ] In `useFrame` resting phase: if `isSelected`, apply scale oscillation `1.0 + 0.05 * Math.abs(Math.sin(t * Math.PI * 4))`.
  - [ ] Escape key: extend existing escape handling to also call `clearSelection()` when no popup/search is active.
  - [ ] Plain click (no modifier) on any pad does NOT clear the selection — `onPointerUp` already only opens the popup; it does not touch `selectedPadIds`.

- [ ] **Task 6: `ActionPopup` — extended group section** (AC: #3–#9)
  - [ ] New props in `ActionPopupProps`:
    ```ts
    isGrouped?: boolean;
    groupLabel?: string | null;
    selectedCount?: number;   // drives Group button enabled/disabled
    onUngroup?: () => void;
    onSpreadGroup?: () => void;
    onSetLabel?: (label: string | null) => void;
    ```
  - [ ] In `ActionPopup.tsx`, the "Group" button changes:
    - When `!isGrouped && selectedCount === 0`: render disabled (greyed, `pointer-events: none`) — cannot group a solo pad.
    - When `!isGrouped && selectedCount >= 1`: render enabled, label "Group" — clicking fires `onGroup` (existing prop, now wired to create-group path in `PondScene`).
    - When `isGrouped`: the "Group" button is removed from the four-button row entirely; the group section below the separator replaces it.
  - [ ] Below the four-button row, when `isGrouped`, render:
    ```tsx
    <hr className="action-popup__group-separator" />
    <div className="action-popup__group-section">
      <button onClick={onUngroup}>Ungroup</button>
      <button onClick={onSpreadGroup}>Spread Out</button>
      <button onClick={() => setLabelOpen(true)}>Label</button>
      {labelOpen && (
        <input
          autoFocus
          defaultValue={groupLabel ?? ''}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onSetLabel?.(e.currentTarget.value.trim() || null);
              setLabelOpen(false);
            }
            if (e.key === 'Escape') setLabelOpen(false);
          }}
        />
      )}
    </div>
    ```
  - [ ] `labelOpen: boolean` is local state in `ActionPopup`. No store involvement.
  - [ ] Add CSS in `ActionPopup.css`: `.action-popup__group-separator` — `border: none; border-top: 1px solid rgba(0, 238, 255, 0.2); margin: 6px 0`; `.action-popup__group-section` — flex row, same gap as main buttons.
  - [ ] Tests in `ActionPopup.test.tsx`: group section renders when `isGrouped=true`; group section absent when `isGrouped=false`; Group button disabled when `selectedCount=0`; Group button enabled when `selectedCount=1`; Label input appears on click, Enter calls `onSetLabel` with trimmed value, Enter with empty string calls `onSetLabel(null)`, Escape closes input without calling.

- [ ] **Task 7: PondScene — wire extended ActionPopup** (AC: #4, #6–#8, #14)
  - [ ] Import `useCreateGroup`, `useUpdateGroup`, `useDeleteGroup` from `groupApi.ts`.
  - [ ] Pass new props to `<ActionPopup>`:
    ```tsx
    isGrouped={!!popupTodo?.groupId}
    groupLabel={groups.get(popupTodo?.groupId ?? '')?.label ?? null}
    selectedCount={selectedPadIds.size}
    onUngroup={() => {
      deleteGroup.mutate(popupTodo!.groupId!, {
        onSuccess: () => {
          usePondStore.getState().triggerRipple(popupTodo!.positionX ?? 0, popupTodo!.positionY ?? 0);
          autoSpread(/* former members, now ungrouped */);
        }
      });
      store.closePopup();
    }}
    onSpreadGroup={() => {
      const members = renderTodos.filter(t => t.groupId === popupTodo!.groupId);
      autoSpread(members);
      store.closePopup();
    }}
    onSetLabel={(label) => updateGroup.mutate({ id: popupTodo!.groupId!, label })}
    ```
  - [ ] `groups: Map<groupId, Group>` — derive from `renderTodos` by collecting unique groupIds + labels. A simple `useMemo` from `renderTodos`.
  - [ ] `selectedPadIds` from store via `usePondStore((s) => s.selectedPadIds.size)` (subscribe to size, not the set, to avoid reference-equality issues).
  - [ ] Replace the `onGroup` stub:
    ```ts
    onGroup={() => {
      if (!popupTodo || selectedPadIds.size === 0) return;
      const memberIds = [popupTodo.id, ...Array.from(store.selectedPadIds)];
      createGroup.mutate({ memberIds }, {
        onSuccess: () => autoSpread(renderTodos.filter(t => memberIds.includes(t.id)))
      });
      store.clearSelection();
      store.closePopup();
    }}
    ```
  - [ ] `autoSpread(members: Todo[])` — module-level helper in `PondScene.tsx`:
    ```ts
    function autoSpread(members: Todo[]): void {
      const groupings = new Map(members.filter(t => t.groupId).map(t => [t.id, t.groupId!]));
      const targets = computeSpreadPositions(members, groupings);
      if (targets.size > 0) usePondStore.getState().setTargetPositions(targets);
    }
    ```

- [ ] **Task 8: LilyPad — cluster glow ring** (AC: #10)
  - [ ] When `todo.groupId` is non-null, render a second `<GlowSource radius={2.8} yOffset={GLOW_Y_OFFSET} strength={0.4} color="#ffffff" />`. If `GlowSource` doesn't accept a `color` prop, add one defaulting to the current uniform value.

- [ ] **Task 9: Cluster label overlay** (AC: #11)
  - [ ] Create `frontend/src/components/pond/ClusterLabel.tsx` — receives `label: string`, `memberPositions: {x: number; z: number}[]`. Projects centroid to screen each frame imperatively via `useFrame` + `useThree`. Renders via `createPortal` into `todo-input-overlay`.
  - [ ] In `PondScene.tsx`, derive one `<ClusterLabel>` per group with a non-null label from `renderTodos`.

- [ ] **Task 10: Cluster drag — rigid group movement** (AC: #12)
  - [ ] In `usePondStore`, add `groupDragAnchor: { groupId: string; anchorId: string; dx: number; dz: number } | null` + `setGroupDragAnchor(...)` + `clearGroupDragAnchor()`.
  - [ ] In `LilyPad.tsx` drag `onPointerMove`: when `isDraggingRef.current && todo.groupId`, compute the delta from the pad's rest position and call `setGroupDragAnchor({ groupId: todo.groupId, anchorId: todo.id, dx, dz })`.
  - [ ] Every OTHER group member reads `groupDragAnchor` in its `useFrame` and applies the delta imperatively to `group.position.x/z`.
  - [ ] On `onPointerUp` for a grouped pad: `clearGroupDragAnchor()`; fire `updateTodo.mutate({ id, positionX, positionY })` for each group member at its final position (PondScene handles this via `onDragEnd` callback prop).

- [ ] **Task 11: Snap-in / snap-out + auto-spread** (AC: #13–#15)
  - [ ] Pass `onDragEnd?: (worldX: number, worldZ: number) => void` prop to `LilyPad`.
  - [ ] In `PondScene`, compute group centroids from `renderTodos`. In `onDragEnd`:
    - **Snap in**: if within 1.5 units of a group centroid and pad not in that group → `updateGroup.mutate({ id: nearestGroup.id, memberIds: [...existing, todo.id] }, { onSuccess: () => autoSpread(newMembers) })`.
    - **Snap out**: if dropped far from any group and pad WAS in a group → remove from group (`updateGroup.mutate` with remaining IDs, or `deleteGroup` if only 1 member would remain), then `autoSpread(remainingMembers)`.

- [ ] **Task 12: `/spread-out` group awareness** (AC: #20)
  - [ ] In `spreadOutCommand.ts`'s `execute()`, build `groupings: Map<string, string>` from todos with non-null `groupId`. Pass to `computeSpreadPositions`. No changes to the algorithm.

- [ ] **Task 13: Tests & quality gate** (AC: #21)
  - [ ] `npx vitest run` — all new + existing tests green.
  - [ ] `npx tsc --noEmit`.
  - [ ] `DATABASE_URL=...todo_pond_test python -m pytest tests/ -q`.
  - [ ] `ruff check src/ && ruff format --check src/ && mypy src/ --strict`.

---

## Dev Notes

### No Alembic migration — one migration, no backwards compat

The project has exactly **one** migration (`7af34c6df37c_initial_schema.py`) and that is where it stays. `groups` and `group_memberships` tables exist there. Do not add a second migration, alter-table statements, or backwards-compat shims. If a column needs to change, edit the initial migration and re-run from scratch on the dev DB.

### Why no SelectionPopup

Group actions are appended inline to the existing `ActionPopup`. This keeps all pad interactions in one place — the popup the user already knows — rather than introducing a new UI surface at an arbitrary centroid. The selection is used only at the moment the "Group" button is clicked; after that it's cleared.

### Plain click does not clear the selection

This is important for the group-creation flow: the user Shift-clicks several pads, then plain-clicks the pad they want to be the "primary" in the group, the popup opens, and the Group button is enabled. If plain click cleared the selection, the Group button would always be disabled when the popup opens. `onPointerUp` for a plain click (non-drag) opens the popup but leaves `selectedPadIds` untouched.

### `TodoResponse.group_id` via outerjoin

The `Todo` ORM model has no `group_id` column — use an outerjoin in `list_todos`:
```python
rows = (
    db.query(Todo, GroupMembership.group_id)
    .outerjoin(GroupMembership, Todo.id == GroupMembership.todo_id)
    .filter(Todo.archived == False, or_(*clauses))
    .order_by(Todo.created_at.desc())
    .all()
)
return [
    TodoResponse(**TodoResponse.model_validate(todo).model_dump(), group_id=gid)
    for todo, gid in rows
]
```
The visibility filter clauses from story 3.3 apply unchanged.

### `autoSpread` is a pure side-effect helper in PondScene

`autoSpread(members: Todo[])` calls `computeSpreadPositions` and pushes into `padTargetPositions`. It's called after: group creation (onSuccess), ungroup (onSuccess), snap-in (onSuccess), snap-out (onSuccess), and the "Spread Out" button in the popup. Centralising it here avoids duplication.

### Cluster drag delta

On `pointerDown` for a grouped pad, capture the rest position (`posX`, `posZ`). On each `onPointerMove`, compute `dx = dragPosRef.x - posX` and `dz = dragPosRef.z - posZ` and broadcast via `groupDragAnchor`. Every sibling reads the delta in its `useFrame` and applies it to `posX + dx`, `posZ + dz`. On `pointerUp`, the siblings' final position is `posX + finalDx`, `posZ + finalDz`, which the PondScene `onDragEnd` uses to fire their PATCHes.

### One-group-per-todo enforcement

The backend service rejects `POST /api/groups` if any `member_id` is already in a group. Query `group_memberships` for existing rows before inserting and raise HTTP 400 if any are found.

### Deferred items

- **FR20: Cluster-aware search** — story 5.6 (already drafted); depends on this story landing first.
- **LightningBorder cluster aura** — the UX spec mentions electric arcs between members. This story uses a simpler second `GlowSource`. Polish story if the effect reads as too subtle.
- **Batch position endpoint** (`PATCH /api/todos/positions`) — individual PATCHes for cluster drag are fine at ≤ 30 pads. Promote if performance degrades.

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
- [ ] Backend ruff + mypy clean
- [ ] Committed at task checkpoints per CLAUDE.md
