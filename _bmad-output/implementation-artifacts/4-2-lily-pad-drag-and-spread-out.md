# Story 4.2: Lily Pad Drag & Spread-Out

Status: ready-for-dev

> **Scope note — replaces the original 4.2 "Lily Pad Clustering & Groups"** (which was a full group/cluster story). That story was too large to ship as a unit; the PRD's FR12 (drag to reposition) and the new `/spread-out` command are the two concrete deliverables here. The full group/ungroup system (shared aura, G/U keyboard shortcuts, POST /api/groups, etc.) is deferred to a later story.
>
> **What ships:**
> 1. **Drag to reposition**: click-and-drag any lily pad to move it on the water plane. A clean click (≤ 4 px total movement) still opens the ActionPopup as before. A drag (> 4 px) moves the pad and saves the new position to the backend on release.
> 2. **`/spread-out` slash command**: registered in the story 3.3 framework; computes non-overlapping positions for all currently-visible pads using iterative collision resolution; animates each pad to its target over ~600 ms; persists each final position via `PATCH /api/todos/{id}`.
> 3. **Group-aware algorithm interface**: `computeSpreadPositions` accepts a `groupings: Map<todoId, groupId>` parameter. For this story the map is always empty (all pads are independent). When a future story adds group infrastructure, it can pass the real groupings here without touching the algorithm.
> 4. **Store slice** `padTargetPositions`: a new `usePondStore` Map slice that LilyPad reads in `useFrame` to lerp toward spread-out targets; cleared per-pad on arrival.
>
> **No new backend endpoints** needed: `PATCH /api/todos/{id}` already accepts `position_x` / `position_y`. A batch endpoint (`PATCH /api/todos/positions`) is noted in the architecture but deferred.
>
> **No group DB tables** in this story. The `groups` and `group_memberships` tables from the architecture schema are deferred.
>
> **Position persistence on drag** fires immediately on `pointerUp` — no 2-second debounce (the 2s debounce from story 4.3 is for a continuous drag-during-scroll scenario; a single drag-and-release fires once and is cheap).

---

## Frontend conventions (recap)

- **State**: `usePondStore` ([frontend/src/stores/usePondStore.ts](frontend/src/stores/usePondStore.ts)) for transient per-pad data. Follow the existing `completingTodos`/`deletingTodos`/`colorPreviews` Map-slice patterns.
- **Drag** happens inside Three.js / R3F. Pointer capture (`e.nativeEvent.setPointerCapture`) + DOM listeners on `state.gl.domElement` handle move events outside the mesh (see Task 2 for exact pattern).
- **Water plane intersection**: `new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)` + `state.raycaster.ray.intersectPlane(plane, target)` to convert screen coordinates to world `(x, z)`. The water plane in this scene is at `y = 0`.
- **Slash-command framework**: [frontend/src/utils/slashCommands.ts](frontend/src/utils/slashCommands.ts) and the `SlashCommand` interface. New category file `spreadOutCommand.ts`; registered at startup in `main.tsx` (after `registerVisibilityCommands()`).
- **`WorldSnapshot`** extension: add `todos: readonly Todo[]` as an optional field so `/spread-out` can check if there are pads to spread. Existing commands ignore this field (it's optional).
- **Animation**: use existing `useFrame` + lerp pattern in LilyPad. No new animation primitives.
- **Testing**: pure functions (`computeSpreadPositions`) in isolation; store slices via `usePondStore.setState`; command registration via `registerCommand`/`clearRegistry`.

---

## Story

As a user,
I want to drag individual lily pads to reposition them on the pond and use `/spread-out` to automatically ensure no pads overlap,
so that I can organise my pond the way I want without pads stacking invisibly on top of each other.

---

## Acceptance Criteria

### Drag to reposition

1. **Given** a lily pad is at rest (not completing, not deleting, popup closed), **When** I press-and-hold the pointer on the pad and move it more than 4 px (screen distance), **Then** the pad follows the projected water-plane position of the pointer in real time — smooth with no teleport. No popup opens during the drag. Camera orbit and pan do NOT fire (the drag consumes the pointer event exclusively).

2. **Given** I am dragging a lily pad, **When** I release the pointer, **Then** (a) the pad stays at the released position, (b) `PATCH /api/todos/{id}` is called with the new `{ position_x, position_y }` in world-space coordinates (Float, same coordinate system as `positionX`/`positionY` already in the DB), (c) on success React Query invalidates the todos prefix cache, (d) the existing decay-visual (Story 2.6) activates if the call fails after retry exhaustion.

3. **Given** I press-and-hold on a pad but move less than 4 px before releasing, **Then** the interaction is a click: the pad does not move, and the ActionPopup opens as it does today — the existing `handlePadClick` flow fires unchanged.

4. **Given** a pad is mid-completing or mid-deleting (in `completingTodos` or `deletingTodos`), **When** I try to drag it, **Then** the drag is ignored (the pad is dissolving; moving it would be confusing). Consistent with the existing click guard on the same condition.

5. **Given** I drag a pad over another pad's position, **Then** the dragged pad passes over it with no repulsion (no collision physics during drag — the user is in full control of placement).

6. **Given** the ActionPopup is open, **When** I try to drag the popup's pad, **Then** the drag is ignored (popup is the active interaction; dragging would conflict with the popup's onPointerDown/stopPropagation bubble).

### /spread-out slash command

7. **Given** the pond has visible pads, **When** I type `/spread-out` in TodoInput and press Enter, **Then** the command dispatches and all visible pads animate toward new positions over ~600 ms (lerp, same pattern as other pad animations) such that no two pad bodies overlap after settling (minimum center-to-center distance ≥ 2.4 world units — `2 × PAD_RADIUS(1.0) + 0.4` gap).

8. **Given** the spread-out animation completes for a pad, **When** it reaches its target within 0.05 world-unit threshold, **Then** `PATCH /api/todos/{id}` fires with the settled `{ position_x, position_y }`. Network errors follow the Story 2.6 decay pattern. Each pad fires its own PATCH independently when it arrives (no batch coordination).

9. **Given** some pads already have non-overlapping positions, **When** `/spread-out` runs, **Then** those pads move minimally or not at all — the algorithm resolves only actual overlaps (iterative collision resolution, not a full re-layout).

10. **Given** a future story adds group infrastructure (group IDs in the store/backend), **When** `/spread-out` runs, **Then** pads within the same group move as a rigid unit (their relative offsets are preserved; only the group centroid is repelled). This is guaranteed by the algorithm signature `computeSpreadPositions(todos: Todo[], groupings: Map<string, string>)` — in this story `groupings` is `new Map()` (all singletons); future callers pass real group memberships.

11. **Given** `/spread-out` is registered in the slash-command registry, **When** the TodoInput autocomplete dropdown is open, **Then** `/spread-out` appears with description `"Spread pads apart so none overlap"`. It is always consumable (no visibility precondition — even if only one pad is visible, running it is a harmless no-op). It can be chained with visibility commands: `/show-all /spread-out` is a valid Enter-dispatch chain.

12. **Given** I run `/spread-out` and pads are animating, **When** I drag one of the animating pads, **Then** the drag takes over that pad's position (drag wins over the spread-out target for that pad). The spread-out target for that pad is cleared on `pointerDown`.

### Quality gate

13. **Given** I run the full frontend test suite after this story, **Then** all 259 existing tests plus new tests pass. New tests cover: drag threshold discriminates click from drag, drag end triggers `useUpdateTodo.mutate` with position, `computeSpreadPositions` resolves overlapping pairs to ≥ 2.4 unit separation, `computeSpreadPositions` preserves relative offsets within a group, `/spread-out` command is always consumable, spread target cleared on arrival.

---

## Tasks / Subtasks

- [ ] **Task 1: Store slice — `padTargetPositions`** (AC: #7, #8, #12)
  - [ ] In `frontend/src/stores/usePondStore.ts`:
    - [ ] Add to `PondState`:
      ```ts
      /** Story 4.2: target world-XZ positions set by /spread-out. LilyPad lerps toward
       *  its entry and clears it on arrival, then fires PATCH to persist. */
      padTargetPositions: Map<string, { x: number; z: number }>;
      ```
    - [ ] Add actions:
      ```ts
      setTargetPositions: (targets: Map<string, { x: number; z: number }>) => void;
      clearTargetPosition: (id: string) => void;
      ```
    - [ ] Initialise `padTargetPositions: new Map()` in the `create` body.
    - [ ] Implement `setTargetPositions: (targets) => set({ padTargetPositions: targets })`.
    - [ ] Implement `clearTargetPosition: (id) => set(state => { const m = new Map(state.padTargetPositions); m.delete(id); return { padTargetPositions: m }; })`.
  - [ ] Add test coverage in `frontend/src/stores/usePondStore.test.ts`: `setTargetPositions` populates the map; `clearTargetPosition` removes one entry.

- [ ] **Task 2: Drag mechanics in `LilyPad.tsx`** (AC: #1–#6)

  The implementation lives entirely inside `LilyPad` — no new hook file, per the "prefer editing existing files" rule.

  - [ ] Add drag state refs near the existing pad-state refs (around line 390):
    ```ts
    const isDraggingRef = useRef(false);
    const dragStartScreenRef = useRef<{ x: number; y: number } | null>(null);
    const dragPosRef = useRef<{ x: number; z: number }>({ x: posX, z: posZ });
    const DRAG_THRESHOLD_PX = 4;
    ```
  - [ ] Replace `onClick={handlePadClick}` on the flat mesh with `onPointerDown` for drag initiation:
    ```ts
    onPointerDown={(e) => {
      e.stopPropagation();
      const state = usePondStore.getState();
      if (state.completingTodos.has(todo.id) || state.deletingTodos.has(todo.id)) return;
      if (state.activePopupTodoId) return;  // popup open — ignore drag (AC #6)
      dragStartScreenRef.current = { x: e.clientX, y: e.clientY };
      isDraggingRef.current = false;  // not yet — need threshold
      // Capture pointer so move events arrive even off-mesh
      (e.nativeEvent.target as Element).setPointerCapture(e.nativeEvent.pointerId);
    }}
    ```
  - [ ] Add `onPointerMove` on the mesh to detect threshold and update position:
    ```ts
    onPointerMove={(e) => {
      if (!dragStartScreenRef.current) return;
      const dx = e.clientX - dragStartScreenRef.current.x;
      const dz = e.clientY - dragStartScreenRef.current.y;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (!isDraggingRef.current && dist < DRAG_THRESHOLD_PX) return;
      isDraggingRef.current = true;
      // Clear spread target on drag takeover (AC #12)
      usePondStore.getState().clearTargetPosition(todo.id);
      // Project pointer onto water plane (y=0)
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const target = new THREE.Vector3();
      e.ray.intersectPlane(plane, target);
      dragPosRef.current = { x: target.x, z: target.z };
    }}
    ```
  - [ ] Add `onPointerUp` on the mesh to finish drag or open popup:
    ```ts
    onPointerUp={(e) => {
      if (!dragStartScreenRef.current) return;
      (e.nativeEvent.target as Element).releasePointerCapture(e.nativeEvent.pointerId);
      const wasDrag = isDraggingRef.current;
      dragStartScreenRef.current = null;
      isDraggingRef.current = false;
      if (!wasDrag) {
        // Clean click — open popup (existing handlePadClick logic)
        const state = usePondStore.getState();
        if (!state.completingTodos.has(todo.id) && !state.deletingTodos.has(todo.id)) {
          state.openPopup(todo.id, dragPosRef.current.x, dragPosRef.current.z);
        }
        return;
      }
      // Drag ended — persist position
      updateTodo.mutate({ id: todo.id, positionX: dragPosRef.current.x, positionY: dragPosRef.current.z });
    }}
    ```
  - [ ] Remove the standalone `onClick={handlePadClick}` prop now that `onPointerUp` handles clean clicks. Keep `handlePadClick` body as inline logic inside `onPointerUp` (or inline it). Update the `useCallback` and its deps accordingly.
  - [ ] Wire `useUpdateTodo` inside LilyPad: `const updateTodo = useUpdateTodo();` (import from `../../api/todoApi`). Note: `useUpdateTodo` already fires `invalidateQueries({ queryKey: TODOS_KEY })` on success (see [todoApi.ts:109](frontend/src/api/todoApi.ts#L109)).
  - [ ] In `useFrame`, in the resting/floating-drift phase: if `isDraggingRef.current`, override `group.position.x = dragPosRef.current.x` and `group.position.z = dragPosRef.current.z` (skip the normal drift offsets). **This is the imperative live-update during drag — no React re-render involved.** The guard must be added at the top of the relevant useFrame branch (look for lines 1143–1146 where drift offsets are applied).
  - [ ] Also in `useFrame`: handle spread-out target lerp. After the drag guard, add:
    ```ts
    const target = usePondStore.getState().padTargetPositions.get(todo.id);
    if (target && !isDraggingRef.current) {
      const lerpSpeed = 1 - Math.pow(0.001, delta);  // ~600ms convergence
      group.position.x = THREE.MathUtils.lerp(group.position.x, target.x, lerpSpeed);
      group.position.z = THREE.MathUtils.lerp(group.position.z, target.z, lerpSpeed);
      const closeEnough =
        Math.abs(group.position.x - target.x) < 0.05 &&
        Math.abs(group.position.z - target.z) < 0.05;
      if (closeEnough) {
        usePondStore.getState().clearTargetPosition(todo.id);
        updateTodo.mutate({ id: todo.id, positionX: target.x, positionY: target.z });
      }
    }
    ```
  - [ ] Keep the `new THREE.Plane` allocation **outside the event handler** if hot path; inside the handler is fine since it only fires on pointer events (not per-frame).
  - [ ] Test in `frontend/src/components/pond/LilyPad.test.tsx`: the test environment stubs Three.js — focus on the pointer threshold logic via simulated pointer events; verify `useUpdateTodo().mutate` is called with position args on drag end.

- [ ] **Task 3: Pure `computeSpreadPositions` function** (AC: #7, #9, #10)
  - [ ] Create `frontend/src/utils/spreadOut.ts`:
    ```ts
    import type { Todo } from '../types';

    export interface PadPosition { x: number; z: number }

    const PAD_MIN_DIST = 2.4;  // 2 × PAD_RADIUS(1.0) + 0.4 gap — must match LilyPad.tsx PAD_RADIUS
    const MAX_ITERATIONS = 80;

    /**
     * Compute non-overlapping positions for the given todos.
     * groupings maps todoId → groupId; todos sharing a groupId move as a rigid unit.
     * For this story, pass new Map() (all singletons).
     * Returns a Map<todoId, PadPosition> containing ONLY pads whose position changed
     * by more than 0.01 units (no-op entries omitted to avoid spurious PATCHes).
     */
    export function computeSpreadPositions(
      todos: Todo[],
      groupings: Map<string, string>,
    ): Map<string, PadPosition> { ... }
    ```
  - [ ] Algorithm outline inside `computeSpreadPositions`:
    1. Build `positions: Map<string, PadPosition>` from `todo.positionX ?? 0` / `todo.positionY ?? 0`.
    2. Build group centroid map: for each unique groupId in `groupings`, compute centroid of its members. For singletons the centroid IS the pad's own position.
    3. Iteration loop (up to `MAX_ITERATIONS`):
       - For every pair `(a, b)` where `groupings.get(a.id) !== groupings.get(b.id)` (or either is a singleton): compute `dist` between their positions.
       - If `dist < PAD_MIN_DIST`: compute repulsion delta (`(PAD_MIN_DIST - dist) / 2`), push apart along the axis (if `dist < 0.001`, choose a random perpendicular). Apply to **all members of each group** (translate entire group rigidly).
       - Track whether any push was applied; break early if stable.
    4. Collect entries where `|newPos.x - original.x| > 0.01 || |newPos.z - original.z| > 0.01` and return as Map.
  - [ ] Create `frontend/src/utils/spreadOut.test.ts` with tests:
    - `resolves two overlapping pads to ≥ PAD_MIN_DIST apart`
    - `does not move pads that are already separated`
    - `preserves relative offset within a group (two pads in same group)`
    - `handles single pad (no-op)`
    - `handles identical positions (does not crash — uses deterministic jitter)`

- [ ] **Task 4: `/spread-out` slash command** (AC: #7, #8, #11)
  - [ ] Create `frontend/src/utils/spreadOutCommand.ts`:
    ```ts
    import { registerCommand } from './slashCommands';
    import { computeSpreadPositions } from './spreadOut';
    import { usePondStore } from '../stores/usePondStore';
    import { TODOS_KEY } from '../api/todoApi';

    export function registerSpreadOutCommand(
      getQueryData: () => readonly Todo[]
    ): void {
      registerCommand({
        token: '/spread-out',
        description: 'Spread pads apart so none overlap',
        isConsumable: (_world) => true,  // always runnable — no-op if already spread
        project: (world) => world,       // no WorldSnapshot change
        execute() {
          const todos = getQueryData();
          const targets = computeSpreadPositions(todos, new Map());
          if (targets.size > 0) {
            usePondStore.getState().setTargetPositions(targets);
          }
        },
      });
    }
    ```
  - [ ] `getQueryData` is injected at registration time. In `main.tsx`, pass a closure over the React Query client:
    ```ts
    // After queryClient is created, before ReactDOM.createRoot:
    registerSpreadOutCommand(() => {
      const entries = queryClient.getQueriesData<Todo[]>({ queryKey: TODOS_KEY });
      const todos: Todo[] = [];
      const seen = new Set<string>();
      for (const [, data] of entries) {
        if (!data) continue;
        for (const t of data) {
          if (!seen.has(t.id)) { seen.add(t.id); todos.push(t); }
        }
      }
      return todos;
    });
    ```
    This is the same de-dup pattern used in [useCameraResetOnDoubleEscape.ts](frontend/src/hooks/useCameraResetOnDoubleEscape.ts) for prefix-keyed cache reads.
  - [ ] `WorldSnapshot` extension: add optional `todos?: readonly Todo[]` field to the interface in `slashCommands.ts`. Existing commands ignore it (`isConsumable` only reads `world.visibility`, not `world.todos`). The `worldFromVisibility` function remains unchanged (todos field stays undefined there).
  - [ ] In `main.tsx`: call `registerSpreadOutCommand(...)` after `registerVisibilityCommands()`, before `ReactDOM.createRoot(...).render(...)`.
  - [ ] Tests in `frontend/src/utils/spreadOutCommand.test.ts`: command is always consumable; `execute()` calls `setTargetPositions` with the result of `computeSpreadPositions`.

- [ ] **Task 5: Tests & quality gates** (AC: #13)
  - [ ] Run `npx vitest run` — all new + existing tests green.
  - [ ] Run `npx tsc --noEmit` — no type errors.
  - [ ] Run `ruff check src/ && ruff format src/` (backend; no backend changes expected in this story, but verify clean).
  - [ ] Confirm drag doesn't break existing `PondScene.test.tsx` (mock `useUpdateTodo` already returns `{ mutate: mockMutate }`; the new LilyPad usage is the same hook, same mock shape).

---

## Dev Notes

### Three.js drag on a mesh: the pointer capture pattern

R3F `ThreeEvent` exposes `e.ray` (a `THREE.Ray` from the raycaster) on all pointer events, including `onPointerMove`. Pointer capture on the underlying DOM element means the element keeps receiving `pointermove` and `pointerup` even when the pointer moves off the mesh — this is critical for fast drags. The `setPointerCapture` / `releasePointerCapture` calls use `e.nativeEvent` (the DOM `PointerEvent`).

Example water-plane intersection:
```ts
const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const worldPt = new THREE.Vector3();
e.ray.intersectPlane(waterPlane, worldPt);
// worldPt.x, worldPt.z are the pond coordinates
```

Allocate `waterPlane` and `worldPt` once as module-scope constants outside the component, NOT inside `useFrame` or event handlers, to avoid per-event GC pressure.

### Why drag overrides the useFrame drift

LilyPad's `useFrame` currently writes `group.position.x/z` in the floating-drift phase (lines 1143–1146) with small sinusoidal offsets. During drag we must override this, otherwise the drag cursor leads by a drift amount. The `isDraggingRef` check at the top of that useFrame branch skips the drift writes and instead applies `dragPosRef.current` directly.

### Why onClick is removed in favour of onPointerUp

Three.js's `onClick` fires after `onPointerUp` on the same mesh. This creates a double-dispatch risk when we handle both. Since we're already tracking the pointer-up event and can compute whether it was a click (threshold check), we can inline the popup-open logic there and remove `onClick` entirely. The `handlePadClick` `useCallback` can be deleted or inlined.

### Spread-out lerp speed calibration

`lerpSpeed = 1 - Math.pow(0.001, delta)` with `delta ≈ 0.016` (60 fps) gives `≈ 0.107` per frame, which means pads close 90% of the distance in about 20 frames (~333 ms). Using `0.001` as the base gives a snappier feel than the camera reset's `0.05` base. Adjust the base if the animation reads as too fast or too slow.

### Adding a new slash command (future reference)

1. Create `frontend/src/utils/{name}Command.ts` → call `registerCommand(...)`.
2. Register in `main.tsx` before `ReactDOM.createRoot`.
3. If the command needs `WorldSnapshot` data beyond `visibility`, extend `WorldSnapshot` in `slashCommands.ts` with an optional field.

### Deferred items

- **Batch position endpoint** (`PATCH /api/todos/positions`): the architecture specifies this for efficiency when many pads move simultaneously. For spread-out with < 30 pads, individual PATCHes are fine. Promote to a story when the pad count grows or position saves become measurably slow.
- **Position persistence during drag of clusters**: once groups exist (future story), dragging a cluster should move all its members. The drag handler currently only updates `todo.id`. The architecture's `PATCH /api/todos/positions` batch endpoint is the natural home for that.
- **2-second debounce on continuous repositioning**: story 4.3 specified debounced position saves. This story uses a single on-release PATCH, which is simpler and sufficient. The 2s debounce is appropriate for a "drag then place" UX where the user adjusts position slowly.
- **Collision avoidance during drag** (pads repel each other as you drag over them): not in scope — would require real-time O(n) force computation per drag event; deferred.

---

## Dev Agent Record

_To be completed during implementation._

### Implementation Notes

<!-- Record any decisions, unexpected findings, or deviations from the story here. -->

### Debug Log

<!-- Record any debugging steps, errors encountered, and their resolutions. -->

### Completion Checklist

- [ ] All ACs implemented and manually verified
- [ ] All tasks checked off
- [ ] All tests green (`npx vitest run`)
- [ ] TypeScript clean (`npx tsc --noEmit`)
- [ ] Backend ruff clean (no changes expected, but confirm)
- [ ] Committed at task checkpoints per CLAUDE.md
