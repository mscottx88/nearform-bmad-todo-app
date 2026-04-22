# Story 4.6: Lily Pad Clustering & Groups

Status: ready-for-dev

> **Scope note — the deferred grouping system from original Epic 4.2.** PRD FR10–FR12 (group pads, ungroup, cluster label) plus the cluster-drag and drag-in/out-of-clusters portion of FR13. The basic single-pad drag landed in Story 4.2.
>
> **Good news: most of the plumbing is already in the codebase.** The initial Alembic migration already created the `groups` and `group_memberships` tables. The SQLAlchemy models (`Group`, `GroupMembership`) live in `backend/src/models/group.py`. `GroupNotFoundError` exists in `backend/src/exceptions.py`. The frontend `Group` type is in `frontend/src/types/index.ts`. The `ActionPopup` already renders a "Group" button with an `onGroup` stub. No new Alembic migration needed.
>
> **What ships:**
> 1. **Backend group API** — `POST /api/groups`, `PATCH /api/groups/{id}`, `DELETE /api/groups/{id}`. No migration needed.
> 2. **`group_id` on `TodoResponse`** — `GET /api/todos` returns each todo's optional `group_id`.
> 3. **Multi-select** — Shift/Ctrl-click pads to build a selection set (ring pulse visual on selected pads).
> 4. **Selection popup** — when ≥ 2 pads are selected, a `SelectionPopup` materialises at the centroid of the selection with four actions: **Group**, **Ungroup** (when applicable), **Spread Out** (just these pads), and **Label** (set/clear the cluster label with an inline input).
> 5. **Cluster visual** — grouped pads share an expanded outer glow ring (second `GlowSource`). Label floats above the cluster centroid as a CSS overlay.
> 6. **Cluster drag** — dragging a grouped pad moves all group members as a rigid unit.
> 7. **Drag into cluster** — dropping a dragged pad near another group's centroid adds it to that group.
> 8. **`/spread-out` group awareness** — `spreadOutCommand.ts` passes real group memberships so clusters move as units.
>
> **No G/U keyboard shortcuts.** Grouping is initiated entirely through the multi-select → SelectionPopup flow. The ActionPopup single-pad "Group" button is repurposed as "Ungroup" when that pad is already in a group (since Group creation requires ≥ 2 pads, which the SelectionPopup handles).

---

## Frontend conventions (recap)

- **State**: `usePondStore` for selection + cluster data. Follows the `Set<string>` pattern used for `searchResults`.
- **`groupId` on `Todo`**: add `groupId: string | null` to `frontend/src/types/index.ts`.
- **`SelectionPopup`**: a new component rendered in the existing `todo-input-overlay` portal, positioned at the world-to-screen projected centroid of the selection. Neon wireframe aesthetic, same CSS tokens as `ActionPopup`.
- **Group API hooks**: new `frontend/src/api/groupApi.ts` following the React Query mutation pattern from `todoApi.ts`.
- **Cluster glow**: second `<GlowSource radius={2.8} strength={0.4} color="#ffffff" />` sibling in LilyPad when `todo.groupId` is non-null.
- **Cluster drag**: imperative group-delta pattern — the dragged pad's position offset is broadcast to all group members via a store slice; each member reads it in its own `useFrame`.

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
I want to select multiple lily pads and use a centroid popup to group them, label them, ungroup them, or spread just them apart,
so that I can organise related todos spatially without cluttering the default interaction model.

---

## Acceptance Criteria

### Multi-select

1. **Given** no popup is open, **When** I Shift-click or Ctrl-click (Meta-click on macOS) a pad, **Then** that pad is added to the selection set. A selected pad renders a bright white outer rim oscillation (scale 1.0–1.05 at 2 Hz) as a selection indicator. Shift/Ctrl-clicking the same pad again removes it. A plain click (no modifier) on any pad clears the selection and opens the ActionPopup on the clicked pad as usual.

2. **Given** a selection exists, **When** I press Escape (no popup, no search active), **Then** the selection is cleared and the SelectionPopup closes.

### SelectionPopup

3. **Given** the selection set has ≥ 2 pads, **Then** a `SelectionPopup` renders in the `todo-input-overlay` portal positioned at the world-to-screen centroid of the selected pad positions. It renders in the same neon wireframe aesthetic as `ActionPopup` and closes when the selection drops below 2 (or is cleared). Moving (more pads added/removed) repositions it live.

4. **Given** the SelectionPopup is open, **Then** it contains the following buttons/controls in order:
   - **Group** — always present; disabled when all selected pads are already in the same group.
   - **Ungroup** — present only when ALL selected pads belong to the same group.
   - **Spread Out** — always present; runs collision-resolution on just the selected pads.
   - **Label** — always present; shows an inline `<input>` text field on click. Current label (if a group exists for this selection) pre-fills the input. Pressing Enter with text → `PATCH /api/groups/{id}` to set label. Pressing Enter with empty text (or clearing and submitting) → removes the label (`null`). Pressing Escape collapses the input without saving.

5. **Given** I click **Group** in the SelectionPopup, **Then** `POST /api/groups` is called with `{ member_ids: [...selectedPadIds] }`. On success: selection is cleared (SelectionPopup closes), pads drift toward each other (ring formation at centroid, 500ms via `padTargetPositions`), todos query is invalidated.

6. **Given** all selected pads are in the same group and I click **Ungroup**, **Then** `DELETE /api/groups/{groupId}` is called. On success: selection is cleared, pads drift apart with an outward ripple from the centroid, todos query is invalidated.

7. **Given** I click **Spread Out** in the SelectionPopup, **Then** `computeSpreadPositions` runs with ONLY the selected pad IDs as input (not the whole pond). Their current groupings are respected as usual. Target positions are set in `padTargetPositions`; each pad fires its own `PATCH` on arrival. No other pads move.

8. **Given** I click **Label** in the SelectionPopup, **Then** an inline `<input>` field appears within the popup (no separate modal). If the selected pads are already grouped, the input pre-fills with the current group label. Pressing Enter with non-empty text calls `PATCH /api/groups/{id} { label: text }`. Pressing Enter with empty text calls `PATCH /api/groups/{id} { label: null }`. Pressing Escape collapses the input. If the pads are NOT yet grouped, clicking Label is a no-op (button is disabled until the group is created).

### ActionPopup (single pad)

9. **Given** a pad is in a group and I open its ActionPopup (plain click), **Then** the "Group" button's label swaps to "Ungroup". Clicking calls `DELETE /api/groups/{groupId}`, same as Ungroup in the SelectionPopup. This is the escape hatch for ungrouping a single pad without needing to re-select.

10. **Given** a pad is NOT in a group and I open its ActionPopup, **Then** the "Group" button remains labelled "Group" but is disabled (grayed out, non-interactive). Group creation requires ≥ 2 pads, which is the SelectionPopup's job.

### Cluster visual

11. **Given** a pad is a member of a group, **When** it renders, **Then** it shows a second outer glow ring (`radius = 2.8`, `strength = 0.4`, `color = "#ffffff"`) alongside its primary per-pad halo. Solo pads show no second ring.

12. **Given** a group has a non-null label, **When** at least one member is visible, **Then** a `<div>` floats above the cluster centroid (world-to-screen projected each frame imperatively) in `Share Tech Mono`, neon-cyan, `font-size: 11px`, `opacity: 0.8`.

### Cluster drag

13. **Given** a pad is in a group, **When** I drag it (story 4.2 mechanics), **Then** all other group members move by the same world-space delta in real time (rigid-body movement). On release, `PATCH /api/todos/{id}` fires for every group member at its new position.

14. **Given** I drag a solo pad and release within 1.5 world units of another group's centroid, **Then** `PATCH /api/groups/{id}` is called to add the pad to that group. Immediately after the membership update resolves, the group runs an automatic spread-out (same algorithm as the Spread Out button but scoped to the group's members) so no pads overlap after the addition.

15. **Given** a pad is dragged OUT of a group's snap radius to an empty area and released, **Then** `PATCH /api/groups/{id}` removes it from the group (or `DELETE /api/groups/{id}` if only one member would remain). The remaining group members then automatically spread out.

### Backend

15. **Given** `POST /api/groups { member_ids: [uuid, …], label?: string }`, **When** all IDs are valid active todos and none are already in a group, **Then** response is `201 { id, label, member_ids, created_at }`. Returns 400 if any ID is already in a different group.

16. **Given** `PATCH /api/groups/{id} { label?, member_ids? }`, **When** called, **Then** label or member list updates. `member_ids` replaces the full set. Returns 404 if not found.

17. **Given** `DELETE /api/groups/{id}`, **Then** group row deleted (CASCADE removes memberships). Returns 204. Todos untouched.

18. **Given** `GET /api/todos`, **Then** each todo includes `group_id: uuid | null`.

### /spread-out group awareness

20. **Given** `/spread-out` runs with grouped pads present, **Then** `spreadOutCommand.ts` passes real `groupings` (derived from `todo.groupId`) to `computeSpreadPositions` so grouped pads move as rigid units.

### Auto-spread on group membership change

21. **Given** any of these events: pad joins a group (snap-in), pad leaves a group (snap-out), Group created via SelectionPopup, **When** the backend responds successfully, **Then** `computeSpreadPositions` runs automatically on the affected group members and the result is pushed into `padTargetPositions` — same animation path as the explicit Spread Out button. This keeps groups tidy without requiring the user to manually spread after every membership change.

### Quality gate

22. **Given** full test suite runs, **Then** all existing 259 frontend tests plus new tests pass. New tests: selection toggle, SelectionPopup renders at centroid when ≥ 2 selected, Group button calls `POST /api/groups`, Ungroup button calls `DELETE`, Spread Out triggers `padTargetPositions` for selected pads only, Label input calls PATCH on Enter, empty label input clears to null, cluster glow ring rendered when `groupId` non-null, cluster drag moves all members, snap-to-group on release triggers auto-spread, snap-out triggers auto-spread on remaining members.

---

## Tasks / Subtasks

- [ ] **Task 1: Backend — schemas and service** (AC: #15–#18)
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
    - `create_group(db, data) -> GroupResponse` — validate no member already in a group; insert `Group` + `GroupMembership` rows; return `GroupResponse` with member_ids loaded from a follow-up query.
    - `get_group(db, group_id) -> Group` — raises `GroupNotFoundError`.
    - `update_group(db, group_id, data) -> GroupResponse` — partial update; for `member_ids`, delete old rows then insert new.
    - `delete_group(db, group_id) -> None` — delete `Group` row; CASCADE handles memberships.
  - [ ] Extend `todo_service.list_todos` to return `(Todo, group_id | None)` tuples via SQLAlchemy outerjoin on `GroupMembership`:
    ```python
    from sqlalchemy import outerjoin
    rows = (
        db.query(Todo, GroupMembership.group_id)
        .outerjoin(GroupMembership, Todo.id == GroupMembership.todo_id)
        .filter(Todo.archived == False, ...)
        .order_by(Todo.created_at.desc())
        .all()
    )
    ```
  - [ ] Add `group_id: uuid.UUID | None = None` to `TodoResponse` in `backend/src/schemas/todo.py`.
  - [ ] Assemble `TodoResponse` in the `list_todos` route handler from the `(Todo, group_id)` tuples.
  - [ ] Write `backend/tests/services/test_group_service.py` covering: create round-trip, create fails if member already grouped, update label only, update member_ids replaces set, delete removes group (todos stay), `list_todos` includes `group_id`.

- [ ] **Task 2: Backend — API router** (AC: #15–#17)
  - [ ] Create `backend/src/api/groups.py` with `POST`, `PATCH /{group_id}`, `DELETE /{group_id}`. All sync route handlers, `db = Depends(get_db)`.
  - [ ] Wire `groups.router` into `backend/src/main.py`.
  - [ ] Write `backend/tests/api/test_groups.py` — POST creates → 201; POST with already-grouped member → 400; PATCH label → 200; PATCH member_ids → 200; DELETE → 204; DELETE missing → 404.

- [ ] **Task 3: Frontend — types + API hooks** (AC: #5–#8, #13–#14, #19)
  - [ ] Add `groupId: string | null` to `frontend/src/types/index.ts:Todo`.
  - [ ] Create `frontend/src/api/groupApi.ts` with `useCreateGroup`, `useUpdateGroup`, `useDeleteGroup`. All invalidate `TODOS_KEY` on success.

- [ ] **Task 4: Store — selection slice** (AC: #1–#2)
  - [ ] In `usePondStore.ts`, add `selectedPadIds: Set<string>`, `togglePadSelection(id)`, `clearSelection()`. Initialise `new Set()`. Immutable updates (`new Set(...)`).
  - [ ] Tests: toggle adds, toggle again removes, clear empties.

- [ ] **Task 5: LilyPad — selection visual + Shift/Ctrl click** (AC: #1–#2)
  - [ ] In `LilyPad.tsx`'s `onPointerDown`: if `e.shiftKey || e.ctrlKey || e.metaKey`, call `togglePadSelection(todo.id)` and return early (no drag, no popup).
  - [ ] Subscribe `isSelected = usePondStore((s) => s.selectedPadIds.has(todo.id))`.
  - [ ] In `useFrame` resting phase: if `isSelected`, apply scale oscillation `1.0 + 0.05 * Math.abs(Math.sin(t * Math.PI * 2 * 2))` to `group.scale.setScalar(...)`.
  - [ ] Escape key: in `useClosePopupOnEscape.ts` (or a new `useClearSelectionOnEscape.ts`), if selection has entries and no popup/search is active, call `clearSelection()`.

- [ ] **Task 6: `SelectionPopup` component** (AC: #3–#8)
  - [ ] Create `frontend/src/components/ui/SelectionPopup.tsx`.
  - [ ] Props: `selectedTodos: Todo[]`, `onClose: () => void`. Internally uses `useCreateGroup`, `useDeleteGroup`, `useUpdateGroup`.
  - [ ] Compute centroid: `cx = avg(t.positionX ?? 0)`, `cz = avg(t.positionY ?? 0)` across `selectedTodos`.
  - [ ] World-to-screen projection: `useThree((s) => s.camera)` + `vector.project(camera)` → CSS `left/top`. Update via `useFrame` imperatively on a `ref` div (no React re-render per frame).
  - [ ] Determine state: `allSameGroup = selectedTodos.every(t => t.groupId && t.groupId === selectedTodos[0].groupId)`.
  - [ ] Render (neon wireframe, same CSS class pattern as `ActionPopup`):
    - **Group** button: disabled when `allSameGroup`. On click → `createGroup.mutate({ memberIds: selectedTodos.map(t => t.id) })` + drift positions + `onClose()`.
    - **Ungroup** button: rendered only when `allSameGroup`. On click → `deleteGroup.mutate(selectedTodos[0].groupId!)` + ripple at centroid + `onClose()`.
    - **Spread Out** button: always present. On click → run `computeSpreadPositions(selectedTodos, groupings)` (just the selected todos); set `padTargetPositions`; `onClose()`.
    - **Label** section: collapsed by default. Click to expand inline `<input>`. Pre-fill with current group label if `allSameGroup`. Enter → `updateGroup.mutate(...)` (with `label: value || null`); Escape → collapse without save. Disabled (grayed) when `!allSameGroup` (can only label an existing group).
  - [ ] Render via `createPortal` into the `todo-input-overlay` div (same target as `ActionPopup`).
  - [ ] Add CSS in a new `SelectionPopup.css` file. Reuse neon-cyan tokens; `cursor: none` on buttons per project style.

- [ ] **Task 7: PondScene — render SelectionPopup** (AC: #3, #5–#8)
  - [ ] Import `SelectionPopup`.
  - [ ] Derive `selectedTodos`: `usePondStore((s) => s.selectedPadIds)` + filter `renderTodos`. Use `useShallow` on the Set comparison.
  - [ ] Render below `ActionPopup`:
    ```tsx
    {selectedTodos.length >= 2 && (
      <SelectionPopup
        selectedTodos={selectedTodos}
        onClose={() => usePondStore.getState().clearSelection()}
      />
    )}
    ```
  - [ ] Wire drift animation on Group success: inside `SelectionPopup`'s `onSuccess` callback for `createGroup`, call `usePondStore.getState().setTargetPositions(ringTargets)` where ring positions are computed from centroid.

- [ ] **Task 8: ActionPopup — single pad Group → Ungroup + disabled** (AC: #9–#10)
  - [ ] Pass `isGrouped={!!popupTodo?.groupId}` to `ActionPopup` from `PondScene`.
  - [ ] In `ActionPopup.tsx`: accept `isGrouped?: boolean` prop. When `isGrouped === true`, label is "Ungroup" and clicking calls `onGroup`. When `isGrouped === false` (or undefined), label is "Group" and button is `disabled` (greyed out, `pointer-events: none`). The `onGroup` handler in `PondScene` calls `deleteGroup.mutate(popupTodo.groupId!)`.

- [ ] **Task 9: LilyPad — cluster glow ring** (AC: #11)
  - [ ] When `todo.groupId` is non-null, render a second `<GlowSource radius={2.8} yOffset={GLOW_Y_OFFSET} strength={0.4} color="#ffffff" />` sibling. If `GlowSource` doesn't accept a `color` prop yet, add one (defaults to the current uniform behavior so existing usage is unaffected).

- [ ] **Task 10: Cluster label overlay** (AC: #12)
  - [ ] Create `frontend/src/components/pond/ClusterLabel.tsx` — receives `label: string`, `memberPositions: {x: number; z: number}[]`. Projects centroid to screen each frame imperatively. Renders as `createPortal` into `todo-input-overlay`.
  - [ ] In `PondScene`, derive `groupLabel` map from `renderTodos` → render one `<ClusterLabel>` per group with a non-null label.

- [ ] **Task 11: Cluster drag — rigid group movement** (AC: #13)
  - [ ] In `usePondStore`, add `groupDragAnchor: { groupId: string; anchorId: string; anchorX: number; anchorZ: number } | null` + `setGroupDragAnchor(...)` + `clearGroupDragAnchor()`.
  - [ ] In `LilyPad.tsx` drag `onPointerMove`: when `todo.groupId`, record initial anchor offset on first move frame, then `setGroupDragAnchor({ groupId: todo.groupId, anchorId: todo.id, anchorX: dragPosRef.x, anchorZ: dragPosRef.z })`.
  - [ ] Every OTHER group member reads `groupDragAnchor` in its `useFrame` (when `groupDragAnchor?.groupId === todo.groupId && groupDragAnchor.anchorId !== todo.id`) and applies the same offset relative to its capture-point position.
  - [ ] On `onPointerUp`: `clearGroupDragAnchor()`; fire `updateTodo.mutate` for each member at its final position. (The member components also fire their own mutations on `groupDragAnchor` clearing — or `PondScene` can collect and fire all via a callback. The simpler approach: each LilyPad fires its own PATCH when the anchor clears and the pad has a pending position.)

- [ ] **Task 12: Snap-to-group on drag release + auto-spread** (AC: #14, #15, #21)
  - [ ] In `LilyPad.tsx`, pass `onDragEnd?: (worldX: number, worldZ: number) => void` as a prop.
  - [ ] In `PondScene.tsx`, compute `nearbyGroups` from `renderTodos` (group centroids). In the `onDragEnd` callback:
    - **Snap in**: if dropped within 1.5 units of a group centroid and the pad is not already in that group → `updateGroup.mutate({ id, memberIds: [...existing, todo.id] }, { onSuccess: () => autoSpread(newMembers) })`.
    - **Snap out**: if dropped far from any group and the pad WAS in a group → `updateGroup.mutate({ id: groupId, memberIds: remainingIds }, { onSuccess: () => autoSpread(remainingMembers) })`. If only 1 member would remain after removal → `deleteGroup.mutate(groupId)`.
  - [ ] `autoSpread(todos: Todo[])`: compute `computeSpreadPositions(todos, groupings)` for just those members, push result into `padTargetPositions`. Extracted as a module-level helper in `PondScene.tsx` or a separate file.
  - [ ] **Group creation auto-spread** (AC: #21): in `SelectionPopup`'s `onSuccess` handler for `createGroup`, run `autoSpread` on the newly grouped members in addition to the ring-drift formation. The ring targets computed earlier serve as the starting point; auto-spread resolves any remaining overlaps from the ring.

- [ ] **Task 13: `/spread-out` group awareness** (AC: #19)
  - [ ] In `spreadOutCommand.ts`'s `execute()`, build `groupings` from todos with `groupId` set. Pass to `computeSpreadPositions`. No changes to the algorithm itself.

- [ ] **Task 14: Tests & quality gate** (AC: #20)
  - [ ] `npx vitest run` — all new + existing tests green.
  - [ ] `npx tsc --noEmit`.
  - [ ] `DATABASE_URL=...todo_pond_test python -m pytest tests/ -q`.
  - [ ] `ruff check src/ && ruff format --check src/` + `mypy src/ --strict`.

---

## Dev Notes

### No Alembic migration — one migration, no backwards compat

The project has exactly **one** migration (`7af34c6df37c_initial_schema.py`) and that is where it stays. The `groups` and `group_memberships` tables were created there. **Do not** add a second migration, alter-table statements, or any backwards-compatibility shims. Models are in `backend/src/models/group.py`, exported from `backend/src/models/__init__.py`. `GroupNotFoundError` is in `backend/src/exceptions.py`. Frontend `Group` type is in `frontend/src/types/index.ts`. If a column or constraint needs to change, edit the initial migration directly — the dev DB is truncated and re-migrated, never upgraded in place.

### `TodoResponse.group_id` via outerjoin

The `Todo` ORM model has no `group_id` column. Use an outerjoin in `list_todos`:
```python
rows = (
    db.query(Todo, GroupMembership.group_id)
    .outerjoin(GroupMembership, Todo.id == GroupMembership.todo_id)
    .filter(Todo.archived == False, or_(*clauses))
    .order_by(Todo.created_at.desc())
    .all()
)
# Build TodoResponse manually:
return [
    TodoResponse(
        **TodoResponse.model_validate(todo).model_dump(),
        group_id=gid,
    )
    for todo, gid in rows
]
```
The `visibility_filter` clauses from story 3.3 (`include_active`, etc.) still apply — just append to the same filter chain.

### SelectionPopup world-to-screen projection

Centroid world pos `(cx, 0, cz)` → clip space → CSS:
```ts
const vec = new THREE.Vector3(cx, 0, cz);
vec.project(camera);  // clip space [-1, 1]
const x = (vec.x * 0.5 + 0.5) * window.innerWidth;
const y = (-vec.y * 0.5 + 0.5) * window.innerHeight;
divRef.current.style.left = `${x}px`;
divRef.current.style.top = `${y}px`;
```
Allocate `vec` once outside the `useFrame` callback (module-scope or ref) to avoid per-frame GC.

### Group drift formation

On Group creation, arrange N pads in a ring around the centroid:
```ts
angle = (i * 2π) / N;
target = { x: cx + cos(angle) * 0.8, z: cz + sin(angle) * 0.8 };
```
For N=2: pads are 1.6 units apart (inside the 2.4 spread-out minimum — they cluster tightly). The existing `padTargetPositions` + `LilyPad.useFrame` lerp handles the animation.

### Label in SelectionPopup: disabled before group exists

Before the pads are grouped, clicking Label is a no-op (button disabled). This avoids a flow where the user sets a label that then has nowhere to be saved. The natural flow is: select pads → click Group → label appears pre-fillable → click Label to set it.

### One-group-per-todo enforcement

The backend service must reject `POST /api/groups` if any `member_id` is already in a group. Query `group_memberships` for existing rows with those `todo_ids` and raise 400 if any exist. This prevents silent double-membership (the composite PK allows multiple groups per todo by schema, so we enforce one-group-per-todo in the service layer).

### Cluster drag — simpler alternative if group delta is complex

If the `groupDragAnchor` store slice feels over-engineered, an alternative: on `pointerDown` for a grouped pad, pre-populate `padTargetPositions` for all other group members to track the drag. Each `useFrame` follows `padTargetPositions[id]` which the dragged pad updates via `setTargetPositions(...)` on each `onPointerMove`. Swap `lerp` for direct assignment (lerp factor = 1.0) during drag. On release, reset to lerp for the final settle.

### Deferred items

- **FR20: Cluster-aware search** — once groups land, search results can surface/submerge clusters as units. Deferred to a follow-on story.
- **LightningBorder cluster aura** — the UX spec mentions adapting `LightningBorder.tsx` for dramatic electric arcs between members. This story uses a simpler second `GlowSource`. Polish story if the simpler version reads as too subtle.
- **Typing anywhere to set label while cluster focused** — the original story mentioned this. This story uses the SelectionPopup Label input instead, which is more discoverable. The type-anywhere path is not implemented.

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
