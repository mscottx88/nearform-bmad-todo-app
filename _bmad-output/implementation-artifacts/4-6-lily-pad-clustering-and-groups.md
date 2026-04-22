# Story 4.6: Lily Pad Clustering & Groups

Status: in-progress

> **Scope note — the deferred grouping system from original Epic 4.2.** PRD FR10–FR12 (group pads, ungroup, cluster label) plus the cluster-drag and drag-in/out-of-clusters portion of FR13. The basic single-pad drag landed in Story 4.2.
>
> **Good news: most of the plumbing is already in the codebase.** The initial Alembic migration already created the `groups` and `group_memberships` tables. The SQLAlchemy models (`Group`, `GroupMembership`) live in [backend/src/models/group.py](backend/src/models/group.py). `GroupNotFoundError` exists in [backend/src/exceptions.py](backend/src/exceptions.py). The frontend `Group` type is in [frontend/src/types/index.ts](frontend/src/types/index.ts). The `ActionPopup` already renders a "Group" button with an `onGroup` stub. No new Alembic migration needed. No new migration ever — one migration only, no backwards-compat shims.
>
> **What ships:**
> 1. **Backend group API** — `POST /api/groups`, `PATCH /api/groups/{id}`, `DELETE /api/groups/{id}`. No migration needed.
> 2. **`group_id` on `TodoResponse`** — `GET /api/todos` returns each todo's optional `group_id`.
> 3. **Multi-select** — Shift/Ctrl-click pads to build a selection set (ring-pulse visual). Used to choose members when creating a group.
> 4. **Extended ActionPopup** — grouped-pad popups append a separator and four group actions: **Ungroup** (remove just this pad from its group), **Disband** (destroy the whole group), **Spread Out** (scoped to this group), **Label** (inline input). Non-grouped pads see the existing four-button layout; the "Group" button is enabled when ≥1 other pad is selected.
> 5. **Cluster visuals** — grouped pads share a second halo ring; the cluster label floats above the centroid; a drag handle appears on hover over the halo, positioned at the screen-space bbox lower-right corner of the cluster.
> 6. **Member drag within a group** — dragging a grouped pad moves only that pad within the halo; siblings get softly repelled out of the way; the motion emits directional crescent wakes alongside the existing circular ripples.
> 7. **Pop-out** — if the dragged pad's center crosses the halo perimeter, the pad leaves the group. A pop animation (scale pulse + ring burst) fires at the transition, and the camera locks onto the escaping pad so the cursor stays centered over it until release.
> 8. **Pop-in** — dragging a solo pad inside another group's halo adds it to the group. Same pop animation, same camera follow.
> 9. **Cluster drag via handle** — mousedown on the handle enters a two-phase interaction. While the mouse is inside the halo, the handle slides around the boundary (tracking the closest point); once the mouse pulls outside, the cluster translates rigidly so the handle stays under the mouse. The cluster does not move during the slide phase.
> 10. **Auto-spread** — any membership change (group create, disband, pop-in, pop-out, Ungroup-this-pad) triggers `computeSpreadPositions` on the affected group.
> 11. **`/spread-out` group awareness** — `spreadOutCommand.ts` passes real group memberships so clusters move as units.
>
> **No `SelectionPopup` component.** All group actions live inside the existing `ActionPopup`. No G/U keyboard shortcuts. No centroid popup.

---

## Frontend conventions (recap)

- **State**: `usePondStore` for selection + cluster data. Follows the `Set<string>` pattern used for `searchResults`.
- **`groupId` on `Todo`**: add `groupId: string | null` to [frontend/src/types/index.ts](frontend/src/types/index.ts).
- **`ActionPopup` extension**: [ActionPopup.tsx](frontend/src/components/pond/ActionPopup.tsx) gains an optional group section rendered below a `<hr>` separator when `isGrouped` is true. New props: `isGrouped`, `onUngroup`, `onDisband`, `onSpreadGroup`, `groupLabel`, `onSetLabel`. Keep the existing four-button layout completely unchanged for non-grouped pads.
- **Group API hooks**: new [frontend/src/api/groupApi.ts](frontend/src/api/groupApi.ts) following the React Query mutation pattern from `todoApi.ts`.
- **Cluster glow**: second `<GlowSource radius={2.8} strength={0.4} color="#ffffff" />` sibling in LilyPad when `todo.groupId` is non-null.
- **Halo geometry**: the cluster's effective halo is a circle centered at the cluster centroid, radius `R = max(|centroid − memberPos|) + PER_PAD_HALO_RADIUS` where `PER_PAD_HALO_RADIUS = 2.8`. Recomputed per frame. Used for pop-out threshold, pop-in threshold, and drag-handle slide/grip math.
- **Drag handle**: new `<ClusterDragHandle>` CSS overlay (like the cluster label). Visible only while the cursor is over the halo (pointerenter on any member, or mouse inside the halo circle). Resting position: **on the halo circle itself**, at the point on the boundary directed toward the bbox lower-right corner — i.e., `handleWorldPos = centroid + normalize(bboxLowerRight − centroid) * R`. This keeps the handle geometrically consistent with its slide-phase behavior (it always stays on the boundary). Visual orientation points outward (radially, away from centroid).
- **Wake primitive**: new `<Wake>` component — crescent-shaped water distortion oriented opposite to the dragged pad's motion vector. Distinct from the existing circular ripple system. Wakes emit only during member drag within a group.
- **Pop animation**: scale pulse on the transitioning pad (1.0 → 1.25 → 1.0 over 150ms, ease-out) plus an outward ring burst (brighter/shorter variant of `triggerRipple`).
- **Camera follow**: imperative pan via the story 3.1 camera rig — engaged during pop-in, pop-out, and grip-phase cluster drag. Disengages on pointerup.

---

## Backend conventions (recap)

- **Sync only** — no `async def`, per CLAUDE.md Principle VI.
- **Schema**: [backend/src/schemas/group.py](backend/src/schemas/group.py) — `GroupCreate`, `GroupUpdate`, `GroupResponse`.
- **Service**: [backend/src/services/group_service.py](backend/src/services/group_service.py) — `create_group`, `get_group`, `update_group`, `delete_group`.
- **Router**: [backend/src/api/groups.py](backend/src/api/groups.py) — prefix `/api/groups`. Wire into [backend/src/main.py](backend/src/main.py).
- **`TodoResponse.group_id`**: add `group_id: uuid.UUID | None = None`; populate via left-join on `group_memberships` in `list_todos`.

---

## Story

As a user, I want to group lily pads via the existing Action Popup — seeing group actions inline when a grouped pad is clicked, selecting pads before opening a non-grouped pad's popup to create a group, and dragging pads in and out of groups to rearrange them spatially — so that spatial organisation flows naturally through the popup I already use for every other action.

---

## Acceptance Criteria

### Multi-select (for group creation)

1. **Given** no popup is open, **When** I Shift-click or Ctrl-click (Meta on macOS) a pad, **Then** that pad is added to the selection set and renders a white outer rim oscillation (scale 1.0–1.05 at 2 Hz). Shift/Ctrl-clicking the same pad again removes it. Selection persists until cleared.

2. **Given** a selection exists, **When** I press Escape (no popup, no search active), **Then** the selection is cleared.

### ActionPopup — non-grouped pad

3. **Given** a pad is NOT in a group, **When** I click it (normal click, no modifier), **Then** the `ActionPopup` opens with its existing four buttons (Complete, Delete, Set Color, Group) — unchanged from today. Any currently-selected pads remain selected (plain click on a non-grouped pad does NOT clear the selection).

4. **Given** the ActionPopup is open on a non-grouped pad AND `selectedPadIds.size ≥ 1`, **When** I click **Group**, **Then** `POST /api/groups` is called with `member_ids: [popupTodo.id, ...selectedPadIds]`. On success: selection is cleared, popup closes, pads drift toward each other in a ring formation (500ms via `padTargetPositions`), todos query is invalidated. If `selectedPadIds.size === 0`, the Group button is disabled (grayed out, `pointer-events: none`).

### ActionPopup — grouped pad (extended layout)

5. **Given** a pad IS in a group, **When** I click it (normal click), **Then** the `ActionPopup` opens with the existing Complete/Delete/Set Color buttons (the "Group" button is removed for grouped pads), then a thin separator (`<hr>` styled as a 1px neon-cyan line at 0.2 opacity), then four group buttons in order: **Ungroup**, **Disband**, **Spread Out**, **Label**.

6. **Given** the extended ActionPopup is open, **When** I click **Ungroup**, **Then** the clicked pad is removed from its group: `PATCH /api/groups/{groupId}` fires with the remaining member IDs (or `DELETE /api/groups/{groupId}` if only 1 member would remain). On success: pop animation fires at the clicked pad, popup closes, remaining members auto-spread.

7. **Given** the extended ActionPopup is open, **When** I click **Disband**, **Then** `DELETE /api/groups/{groupId}` is called. On success: pop animation fires on every former member simultaneously, an outward ripple emits from the former centroid, popup closes, todos query is invalidated.

8. **Given** the extended ActionPopup is open, **When** I click **Spread Out**, **Then** `computeSpreadPositions` runs scoped to just the group's members; result is pushed into `padTargetPositions`; popup closes. Each pad fires its own `PATCH` on arrival at its target.

9. **Given** the extended ActionPopup is open, **When** I click **Label**, **Then** an inline `<input>` field expands within the popup (no separate modal). If the group already has a label, it pre-fills the input. Pressing Enter with text → `PATCH /api/groups/{id} { label: text }` and the input collapses. Pressing Enter with empty text → `PATCH /api/groups/{id} { label: null }`. Pressing Escape collapses the input without saving.

10. **Given** the extended ActionPopup is open, **When** I take any action (Ungroup, Disband, Spread Out, or commit a Label), **Then** the existing Complete/Delete/Set Color buttons remain fully functional.

### Cluster visual

11. **Given** a pad is a member of a group, **When** it renders, **Then** it shows a second outer glow ring (`radius = 2.8`, `strength = 0.4`, `color = "#ffffff"`) alongside its primary halo. Solo pads show no second ring.

12. **Given** a group has a non-null label, **When** at least one member is visible, **Then** a `<div>` floats above the cluster centroid (world-to-screen projected imperatively each frame) in `Share Tech Mono`, neon-cyan, `font-size: 11px`, `opacity: 0.8`.

13. **Given** the cursor enters a group's halo area (pointerenter on any member, or mouse inside the halo circle), **Then** a drag handle appears as a CSS overlay positioned on the halo circle itself, at the point on the boundary directed toward the bbox lower-right corner — i.e., `handleWorldPos = centroid + normalize(bboxLowerRight − centroid) * R`, projected to screen each frame. Visual orientation points radially outward. The handle hides on pointerleave unless a drag is in progress.

### Member drag — within group

14. **Given** a pad is in a group, **When** I begin dragging it (pointerdown on the pad, no modifier), **Then** only that pad moves — the rest of the cluster stays anchored. The dragged pad follows the mouse per story 4.2 drag mechanics.

15. **Given** I am dragging a grouped pad, **When** it approaches any sibling member within `SIBLING_REPEL_RADIUS` (≈ 1.5 world units), **Then** that sibling applies a soft radial push-off from the dragged pad's position. Magnitude is inversely proportional to distance; applied imperatively in the sibling's `useFrame`.

16. **Given** I am dragging a grouped pad with non-zero velocity, **Then** crescent wakes emit from the pad position at ~80ms cadence, oriented opposite to the current motion vector. Wakes fade over ~400ms. Circular ripples continue per existing cadence.

17. **Given** I release the drag inside the halo perimeter, **Then** every group member (dragged pad + repelled siblings) commits its new position via `PATCH /api/todos/{id}`. `autoSpread` then runs on the group to relieve any residual overcrowding.

### Pop-out — grouped pad escapes

18. **Given** I am dragging a grouped pad, **When** the pad's center crosses the halo perimeter (i.e., `|padPos − centroid| > R` — equivalent to "roughly half the pad's width past the line"), **Then**:
    - `PATCH /api/groups/{groupId}` fires with the remaining member IDs (or `DELETE /api/groups/{groupId}` if only 1 member would remain).
    - Pop animation plays on the escaping pad (scale pulse + ring burst).
    - Camera engages follow mode on the escaping pad — as I continue dragging, the camera pans so the pad stays under the cursor.
    - Remaining members auto-spread.

19. **Given** pop-out has fired, **When** I release the drag, **Then** the escaped pad commits its final position via `PATCH /api/todos/{id}` and the camera releases follow mode (stays at its current position, no snap-back).

### Pop-in — solo pad joins group

20. **Given** I am dragging a solo pad, **When** the pad's center enters another group's halo perimeter (`|padPos − groupCentroid| < R_group`), **Then**:
    - `PATCH /api/groups/{targetGroupId}` fires with `member_ids: [...existing, draggedPad.id]`.
    - Pop animation plays on the joining pad.
    - Camera engages follow mode on the joining pad until release.
    - Target group auto-spreads to make room.

### Cluster drag via handle

21. **Given** the drag handle is visible, **When** I pointerdown on it, **Then** drag mode engages in **slide phase**. The cluster does NOT yet translate.

22. **Given** I am in slide phase AND the mouse world position is inside the halo circle (`|M − C| ≤ R`), **When** I move the mouse, **Then** the handle visual tracks the closest point on the halo boundary to the mouse: `H = C + normalize(M − C) * R`. The cluster remains stationary.

23. **Given** I am in slide phase, **When** the mouse world position first moves outside the halo circle (`|M − C| > R`), **Then** **grip phase** engages: freeze `gripOffset = H − C` at this moment; from here on, set new centroid `C_new = M − gripOffset` each frame and apply the translation delta to every member's position. Grip phase persists until pointerup, even if the mouse re-enters the halo.

24. **Given** grip phase is active, **Then** the camera engages follow mode on the mouse cursor until pointerup.

25. **Given** I release the handle drag, **Then** every group member commits its new position via `PATCH /api/todos/{id}`. Camera releases follow mode.

### Backend

26. **Given** `POST /api/groups { member_ids, label? }` with all valid active todos none already in a group, **Then** 201 `{ id, label, member_ids, created_at }`. Returns 400 if any ID is already in a different group.

27. **Given** `PATCH /api/groups/{id} { label?, member_ids? }`, **Then** partial update. `member_ids` replaces the full membership set. Returns 404 if not found.

28. **Given** `DELETE /api/groups/{id}`, **Then** 204; group row deleted (CASCADE removes memberships); todos untouched.

29. **Given** `GET /api/todos`, **Then** each todo includes `group_id: uuid | null`.

### /spread-out group awareness

30. **Given** `/spread-out` runs with grouped pads present, **Then** grouped pads move as rigid units — `spreadOutCommand.ts` builds `groupings` from `todo.groupId` and passes them to `computeSpreadPositions`.

### Quality gate

31. **Given** full test suite runs, **Then** all existing frontend and backend tests plus new tests pass. New tests (non-exhaustive): selection toggle, Group button enabled/disabled states, extended popup rendering, Ungroup removes just this pad (calls PATCH, or DELETE when reducing to 1), Disband calls DELETE and animates all members, Spread Out scopes to group members, Label input commits/clears/cancels, cluster glow ring, drag handle appears on halo hover, drag handle slide phase keeps cluster stationary, drag handle grip phase translates cluster, member-drag sibling repulsion, crescent wake emission, pop-out at perimeter threshold, pop-in on entering another group's halo, camera follow engages and releases correctly.

---

## Tasks / Subtasks

- [x] **Task 1: Backend — schemas and service** (AC: #26–#29)
  - [x] Create [backend/src/schemas/group.py](backend/src/schemas/group.py):
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
  - [x] Create [backend/src/services/group_service.py](backend/src/services/group_service.py) (all sync, `db: Session`):
    - `create_group(db, data: GroupCreate) -> GroupResponse` — validate no member already in a group; insert `Group` + `GroupMembership` rows; commit; return `GroupResponse`.
    - `get_group(db, group_id: uuid.UUID) -> Group` — raises `GroupNotFoundError`.
    - `update_group(db, group_id: uuid.UUID, data: GroupUpdate) -> GroupResponse` — partial update; for `member_ids`, delete old rows then insert new.
    - `delete_group(db, group_id: uuid.UUID) -> None` — delete `Group` row; CASCADE handles memberships.
  - [x] Extend `todo_service.list_todos` to return `group_id` via left-join on `GroupMembership` (see Dev Notes).
  - [x] Add `group_id: uuid.UUID | None = None` to `backend/src/schemas/todo.py:TodoResponse`.
  - [x] Write `backend/tests/services/test_group_service.py`: create round-trip, create fails if member already grouped, update label only, update member_ids replaces set, delete removes group (todos stay), `list_todos` includes `group_id`.

- [x] **Task 2: Backend — API router** (AC: #26–#28)
  - [x] Create [backend/src/api/groups.py](backend/src/api/groups.py) with `POST`, `PATCH /{group_id}`, `DELETE /{group_id}`. All sync route handlers.
  - [x] Wire `groups.router` into [backend/src/main.py](backend/src/main.py).
  - [x] Write `backend/tests/api/test_groups.py`: POST creates → 201; POST with already-grouped member → 400; PATCH label → 200; PATCH member_ids → 200; DELETE → 204; DELETE missing → 404.

- [ ] **Task 3: Frontend — types + API hooks** (AC: #4, #6–#8, #18–#25, #30)
  - [ ] Add `groupId: string | null` to `frontend/src/types/index.ts:Todo`.
  - [ ] Create [frontend/src/api/groupApi.ts](frontend/src/api/groupApi.ts) with `useCreateGroup`, `useUpdateGroup`, `useDeleteGroup`. All invalidate `TODOS_KEY` on success.

- [ ] **Task 4: Store — selection slice + cluster slices** (AC: #1–#2, #14–#25)
  - [ ] In `usePondStore.ts`, add:
    - `selectedPadIds: Set<string>`, `togglePadSelection(id)`, `clearSelection()`.
    - `hoveredGroupId: string | null`, `setHoveredGroupId(id)`.
    - `groupDragTarget: { groupId: string; anchorId: string; x: number; z: number } | null` + setter/clearer — used by siblings for repulsion and by PondScene for pop-out detection.
    - `clusterTranslation: { groupId: string; dx: number; dz: number } | null` + setter/clearer — used during handle grip phase so siblings translate in their `useFrame`.
    - `pendingPops: Map<string, number>` + `firePop(todoId)` — triggers pop animation on target; pads auto-expire entries in their own useFrame after 150ms.
  - [ ] Tests: toggle adds/removes, clear empties; groupDragTarget set/clear round-trip; clusterTranslation accumulates deltas correctly.

- [ ] **Task 5: LilyPad — selection visual + Shift/Ctrl click** (AC: #1–#2)
  - [ ] In `LilyPad.tsx`'s `onPointerDown`: if `e.shiftKey || e.ctrlKey || e.metaKey`, call `togglePadSelection(todo.id)` and return early (no drag, no popup).
  - [ ] Subscribe `isSelected = usePondStore((s) => s.selectedPadIds.has(todo.id))`.
  - [ ] In `useFrame` resting phase: if `isSelected`, apply scale oscillation `1.0 + 0.05 * Math.abs(Math.sin(t * Math.PI * 4))`.
  - [ ] Escape key: extend existing escape handling to also call `clearSelection()` when no popup/search is active.
  - [ ] Plain click on any pad does NOT clear the selection.

- [ ] **Task 6: `ActionPopup` — extended group section** (AC: #3–#10)
  - [ ] New props in `ActionPopupProps`:
    ```ts
    isGrouped?: boolean;
    groupLabel?: string | null;
    selectedCount?: number;
    onUngroup?: () => void;
    onDisband?: () => void;
    onSpreadGroup?: () => void;
    onSetLabel?: (label: string | null) => void;
    ```
  - [ ] "Group" button behavior:
    - `!isGrouped && selectedCount === 0`: render disabled (greyed, `pointer-events: none`).
    - `!isGrouped && selectedCount >= 1`: render enabled; click fires `onGroup`.
    - `isGrouped`: "Group" button is omitted from the four-button row.
  - [ ] When `isGrouped`, below the button row render:
    ```tsx
    <hr className="action-popup__group-separator" />
    <div className="action-popup__group-section">
      <button onClick={onUngroup}>Ungroup</button>
      <button onClick={onDisband}>Disband</button>
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
  - [ ] `labelOpen: boolean` is local state in `ActionPopup`.
  - [ ] CSS in `ActionPopup.css`: `.action-popup__group-separator` — `border: none; border-top: 1px solid rgba(0, 238, 255, 0.2); margin: 6px 0`; `.action-popup__group-section` — flex row, same gap as main buttons.
  - [ ] Tests in `ActionPopup.test.tsx`: group section renders when `isGrouped=true`; group section absent when `isGrouped=false`; Disband calls `onDisband`; Ungroup calls `onUngroup`; Group button disabled when `selectedCount=0`; Label input commits on Enter, clears on empty, cancels on Escape.

- [ ] **Task 7: PondScene — wire extended ActionPopup** (AC: #4, #6–#10, #17)
  - [ ] Import `useCreateGroup`, `useUpdateGroup`, `useDeleteGroup` from [groupApi.ts](frontend/src/api/groupApi.ts).
  - [ ] Props wiring:
    ```tsx
    isGrouped={!!popupTodo?.groupId}
    groupLabel={groups.get(popupTodo?.groupId ?? '')?.label ?? null}
    selectedCount={selectedPadIds.size}

    onUngroup={() => {
      const gid = popupTodo!.groupId!;
      const remaining = renderTodos.filter(t => t.groupId === gid && t.id !== popupTodo!.id);
      const call = remaining.length === 1
        ? deleteGroup.mutate(gid)
        : updateGroup.mutate({ id: gid, memberIds: remaining.map(t => t.id) });
      firePop(popupTodo!.id);
      store.closePopup();
      // autoSpread(remaining) fires from mutation onSuccess
    }}

    onDisband={() => {
      const gid = popupTodo!.groupId!;
      const members = renderTodos.filter(t => t.groupId === gid);
      deleteGroup.mutate(gid, {
        onSuccess: () => {
          members.forEach(m => firePop(m.id));
          const centroid = computeCentroid(members);
          usePondStore.getState().triggerRipple(centroid.x, centroid.z);
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
  - [ ] `groups: Map<groupId, Group>` — `useMemo` from `renderTodos`.
  - [ ] `autoSpread(members: Todo[])` helper (module-level in `PondScene.tsx`):
    ```ts
    function autoSpread(members: Todo[]): void {
      const groupings = new Map(members.filter(t => t.groupId).map(t => [t.id, t.groupId!]));
      const targets = computeSpreadPositions(members, groupings);
      if (targets.size > 0) usePondStore.getState().setTargetPositions(targets);
    }
    ```

- [ ] **Task 8: LilyPad — cluster glow ring** (AC: #11)
  - [ ] When `todo.groupId` is non-null, render a second `<GlowSource radius={2.8} yOffset={GLOW_Y_OFFSET} strength={0.4} color="#ffffff" />`. Extend `GlowSource` with a `color` prop if missing.

- [ ] **Task 9: Cluster label overlay** (AC: #12)
  - [ ] Create [frontend/src/components/pond/ClusterLabel.tsx](frontend/src/components/pond/ClusterLabel.tsx) — receives `label: string`, `memberPositions: {x: number; z: number}[]`. Projects centroid to screen each frame via `useFrame` + `useThree`. Renders via `createPortal` into `todo-input-overlay`.
  - [ ] In `PondScene.tsx`, derive one `<ClusterLabel>` per group with a non-null label.

- [ ] **Task 10: Cluster geometry + drag handle** (AC: #13, #21–#25)
  - [ ] Helper module [frontend/src/lib/clusterGeometry.ts](frontend/src/lib/clusterGeometry.ts):
    - `computeCentroid(members)` → `{x, z}`.
    - `computeHaloRadius(members, centroid, padHaloRadius = 2.8)` → `R`.
    - `computeBbox(members, padHaloRadius)` → world-space `{minX, maxX, minZ, maxZ}`.
    - `computeHandleWorldPos(centroid, bbox, R)` → the point on the halo circle directed toward the bbox lower-right corner: `centroid + normalize(bboxLowerRight − centroid) * R`.
    - `projectWorldToScreen(worldPos, camera)` → screen `{sx, sy}` (pure function, called each frame).
  - [ ] Create [frontend/src/components/pond/ClusterDragHandle.tsx](frontend/src/components/pond/ClusterDragHandle.tsx):
    - Props: `groupId`, `members: Todo[]`, `onTranslate(dx, dz)`, `onDragEnd()`.
    - Visibility: only renders when `hoveredGroupId === groupId`, or when a drag is in progress on this handle. PondScene manages `hoveredGroupId` on member pointerenter/leave + a transparent halo hit-region.
    - Rendered as a CSS overlay via `createPortal` into `todo-input-overlay`.
    - Visual: small neon-cyan chevron or grip glyph pointing radially outward (away from centroid), with hover cue (`cursor: grab` / `grabbing`).
    - Each frame: compute `handleWorldPos = centroid + normalize(bboxLowerRight − centroid) * R`, project to screen, set handle CSS `left`/`top`. Visual rotation set to match the outward radial direction.
    - Drag mechanics (see Dev Notes for math):
      1. `pointerdown`: capture `C = centroid(members)`, `R = haloRadius(members)`, set phase = `slide`, capture `pointerId`.
      2. `pointermove`: compute mouse world position `M` (raycast to water plane). If phase = `slide` and `|M − C| ≤ R`: set handle position to `H = C + normalize(M − C) * R`. If phase = `slide` and `|M − C| > R`: transition to `grip` with `gripOffset = H − C` (frozen). If phase = `grip`: compute `C_new = M − gripOffset`; `delta = C_new − C_current`; call `onTranslate(delta.x, delta.z)`; update `C_current`.
      3. `pointerup`: fire `onDragEnd()`.
  - [ ] PondScene wiring:
    - Render one `<ClusterDragHandle>` per group, visible only for `hoveredGroupId`.
    - `onTranslate`: write to `clusterTranslation` store slice (siblings read in `useFrame` and apply imperatively).
    - `onDragEnd`: for each member, compute final world position from rest + clusterTranslation, fire `PATCH /api/todos/{id}`. Clear `clusterTranslation`. Camera follow disengages.
  - [ ] Camera follow engagement: when phase transitions to `grip`, set `followTarget = { worldX, worldZ }` on the camera controller, updated each frame to the mouse position. Clear on pointerup.

- [ ] **Task 11: Member drag — intra-group repulsion + pop-out + camera follow** (AC: #14–#19)
  - [ ] In [LilyPad.tsx](frontend/src/components/pond/LilyPad.tsx):
    - For a grouped pad during drag (`isDraggingRef.current && todo.groupId`), update `groupDragTarget = { groupId, anchorId: todo.id, x: currentX, z: currentZ }` on every `pointermove`.
    - Each frame during drag: compute `|padPos − centroid| > R`. If true AND `hasPoppedOut.current` is false → set `hasPoppedOut.current = true` and fire `onPopOut` callback.
  - [ ] Sibling repulsion: every group member (not the dragged one) reads `groupDragTarget` in its `useFrame`. If the anchor's position is within `SIBLING_REPEL_RADIUS` of the sibling's rest position, compute `push = normalize(siblingRest − anchor) * k / dist` and add to a local `nudgeRef`. Apply `group.position = restPosition + nudgeRef` imperatively. Clamp magnitude.
  - [ ] Pop-out handler in PondScene (passed to LilyPad as `onPopOut`):
    1. Compute remaining members; if `remaining.length === 1`, `deleteGroup.mutate(groupId)`; else `updateGroup.mutate({ id: groupId, memberIds: remaining.map(t => t.id) })`.
    2. `firePop(draggedPad.id)`.
    3. Engage camera follow on dragged pad — set `followTarget = { worldX, worldZ }` updated each frame from the current drag position.
    4. On mutation success: `autoSpread(remaining)`.
  - [ ] On drag release (grouped pad, no pop-out): PATCH positions of all members (dragged + each sibling whose `nudgeRef.magnitude > 0.05`); then `autoSpread(members)`; clear `groupDragTarget`.
  - [ ] On drag release (after pop-out): PATCH escaped pad's final position; camera release follow mode (stays at current pan, no snap-back); clear `groupDragTarget`; clear `hasPoppedOut.current`.

- [ ] **Task 12: Pop-in — solo pad joins group** (AC: #20)
  - [ ] In `LilyPad.tsx` during solo-pad drag, each frame: iterate over group centroids (derive from `renderTodos` in PondScene and pass in via prop, memoized). If `|padPos − groupCentroid| < R_group` AND `hasPoppedIn.current` is false → fire `onPopIn(groupId)`.
  - [ ] Pop-in handler in PondScene:
    1. `updateGroup.mutate({ id: targetGroupId, memberIds: [...existing, draggedPad.id] })`.
    2. `firePop(draggedPad.id)`.
    3. Engage camera follow on dragged pad.
    4. On success: `autoSpread(targetGroupMembers)`.
  - [ ] On drag release: PATCH position; camera release; clear `hasPoppedIn.current`.

- [ ] **Task 13: Wake primitive + pop animation** (AC: #16, #18.ii, #20.ii, #7)
  - [ ] Create [frontend/src/components/pond/Wake.tsx](frontend/src/components/pond/Wake.tsx) — crescent decal on the water plane. Simplest viable: a pre-rendered crescent sprite rotated to `angle` (perpendicular to motion), scaled up and faded over 400ms. Shader variant is acceptable if the sprite looks wrong.
  - [ ] Emit: `LilyPad` during member drag pushes a `{ id, x, z, angle, bornAt }` entry to `usePondStore.wakes: Array<...>` every ~80ms if velocity > threshold. Wakes auto-expire after 400ms (checked each frame; stale entries filtered).
  - [ ] Render: PondScene renders one `<Wake>` per entry.
  - [ ] Pop animation: in each `LilyPad`'s `useFrame`, check `pendingPops.get(todo.id)`. If set and `t - firedAt < 150ms`, apply scale interpolation (1.0 → 1.25 → 1.0 ease-out). At `firedAt`, also call `triggerRipple(padX, padZ, { color: '#00ffff', lifetime: 300 })` — add these params to the ripple primitive if missing.

- [ ] **Task 14: Camera follow integration** (AC: #18, #20, #24)
  - [ ] Extend the story 3.1 camera controller with a `followTarget: { worldX, worldZ } | null` input. When set, each frame the controller pans smoothly so `followTarget` projects to the current mouse cursor position in screen space (convert cursor NDC to a target world offset, interpolate camera position toward the implied target).
  - [ ] Engaged by: pop-out (target = dragged pad position, updated per frame), pop-in (target = dragged pad), grip-phase cluster drag (target = mouse position).
  - [ ] Cleared on pointerup.
  - [ ] No snap-back on release — camera holds current position.

- [ ] **Task 15: `/spread-out` group awareness** (AC: #30)
  - [ ] In `spreadOutCommand.ts:execute()`, build `groupings: Map<string, string>` from todos with non-null `groupId`. Pass to `computeSpreadPositions`. No changes to the algorithm.

- [ ] **Task 16: Tests & quality gate** (AC: #31)
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

Important for the group-creation flow: the user Shift-clicks several pads, then plain-clicks the pad they want to be the "primary" in the group, the popup opens, and the Group button is enabled. If plain click cleared the selection, the Group button would always be disabled when the popup opens. `onPointerUp` for a plain click (non-drag) opens the popup but leaves `selectedPadIds` untouched.

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

### Ungroup vs Disband semantics

**Ungroup** removes only the clicked pad from its group — equivalent to dragging that pad out of the halo, but click-driven. Backend call is `PATCH /api/groups/{id}` with the remaining member IDs, or `DELETE` if only 1 member would remain (a group of one is meaningless, so it collapses to solo). Pop animation fires on the clicked pad.

**Disband** destroys the entire group. Backend call is `DELETE /api/groups/{id}`. All former members become solo at their current positions. Pop animation fires on every member simultaneously; an outward ripple emits from the former centroid.

Dragging a pad out of the halo (pop-out, AC #18) follows the same code path as Ungroup for the dragged pad.

### Halo geometry

The cluster's effective halo is a circle centered at the cluster centroid, with radius:
```
R = max(distance(centroid, memberPos) for each member) + PER_PAD_HALO_RADIUS  // 2.8
```
Recompute `R` each frame as positions change (cheap; max over ≤ 30 pads). Used for:
- Pop-out threshold (member drag): `|padPos − centroid| > R`.
- Pop-in threshold (solo-pad drag approaches another group): `|padPos − groupCentroid| < R_group`.
- Drag-handle slide/grip transition: `|mouse − centroid| > R` → grip.

The drag handle sits **on the halo circle itself**, at the point on the boundary directed toward the bbox lower-right corner:
```
bbox = computeBbox(members, PER_PAD_HALO_RADIUS)
bboxLowerRight = { x: bbox.maxX, z: bbox.maxZ }  // screen "lower-right" under a top-down / angled camera
handleWorldPos = centroid + normalize(bboxLowerRight − centroid) * R
```
This keeps the handle geometrically consistent with its slide-phase behavior — during drag, the handle's slide formula `H = C + normalize(M − C) * R` already constrains it to the boundary, so starting there makes the pickup feel continuous. The bbox only determines *which arc* of the halo the handle rests on (the southeastern arc); the handle itself is always on the circle.

### Drag handle slide/grip math

Let `C` = cluster centroid (world), `R` = halo radius, `M` = mouse world position.

**Slide phase** (mouse inside halo, `|M − C| ≤ R`):
```
H = C + normalize(M − C) * R   // handle stays on boundary
```
Cluster does not move.

**Grip transition** (first frame where `|M − C| > R`):
```
gripOffset = H − C             // unit vector * R; frozen for rest of drag
```

**Grip phase** (after transition):
```
C_new = M − gripOffset
delta = C_new − C_current
// Apply delta to every member's position
C_current = C_new
```

Grip phase persists until `pointerup` even if the mouse re-enters the halo — this avoids oscillation if the user crosses the boundary multiple times.

### Pop animation

Scale pulse on the target pad (1.0 → 1.25 → 1.0 over 150ms, ease-out) + a single outward ring burst via a brighter/shorter variant of `triggerRipple` (`color = "#00ffff"`, `lifetime = 300ms`). Driven via a transient store slice `pendingPops: Map<todoId, firedAt>`; each `LilyPad` reads its own entry in `useFrame` and self-expires after 150ms.

Triggered on:
- Pop-out (member escapes halo during drag).
- Pop-in (solo pad enters another group's halo during drag).
- Ungroup (clicked pad only).
- Disband (all former members simultaneously).

### Camera follow

Reuse the camera rig from story 3.1. Add a `followTarget: { worldX, worldZ } | null` controller input. When set, each frame the camera pans smoothly so `followTarget` projects to the current mouse cursor position in screen space. When `null`, normal camera behavior resumes. No snap-back on release.

Engaged during:
- Pop-out (target = dragged pad, until pointerup).
- Pop-in (target = dragged pad, until pointerup).
- Cluster drag grip phase (target = mouse, until pointerup).

### Wake vs ripple

Existing circular ripples stay unchanged (used for click feedback, pop bursts, etc.). **Wakes** are a new directional primitive emitted only during member drag within a group — crescent-shaped, oriented opposite to the dragged pad's motion vector, emitted at ~80ms cadence while velocity exceeds a threshold.

### Sibling repulsion during member drag

Each sibling computes its own nudge imperatively in `useFrame`:
```ts
const toSelf = siblingRest - anchorPos
const dist = length(toSelf)
const repelRadius = 1.5
if (dist < repelRadius) {
  const strength = (1 - dist / repelRadius) * REPEL_K
  nudgeRef.current = normalize(toSelf) * strength
  group.position = siblingRest + nudgeRef.current
}
```
Nudges are transient during the drag. On release, each sibling with `|nudge| > 0.05` commits its final position via `PATCH /api/todos/{id}`. `autoSpread` then runs on the group to resolve any residual overcrowding.

### `autoSpread` is a pure side-effect helper in PondScene

Called after: group creation (onSuccess), disband (onSuccess), ungroup-this-pad (onSuccess), pop-in (onSuccess), pop-out (onSuccess), member-drag release, and the "Spread Out" button in the popup. Centralising it here avoids duplication.

### One-group-per-todo enforcement

The backend service rejects `POST /api/groups` if any `member_id` is already in a group. Query `group_memberships` for existing rows before inserting and raise HTTP 400 if any are found. `PATCH /api/groups/{id}` with `member_ids` must similarly validate that incoming pads aren't already in a different group (pop-in adds from solo, so this is the expected path).

### Deferred items

- **FR20: Cluster-aware search** — story 5.6 (already drafted); depends on this story landing first.
- **LightningBorder cluster aura** — the UX spec mentions electric arcs between members. This story uses a simpler second `GlowSource`. Polish story if the effect reads as too subtle.
- **Batch position endpoint** (`PATCH /api/todos/positions`) — individual PATCHes on cluster drag / intra-group drag are fine at ≤ 30 pads. Promote if performance degrades.
- **Elliptical halo** — v1 uses a circular halo (radius `R` from centroid). If the visual feels off for elongated clusters, promote to a fitted ellipse; the drag handle's bbox-derived position stays correct either way.
- **Handle polish** — the v1 handle is a simple ring segment / chevron. A more distinctive affordance (e.g., a small "anchor point" glyph matching the neon-cyan aesthetic) is a polish story.

---

## Dev Agent Record

### Implementation Notes

**Backend (Tasks 1+2) — 2026-04-22.** Schemas, service, and router all landed per spec. Key calls made beyond the spec:

- **Service floor on `member_ids` is 2 (both on POST and PATCH).** A group of one is meaningless UI, so the service rejects with `group_too_small` at the boundary rather than letting it persist. The Ungroup flow in the frontend handles the "reducing to 1" case by calling DELETE instead of PATCH (consistent with AC #6).
- **Added `GroupTooSmallError` to `exceptions.py`** (not explicitly listed in the story, but needed to keep validation errors typed — the `AppError` global handler renders a stable envelope, which the frontend already relies on).
- **`TodoResponse.group_id` propagates through ALL mutation paths, not just `list_todos`.** `update_todo`, `delete_todo`, and `restore_todo` now return `TodoResponse` (was raw `Todo` ORM) with `group_id` populated via a new `_group_id_for` helper. Without this, PATCHing a grouped pad's position would flash `group_id: null` into the React Query cache until the next list refetch landed. Router is correspondingly simpler (no more `TodoResponse.model_validate(t)` calls — service returns the right shape).
- **`_require_todos_exist` also rejects soft-deleted todos.** Soft-deleted pads are invisible in the UI; letting them into a group would render a ghost member. The guard lives in a shared private helper so both create and update enforce it.
- **`conftest.py` now cleans `Group` rows too.** Previously only `GroupMembership` was wiped between tests — with groups surviving across tests, the `member_already_grouped` guard would false-positive depending on test ordering.

**Quality gate:** 141/141 backend tests green (27 new — 16 service + 11 API). `ruff check src/` + `ruff format --check src/` clean. `mypy src/ --strict` clean (28 files, no issues).

### Debug Log

- One `ruff format` reformat on `group_service.py` (89-char lines wrapped by black-compatible formatter) — fixed in place.

### Completion Checklist

- [ ] All ACs implemented and manually verified
- [ ] All tasks checked off
- [ ] All tests green
- [ ] TypeScript clean
- [ ] Backend ruff + mypy clean
- [ ] Committed at task checkpoints per CLAUDE.md
