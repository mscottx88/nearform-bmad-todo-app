# Story 2.5: Deletion via Popup — Red Flash + Dissolve

Status: done

> **Replaces** the prior backlog story "Delete Aphid — Interruptible Eating" (dropped on 2026-04-16 when the PRD simplification removed creature-based controls). Deletion is now a one-click action on the Action Popup that soft-deletes on the backend and mirrors the completion visual from [Story 2.4](./2-4-completion-via-popup-green-flash-and-dissolve.md), swapping green for red and skipping the creature emerge. Depends on [Story 2.3](./2-3-in-scene-action-popup.md) (Action Popup — `done`) and [Story 2.4](./2-4-completion-via-popup-green-flash-and-dissolve.md) (pattern source — `done`).

## Story

As a user,
I want to click **Delete** on a focused pad's popup and watch the pad flash red and dissolve,
so that deletion uses the same unified visual language as completion without a separate creature control.

## Acceptance Criteria

1. **Given** an active todo's popup is open (Story 2.3), **When** I click the **Delete** button, **Then** the popup dismisses immediately (`closePopup()` — clears `activePopupTodoId` and `cameraFocus`).

2. **Given** Delete was just clicked, **When** the deletion sequence begins, **Then** the pad pulses bright neon red (`#ff1744` by default — see Open Question 1 for palette rationale) for ~300ms with a Bloom-lit flash that overrides the pad's normal color. The shader `uColor` is snapped to full-intensity red for the entire flash window (do **not** ramp — the 2.4 review called this out) and restored to `colorVec` on flash-end so the dissolve's opacity fade hides the underlying color cleanly.

3. **Given** the flash is playing, **When** it ends, **Then** the pad begins dissolving — fades and shrinks into the water surface over 600–900ms with an outward ripple via `usePondStore.triggerRipple(posX, posZ)` fired exactly once at the dissolve start. No creature emerges (that's completion's job, not deletion's).

4. **Given** the pad has fully dissolved, **When** the sequence settles (~400ms of water settling), **Then** the backend has been updated via `DELETE /api/todos/{id}` which soft-deletes the record (`deleted=true`, `deleted_at=NOW()`). The DELETE is fire-and-forget from the visual flow's perspective — the animation does not await network completion.

5. **Given** the todo is now `deleted: true`, **When** `useTodos` refetches on mutation success, **Then** the deleted todo is excluded from the pond render. The backend's `list_todos` already filters `Todo.deleted == False` (see `backend/src/services/todo_service.py:36-45`), so the frontend simply renders whatever the API returns. The pad's `LilyPad` component unmounts naturally after the dissolve and refetch.

6. **Given** the deletion sequence is mid-flight, **When** a refetch would normally unmount the pad (PATCH/DELETE arrived, list no longer contains the id), **Then** the pad remains mounted for the full local animation arc via a store-level `deletingTodos` map that overrides the live list (mirrors 2.4's `completingTodos` pattern).

7. **Given** the Delete click happens, **When** the DELETE network call fails (rejected, offline, 500, etc.), **Then** the deletion still proceeds locally — the error is logged via `console.warn` but does not roll back the flash/dissolve. Permanent backend error handling (decay animation, auto-retry) is Story 2.6's concern; v1 is best-effort. Wire the handler via React Query's `onError` option (not a synchronous `try/catch` alone — `mutate()` routes network errors through `onError`, as the 2.4 review discovered).

8. **Given** a pad is mid-dissolve (scale/opacity still > 0 through ~t=1.0s), **When** the user clicks it again, **Then** the click is ignored — `handlePadClick` short-circuits when the todo id is in `deletingTodos` (or `completingTodos`). No second popup, no second DELETE. `startDeletion` is also idempotent (no-op when id already present) as a belt-and-suspenders guard against double-dispatch.

9. **Given** the `deletingTodos` override for a pad is cleared externally while the pad is still mid-sequence (not the happy-path terminal transition), **When** the next frame runs, **Then** the pad restores to `resting` with full opacity/scale so it isn't left as an invisible unclickable ghost. This mirrors 2.4's external-cancel recovery branch — keep the same pattern.

## Tasks / Subtasks

- [x] Task 1: Backend wiring — `useDeleteTodo` React Query hook (AC: #4)
  - [x] Edit `frontend/src/api/todoApi.ts` — add `useDeleteTodo()` alongside the existing `useCreateTodo` / `useUpdateTodo`
  - [x] Mutation: `DELETE /api/todos/{id}` — backend returns the soft-deleted `TodoResponse`; frontend accepts the response but doesn't need the body
  - [x] `onSuccess`: invalidate `['todos', 'list']` (same pattern as update/create)
  - [x] Export the hook so both `usePopupDelete` (this story) and future consumers can use it
  - [x] **Do not** change `todoApi`'s existing hooks. **Do not** change `apiClient` or interceptors.

- [x] Task 2: `usePopupDelete` hook (AC: #1, #4, #7)
  - [x] New file: `frontend/src/hooks/usePopupDelete.ts`
  - [x] Exports `useDeleteTodoAction(): (todoId: string) => void`
  - [x] Internally uses `useDeleteTodo()` from Task 1
  - [x] Behavior: fire `deleteTodo.mutate(todoId, { onError: (err) => console.warn(...) })` synchronously; return `void`
  - [x] Wrap the `mutate` call in `try/catch` too, to cover the rare synchronous-throw path (2.4 locked this pattern in — mirror it exactly; see `frontend/src/hooks/usePopupComplete.ts`)
  - [x] New file: `frontend/src/hooks/usePopupDelete.test.ts` — mirror `usePopupComplete.test.ts` structure:
    - [x] `deleteTodo.mutate` fires with the todo id and an `onError` option
    - [x] `console.warn` fires when `onError` is invoked (async network failure path — exact contract from AC #7)
    - [x] Hook does not throw when `mutate` throws synchronously
  - [x] **Naming note**: the architecture doc calls the hook file `usePopupDelete.ts`. Use that exact path. Inside it, the exported symbol is `useDeleteTodoAction` to avoid colliding with `useDeleteTodo` from `todoApi.ts`.

- [x] Task 3: Extend `usePondStore` with deletion-sequence state (AC: #6, #8, #9)
  - [x] In `frontend/src/stores/usePondStore.ts`, add a parallel store for deletion:
    ```ts
    export interface DeletingEntry {
      todo: Todo;
      startedAt: number; // R3F clock, stamped by LilyPad on first active frame
    }
    ```
  - [x] Add to `PondState`: `deletingTodos: Map<string, DeletingEntry>;`
  - [x] Add actions:
    - `startDeletion(todo: Todo): void` — no-op if `deletingTodos` already has the id (AC #8); otherwise insert with `startedAt: 0`. Replace the Map reference (`new Map(current)`) so zustand's default `Object.is` selectors fire.
    - `finishDeletion(todoId: string): void` — delete the entry; no-op if not present.
  - [x] Add and export `selectDeleting(todoId)` convenience selector (mirror `selectCompleting`):
    ```ts
    export const selectDeleting =
      (todoId: string) =>
      (s: PondState): DeletingEntry | undefined =>
        s.deletingTodos.get(todoId);
    ```
  - [x] Initial state: `deletingTodos: new Map()`
  - [x] Extend `frontend/src/stores/usePondStore.test.ts` `beforeEach` to reset `deletingTodos: new Map()` alongside `completingTodos`.
  - [x] New `describe('startDeletion / finishDeletion')` block mirroring the `startCompletion / finishCompletion` tests — add coverage for the idempotency guard (double-call same id does not replace the existing entry; `size` stays at 1).

- [x] Task 4: Wire `ActionPopup.onDelete` in `PondScene` (AC: #1, #4)
  - [x] In `frontend/src/components/pond/PondScene.tsx`:
    - [x] Import `useDeleteTodoAction` from `../../hooks/usePopupDelete`
    - [x] Call `const deleteTodo = useDeleteTodoAction();` near `useCompleteTodo()`
    - [x] Replace the current `onDelete={() => console.log('Delete', popupTodo.id)}` stub with:
      ```ts
      const handleDelete = () => {
        if (!popupTodo) return;
        deleteTodo(popupTodo.id);
        usePondStore.getState().startDeletion(popupTodo);
        usePondStore.getState().closePopup();
      };
      ```
      and pass `onDelete={handleDelete}` to `<ActionPopup>`
    - [x] Remove the `// TODO(Story 2.5)` comment
  - [x] Union `useTodos` with `deletingTodos` for rendering (mirrors 2.4's completion override in `renderTodos`):
    - [x] Subscribe: `const deletingTodos = usePondStore((s) => s.deletingTodos);`
    - [x] Extend the `renderTodos` `useMemo` to walk both `completingTodos` **and** `deletingTodos` for overrides:
      ```ts
      const renderTodos = useMemo<Todo[]>(() => {
        if (completingTodos.size === 0 && deletingTodos.size === 0) return todos;
        const ids = new Set(todos.map((t) => t.id));
        const extras: Todo[] = [];
        for (const entry of completingTodos.values()) {
          if (!ids.has(entry.todo.id)) { extras.push(entry.todo); ids.add(entry.todo.id); }
        }
        for (const entry of deletingTodos.values()) {
          if (!ids.has(entry.todo.id)) { extras.push(entry.todo); ids.add(entry.todo.id); }
        }
        return extras.length > 0 ? [...todos, ...extras] : todos;
      }, [todos, completingTodos, deletingTodos]);
      ```
  - [x] Update `frontend/src/components/pond/PondScene.test.tsx`:
    - [x] Add a mock for `../../hooks/usePopupDelete` exporting `useDeleteTodoAction: () => vi.fn()`
    - [x] Add a test mirroring the completion-override test: seed `deletingTodos` with a ghost todo id and assert a `lily-pad-<id>` is rendered even when `useTodos` returns `[]`
    - [x] Extend the `beforeEach` `usePondStore.setState` reset to include `deletingTodos: new Map()`

- [x] Task 5: Add `'deleting'` + `'deleted'` phases to LilyPad's state machine (AC: #2, #3, #6, #8, #9)
  - [x] In `frontend/src/components/pond/LilyPad.tsx`:
    - [x] Extend `DropPhase` union: add `'deleting'` and `'deleted'` (the `'deleted'` terminal phase mirrors the `'completed'` terminal phase — same "awaiting unmount, stop re-walking descendants" semantics)
    - [x] Add constants near the completion timings:
      ```ts
      const DELETING_FLASH_END = 0.30;
      const DELETING_DISSOLVE_START = 0.40;
      const DELETING_DISSOLVE_END = 1.20;
      const DELETING_TOTAL = 1.60;
      const DELETE_FLASH_COLOR = new THREE.Vector3(1.0, 0.09, 0.267); // #ff1744
      ```
    - [x] Subscribe to the deletion entry: `const deleting = usePondStore(selectDeleting(todo.id));` (or the inline `(s) => s.deletingTodos.get(todo.id)` — match whatever `completing` uses)
    - [x] Add a parallel `deletingStartTimeRef = useRef<number | null>(null)` and `[deletingStartTime, setDeletingStartTime] = useState<number | null>(null)` (mirror the `completing` pattern — the state mirror is only read by JSX gates, the ref drives `useFrame` work; same split the 2.4 review converged on)
    - [x] Add `deletingRippleFired = useRef(false)`
  - [x] Inside `useFrame`, insert **before** the `completing` transition check (so deleting takes precedence over completing — though in practice they can't coincide because `handlePadClick` blocks during both):
    ```ts
    if (deleting && phaseRef.current === 'resting') {
      phaseRef.current = 'deleting';
      deletingRippleFired.current = false;
      deletingStartTimeRef.current = state.clock.elapsedTime;
      setDeletingStartTime(state.clock.elapsedTime);
    }
    ```
  - [x] External-cancel recovery (mirror the completing branch — this addresses AC #9):
    ```ts
    if (!deleting && phaseRef.current === 'deleting') {
      phaseRef.current = 'resting';
      deletingStartTimeRef.current = null;
      deletingRippleFired.current = false;
      setDeletingStartTime(null);
      group.scale.setScalar(1);
      // Restore opacities via the same traverse the completing path uses —
      // factor the two identical traverses into a single `restorePadMaterials(group)`
      // helper in the module scope to avoid duplication.
      restorePadMaterials(group);
      restStartTime.current = 0;
    }
    ```
  - [x] Add `phase === 'deleted'` early-return alongside the `'completed'` early-return.
  - [x] Add the `deleting` phase branch (mirrors `completing` but with **no Emerge phase**):
    ```ts
    if (phase === 'deleting') {
      const startedAt = deletingStartTimeRef.current;
      if (startedAt === null) return;
      const t = state.clock.elapsedTime - startedAt;

      if (t >= DELETING_TOTAL) {
        phaseRef.current = 'deleted';
        usePondStore.getState().finishDeletion(todo.id);
        return;
      }

      // Flash: snap uColor to red for the full 300ms window, then restore.
      if (padMeshRef.current) {
        const mat = padMeshRef.current.material as THREE.ShaderMaterial;
        if (mat.uniforms?.uColor) {
          if (t < DELETING_FLASH_END) {
            mat.uniforms.uColor.value.copy(DELETE_FLASH_COLOR);
          } else {
            mat.uniforms.uColor.value.set(colorVec.r, colorVec.g, colorVec.b);
          }
        }
      }

      // Ripple once at dissolve start.
      if (!deletingRippleFired.current && t >= DELETING_DISSOLVE_START) {
        usePondStore.getState().triggerRipple(posX, posZ);
        deletingRippleFired.current = true;
      }

      // Dissolve: scale + opacity → 0 via the same traverse the completing
      // branch uses. No EmergingCreature means the `userData.skipDissolve`
      // opt-out has no consumers in this phase — but the guard is harmless;
      // leave it in place so shared traversal code stays identical.
      if (t >= DELETING_DISSOLVE_START) {
        const dissolveT = Math.min(
          (t - DELETING_DISSOLVE_START) /
            (DELETING_DISSOLVE_END - DELETING_DISSOLVE_START),
          1,
        );
        const eased = easeOut(dissolveT);
        group.scale.setScalar(1 - eased);
        const opacity = 1 - eased;
        group.traverse((obj) => {
          if (obj.userData.skipDissolve) return;
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh || (obj as THREE.Line).isLine) {
            const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
            if (Array.isArray(mat)) {
              for (const m of mat) { m.transparent = true; m.opacity = opacity; }
            } else if (mat) {
              mat.transparent = true;
              mat.opacity = opacity;
            }
          }
        });
      }
      return;
    }
    ```
  - [x] **Shared helper refactor**: the dissolve traversal and the material-restore traversal are now duplicated between `completing` and `deleting`. Extract two module-scope helpers — `fadePadMaterials(group, opacity)` and `restorePadMaterials(group)` — and call them from both branches. Do **not** invent a new abstraction beyond these two functions; three identical lines is better than premature abstraction (per CLAUDE.md). This cleanup is scoped to this story; do not expand it into a broader LilyPad refactor.
  - [x] Gate the double-click guard in `handlePadClick`:
    ```ts
    const state = usePondStore.getState();
    if (state.completingTodos.has(todo.id) || state.deletingTodos.has(todo.id)) return;
    state.openPopup(todo.id, posX, posZ);
    ```
  - [x] Extend the `<Html>` text-label render gate to also hide during deletion:
    ```tsx
    {!completing && !deleting && completingStartTime === null && deletingStartTime === null && (
      <Html ...>...</Html>
    )}
    ```
    (the ref-mirror state vars persist one frame after `finish*` clears the store entry, so both gates are needed — same pattern as 2.4).

- [x] Task 6: Tests (AC: all)
  - [x] `usePondStore.test.ts` — `startDeletion` / `finishDeletion` / idempotency / concurrent completing+deleting maps coexist
  - [x] `usePopupDelete.test.ts` — mutation fires with id, `onError` invokes `console.warn`, sync-throw doesn't propagate
  - [x] `PondScene.test.tsx` — ghost deleting-todo renders a LilyPad override (mirror 2.4's `ghost-todo` test)
  - [x] `LilyPad.test.tsx` — extend the existing store mock so the selector-aware stub still returns `undefined` for `s.deletingTodos.get(id)` (mirrors the `completingTodos` mock entry); add `deletingTodos: new Map()` to the `getState` stub so the double-click guard doesn't explode. No useFrame-driven phase-progression test this story — that scaffolding is still deferred (see deferred-work.md 2026-04-17 entry).
  - [x] `todoApi.test.ts` if it exists, otherwise skip — at minimum confirm `useDeleteTodo` compiles and is callable (the integration test runs through `PondScene` already).
  - [x] `npx vitest run` — all passing
  - [x] `npx tsc -b` — clean

### Timing Summary (single source of truth)

All timings relative to the moment `startDeletion` fires. Intentionally identical to 2.4's completion arc minus the Emerge phase:

```
0.00s  Click Delete → popup + cameraFocus cleared → startDeletion
0.00s  Flash begins (pad shader → neon red, Bloom picks it up)
0.30s  Flash ends; pad shader restored to its base color
0.40s  triggerRipple fires (exactly once); Dissolve begins (group scale + opacity → 0)
1.20s  Dissolve complete; pad invisible
1.60s  Settle complete; finishDeletion clears store entry; LilyPad unmounts on next render
```

### Deletion State Machine

Single source of truth: `usePondStore.deletingTodos`.

```
[click Delete]
   │
   ▼
deleteTodo(id)           ← usePopupDelete hook
   │   fires DELETE /api/todos/{id} (fire-and-forget, onError → console.warn)
   ▼
startDeletion(todo)
closePopup()
   │
   ▼ (next frame, LilyPad's useFrame selector picks up entry)
Phase: 'deleting'
   │
   ├── 0.00-0.30s  Flash (shader uColor → #ff1744)
   ├── 0.40s       triggerRipple × 1
   ├── 0.40-1.20s  Dissolve (group scale + material opacity → 0)
   └── 1.20-1.60s  Settle (no work)
   │
   ▼
finishDeletion(id) → phase → 'deleted' (terminal)
   │
   ▼ (next render)
Union(useTodos, completingTodos, deletingTodos) no longer includes this id
   │
   ▼
LilyPad unmounts
```

### Why mirror the completion pattern exactly

Deletion is visually and architecturally parallel to completion. The UX spec explicitly says "same dissolve gesture, differentiated only by flash color" (see `ux-design-specification.md` § 5). The code should reflect that:

- Same phase-machine shape (Flash → Dissolve → Settle, minus Emerge)
- Same store override pattern (`deletingTodos: Map<id, entry>` + `start*` / `finish*` + `select*` selector)
- Same `onError`-plus-sync-throw error contract (2.4 locked this in after a review)
- Same `startedAt` ref + state-mirror split (refs drive `useFrame`, state mirror drives JSX gates — the 2.4 review converged on this after a round of churn)
- Same double-click / double-dispatch guards (idempotent store action + `handlePadClick` short-circuit)
- Same external-cancel recovery branch (prevents invisible-ghost pads)

Do **not** reinvent these patterns. If something feels different, read 2.4's "Review Findings" section first — odds are the question was already answered.

### Existing Code State (pre-implementation facts)

- **Backend** — `DELETE /api/todos/{todo_id}` (`backend/src/api/todos.py:47-56`) calls `todo_service.delete_todo` which sets `deleted=True` + `deleted_at=NOW()` and commits. `list_todos` already filters `deleted=False`. **No backend changes in this story.**
- **Frontend API layer** — `frontend/src/api/todoApi.ts` has `useTodos`, `useCreateTodo`, `useUpdateTodo` — but **no `useDeleteTodo` yet**. Task 1 adds it.
- **Popup `onDelete` stub** — `PondScene.tsx:106` currently logs `'Delete', popupTodo.id` and is marked `// TODO(Story 2.5)`. Task 4 replaces it.
- **No `DeleteAphid.tsx` exists** anywhere in the repo (verified via grep — the string `DeleteAphid` appears only in planning docs referring to the removed concept). The epic's Technical Note claim "Remove `DeleteAphid.tsx` ... exists as a scaffold" is **stale — there is nothing to remove**. Do not hunt for it. Do not create a placeholder to then delete it. Just skip that claim.
- **Aphid-related hooks / components** — none exist. Same story.
- **`completed` vs `deleted` render filtering** — worth noting one asymmetry: `list_todos` filters `deleted=False` AND `archived=False`, but **not** `completed=False`. Story 2.4 relied on the backend filter to hide completed todos, but the backend doesn't do that — the pad renders with a `COMPLETED_Y = -0.1` sink-below-surface visual. This is pre-existing and **out of scope for 2.5**. Do not attempt to change `list_todos` here. For deletion the filter works correctly (`deleted=True` pads do not return from the list endpoint).

### Anti-Patterns to Avoid

- DO NOT add a confirmation dialog. The popup-as-gate is the intent gate; the UX spec explicitly rejects extra confirmation (epics.md Story 2.5 tech note).
- DO NOT spawn a creature on delete. Deletion has no creature emerge. Do not import `<EmergingCreature>`, do not touch `usePopupComplete`, do not touch the creature API.
- DO NOT reintroduce any aphid, eating-bar, or interruptible-delete logic. That entire mechanic was removed with the PRD simplification. Deletion is immediate on click.
- DO NOT drift pad fragments toward a trash lizard. The lizard was removed with Epic 6.
- DO NOT block the animation on the DELETE call. Fire-and-forget. Network errors → `console.warn`. Story 2.6 owns decay/auto-retry.
- DO NOT use `performance.now()` inside `useFrame`. Capture `startedAt` from `state.clock.elapsedTime` on the first active frame. (Repeating the 2.4 warning because it's important.)
- DO NOT call `triggerRipple` more than once per sequence. Guard with the `deletingRippleFired` ref.
- DO NOT restore the camera-to-prior-position. That behavior was dropped in 2.3; 2.4 inherited the decision; 2.5 inherits it too.
- DO NOT install new npm packages.
- DO NOT use `async def` in any Python code (CLAUDE.md rule — this story is frontend-only anyway).
- DO NOT change the backend. Leave `backend/src/api/todos.py` and `backend/src/services/todo_service.py` untouched. The existing `DELETE` endpoint is sufficient.
- DO NOT expand the story scope into Story 2.6 error-state work. If you find yourself wanting to animate biological decay on delete failure, stop — that's 2.6.
- DO NOT add a hard-delete path. Soft-delete is the product decision (epic AC).
- DO NOT modify the completion path to "share" with deletion beyond extracting the two obvious helpers (`fadePadMaterials`, `restorePadMaterials`). A larger refactor is not in scope — three similar lines beats a premature abstraction.

### Previous Story Intelligence (from Story 2.4)

Read `_bmad-output/implementation-artifacts/2-4-completion-via-popup-green-flash-and-dissolve.md` before starting — it is the canonical pattern source for this story. Key lessons already paid for:

- **React Query async errors route through `onError`, not sync throws.** Use both `try/catch` AND `onError` to cover both paths. Add a `console.warn`-on-`onError` test to lock the contract.
- **Capture `startedAt` on the first frame of the phase from the R3F clock.** Mixing `performance.now()` with `state.clock.elapsedTime` is a known trap. Keep the ref + state-mirror split (ref drives `useFrame`; state drives JSX gates).
- **Add terminal phases (`'deleted'` here, parallel to `'completed'`).** Saves per-frame work and lets you distinguish happy-path finish from external cancel.
- **Guard `handlePadClick` against mid-sequence clicks.** Pad remains hit-testable through ~t=1.0s of dissolve; without the guard a second click fires a second DELETE.
- **Make store actions idempotent.** `startDeletion` must no-op when the id is already present (double-dispatch defense).
- **Snap, don't ramp, the flash color.** Ramping the shader uniform through `min(1, flashT*2)` is wrong per spec — set it to full intensity for the whole flash window, restore at flash-end.
- **Tag the text label `<Html>` off during both the store-override and the settling tail.** Without both gates, a 1-frame label flash appears over a scale=0 pad after `finishDeletion` but before refetch.
- **Restore pad materials on external cancel.** If the `deletingTodos` entry is cleared while the pad is still in `'deleting'` (not by our own `finishDeletion`), walk the group and reset opacity/scale — otherwise the pad is an invisible, unclickable ghost.
- **Zustand selector stability.** `s.deletingTodos.get(id)` returns a stable reference when the entry doesn't change; that's enough for zustand's default `Object.is` equality.
- **Testing pattern.** `happy-dom` env; mock `@react-three/fiber` (`useFrame`, `useThree`) and drei (`Html`, `Billboard`). Selector-aware store stub. See `ActionPopup.test.tsx`, `LilyPad.test.tsx`, `PondScene.test.tsx`, `usePondStore.test.ts`.

### Git Intelligence (last commits, most → least recent)

- `cb2d77f` — Story 2.3 code-review follow-ups (closePopup clears cameraFocus; dead-code cleanup)
- `cbc39fd` — Story 2.3 refactor to HTML overlay (ActionPopup is drei `<Html>` + DOM buttons — `onDelete` is a standard DOM `onClick` handler)
- `7afaa2a` — Story 2.3 initial (superseded)
- `81870ce` — PRD simplification that introduced the popup-driven deletion model this story implements
- `6c82829` — Camera zoom-skip bugfix (orthogonal, no bearing on deletion)
- (Implied, not-yet-committed at story creation time) — Story 2.4 implementation: `completingTodos`, `startCompletion`/`finishCompletion`, `selectCompleting`, `usePopupComplete`, `EmergingCreature`, the `'completing'`/`'completed'` phases, and the 14 review fixes. **This story builds on all of it** — read the 2.4 story file before touching LilyPad.

### Project Structure — Files to Create / Modify / Delete

**New:**
- `frontend/src/hooks/usePopupDelete.ts`
- `frontend/src/hooks/usePopupDelete.test.ts`

**Modified:**
- `frontend/src/api/todoApi.ts` — add `useDeleteTodo()` mutation hook
- `frontend/src/stores/usePondStore.ts` — add `DeletingEntry`, `deletingTodos` Map, `startDeletion` / `finishDeletion` actions, `selectDeleting` selector
- `frontend/src/stores/usePondStore.test.ts` — add deletion-sequence tests; extend `beforeEach` reset
- `frontend/src/components/pond/PondScene.tsx` — wire real `onDelete` handler; extend `renderTodos` union to include `deletingTodos`
- `frontend/src/components/pond/PondScene.test.tsx` — mock `usePopupDelete`; add ghost-deleting-todo override test; extend store reset
- `frontend/src/components/pond/LilyPad.tsx` — add `'deleting'` + `'deleted'` phases, `deletingStartTime` ref + state mirror, flash/dissolve/settle timeline; extend `handlePadClick` double-click guard; extend `<Html>` label gate; extract `fadePadMaterials` / `restorePadMaterials` helpers
- `frontend/src/components/pond/LilyPad.test.tsx` — extend selector-aware store mock to include `deletingTodos: new Map()` in `getState` stub

**Deleted:** none (no `DeleteAphid.tsx` exists — epic note is stale)

**Untouched (keep):**
- `backend/src/api/todos.py` — `DELETE /api/todos/{id}` already works
- `backend/src/services/todo_service.py` — `delete_todo` already soft-deletes correctly; `list_todos` already filters `deleted=False`
- `frontend/src/components/creatures/EmergingCreature.tsx` — completion-only, do not import from here
- `frontend/src/hooks/usePopupComplete.ts` — completion-only
- `frontend/src/utils/creatureRarity.ts` — completion-only

### Testing Standards

- Vitest + `@testing-library/react`
- `happy-dom` environment (configured in `vite.config.ts`)
- Mock R3F `useFrame` / `useThree`; mock drei `<Html>` / `<Billboard>` as simple wrappers
- `renderHook` for hook-only tests
- **No useFrame-driven phase tests this story** — that scaffolding is still deferred (see `deferred-work.md`, 2026-04-17 entry). Keep coverage focused on: store actions, mutation wiring, console.warn contract, override-renders-ghost-pad, double-click guard.
- Run `npx vitest run` and `npx tsc -b` — both clean — before handing off to code-review.

### Open Questions (developer judgment during implementation)

1. **Exact flash color.** UX spec says "bright neon red, full bloom" but the established neon palette (`--neon-pink #ff10f0`, `--neon-cyan`, `--neon-orange`, `--neon-green`, `--neon-gold`) doesn't define a red. Recommended default: `#ff1744` (material design neon red — saturated enough for Bloom pickup, sits unambiguously in the "red" category, distinct from pink/orange). If the UX team wants a different red, it's a 1-line change in `DELETE_FLASH_COLOR`. Do not add a CSS token for this story — that's scope creep; the hex is used in exactly one place.
2. **Total sequence duration.** 1.6s matches completion. If it feels sluggish when dry-running in the browser, shorten Settle (1.20 → 1.40 total instead of 1.60). Do not drop below ~1.0s total or the flash+dissolve beats lose their rhythm.
3. **Hook naming.** The architecture doc prescribes `usePopupDelete.ts` as the file name. The exported symbol is `useDeleteTodoAction` (to avoid colliding with `useDeleteTodo` from `todoApi.ts`). If you disagree, propose an alternative in the PR description; do not silently rename.
4. **Where to stamp `startedAt`.** Use Option (a) from 2.4: stamp inside `LilyPad`'s `useFrame` on the first frame of the `deleting` phase from `state.clock.elapsedTime`. Store-side stamping risks wall-clock-vs-scene-clock drift. Mirror 2.4 exactly.
5. **Sound on delete.** Out of scope (Epic 8). Leave no hook; do not import audio libs.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md#Story 2.5` (lines 350–371)] — AC source and removal intent
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md` § "5. Deleting a Todo (The Red Flash)"] — phase timing table (Trigger/Flash/Dissolve/Settle) confirming no Emerge phase
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md` § "Effortless Interactions"] — "click the pad, the Action Popup materializes, click Delete. The pad flashes red and dissolves into the water."
- [Source: `_bmad-output/planning-artifacts/architecture.md` lines 294, 529–530, 728] — REST soft-delete endpoint, `usePopupDelete.ts` file placement, `useDeleteTodo` hook placement
- [Source: `_bmad-output/planning-artifacts/architecture.md` lines 235–236] — `todos.deleted` + `deleted_at` schema fields
- [Source: `_bmad-output/implementation-artifacts/2-4-completion-via-popup-green-flash-and-dissolve.md`] — canonical pattern source for every mechanic this story mirrors
- [Source: `_bmad-output/implementation-artifacts/2-3-in-scene-action-popup.md`] — Action Popup is HTML overlay with DOM buttons; `onDelete` is a standard `onClick`
- [Source: `frontend/src/api/todoApi.ts`] — add `useDeleteTodo` alongside existing hooks
- [Source: `frontend/src/stores/usePondStore.ts`] — `completingTodos` + `selectCompleting` + `CompletingEntry` are the template for their deletion equivalents
- [Source: `frontend/src/hooks/usePopupComplete.ts`] — template for `usePopupDelete` (mirror fire-and-forget + `onError` + sync-throw guard)
- [Source: `frontend/src/components/pond/LilyPad.tsx`] — existing phase state machine; add `'deleting'` + `'deleted'` in parallel to `'completing'` + `'completed'`
- [Source: `frontend/src/components/pond/PondScene.tsx`] — `onDelete` stub at line 106; `renderTodos` union at lines 41–49
- [Source: `backend/src/api/todos.py:47-56`] — `DELETE /api/todos/{todo_id}` route (no changes)
- [Source: `backend/src/services/todo_service.py:36-71`] — `list_todos` (deleted filter), `delete_todo` (soft-delete)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context)

### Debug Log References

- `npx vitest run` — 59/59 tests passing across 14 files (9 new: `usePopupDelete.test.ts` × 4, `usePondStore.test.ts` deletion + selectDeleting blocks × 7 actually 8, `PondScene.test.tsx` ghost-delete × 1 — rolls up to 50 pre-existing + 9 new = 59 reported)
- `npx tsc -b` — clean

### Completion Notes List

- **Backend untouched.** `DELETE /api/todos/{id}` and the `deleted=False` list filter were already in place from story 2.1; the deletion path reuses them without modification.
- **`useDeleteTodo` hook (Task 1):** added alongside `useCreateTodo`/`useUpdateTodo` in `api/todoApi.ts`, same `onSuccess` invalidation of `['todos', 'list']`.
- **`usePopupDelete` hook (Task 2):** exports `useDeleteTodoAction()` returning `(id) => void`. Fires `deleteTodo.mutate` with both the `onError` option (for React Query's async routing) and an outer `try/catch` (for rare sync throws). Mirrors `usePopupComplete` pattern exactly.
- **Store extension (Task 3):** `usePondStore` now has `deletingTodos: Map<string, DeletingEntry>` + `startDeletion(todo)` / `finishDeletion(id)` actions + `selectDeleting(id)` selector. `startDeletion` is idempotent (returns early if id already present) so double-dispatch can't replace the snapshot mid-sequence.
- **PondScene wiring (Task 4):** `ActionPopup.onDelete` now calls `deleteTodo(popupTodo.id)` → `startDeletion(popupTodo)` → `closePopup()`. The `renderTodos` `useMemo` was extended to union live todos with BOTH `completingTodos` and `deletingTodos` overrides, dedup-by-id.
- **LilyPad phase (Task 5):** Added `'deleting'` + `'deleted'` phases to the state machine. Transition fires on the first frame `deleting` entry is present and the pad is in `resting`. `deletingStartTimeRef` (drives `useFrame` work) + `deletingStartTime` state mirror (drives JSX label gate) — same split 2.4 converged on. Timeline: Flash 0–0.30s (shader uColor → `#ff1744`), Ripple fires once at 0.40s, Dissolve 0.40–1.20s (group scale + material opacity → 0), Settle 1.20–1.60s (no render). At 1.60s `finishDeletion` releases the override and the pad unmounts on next render.
- **Shared dissolve helpers:** extracted `fadePadMaterials(group, opacity)` and `restorePadMaterials(group)` at module scope so the completing and deleting branches share the single dissolve/restore implementation. Both the completion external-cancel recovery and the dissolve traversal are now one-liners.
- **Double-click guard extended:** `handlePadClick` now short-circuits if the todo id is in EITHER `completingTodos` OR `deletingTodos`. `<Html>` label gate also checks both override maps plus both `*StartTime` state mirrors so the one-frame-label-flash-over-scale-0-pad hole is closed for deletion too.
- **External-cancel recovery:** parallel branch added for deletion — restores opacity/scale via `restorePadMaterials` if the `deletingTodos` override is cleared while the pad is still mid-sequence (not the happy-path terminal transition).
- **Stale scaffold note:** The epic's tech-note directive to "remove `DeleteAphid.tsx`" was stale — no such file existed anywhere in the repo (verified via grep before starting). No removal action taken; called out in the story Dev Notes.
- **Scope discipline:** no `<EmergingCreature>` on delete; no confirmation dialog; no aphid/eating-bar/lizard-drift re-introduction; no casino bonuses; no backend changes; no new npm packages; sequence is fire-and-forget so AC #7 holds without error-path UI (that's Story 2.6).

### Change Log

| Date | Change |
|------|--------|
| 2026-04-17 | Implemented Story 2.5: Delete button in the Action Popup now fires the full red-flash → dissolve → settle sequence. Added `useDeleteTodo` REST hook, `useDeleteTodoAction` popup hook, `deletingTodos` override map + `startDeletion`/`finishDeletion`/`selectDeleting` on the store, and the `'deleting'`/`'deleted'` phases in LilyPad's state machine. Refactored shared dissolve traversal into `fadePadMaterials` / `restorePadMaterials` helpers. 59/59 tests passing; tsc -b clean. |

### File List

**New:**
- `frontend/src/hooks/usePopupDelete.ts`
- `frontend/src/hooks/usePopupDelete.test.ts`

**Modified:**
- `frontend/src/api/todoApi.ts` — added `useDeleteTodo` mutation hook
- `frontend/src/stores/usePondStore.ts` — `DeletingEntry`, `deletingTodos` Map, `startDeletion` / `finishDeletion`, exported `selectDeleting`
- `frontend/src/stores/usePondStore.test.ts` — beforeEach reset extended; `startDeletion/finishDeletion` and `selectDeleting` describe blocks added
- `frontend/src/components/pond/PondScene.tsx` — wired `useDeleteTodoAction`; subscribed to `deletingTodos`; extended `renderTodos` union; added `handleDelete`
- `frontend/src/components/pond/PondScene.test.tsx` — mocked `usePopupDelete`; extended store reset; added ghost-deleting-todo override test
- `frontend/src/components/pond/LilyPad.tsx` — `'deleting'`/`'deleted'` phases, `deletingStartTime` ref + state mirror, flash/dissolve/settle timeline, extended double-click guard, extended `<Html>` label gate, shared `fadePadMaterials` / `restorePadMaterials` helpers (refactored completing branch to reuse)
- `frontend/src/components/pond/LilyPad.test.tsx` — extended selector-aware store mock with `deletingTodosMock`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 2.5 moved backlog → in-progress → review
- `_bmad-output/implementation-artifacts/2-5-deletion-via-popup-red-flash-and-dissolve.md` — task checkboxes, Dev Agent Record, status

**Deleted:** none

### Review Findings

_Code review run: 2026-04-17 (Blind Hunter + Edge Case Hunter + Acceptance Auditor, opus-4-7)_

- [x] [Review][Patch] **[High] Double DELETE network call despite idempotent store guard** [frontend/src/components/pond/PondScene.tsx handleDelete] — Handler fires `deleteTodo(popupTodo.id)` **before** `startDeletion(popupTodo)`; the store's idempotency only protects the visual override, not the network call. If two click events dispatch synchronously against the same popup (rapid double-click, touchstart+click pairing, re-entrant event) before `closePopup()` unmounts the ActionPopup, two DELETE requests fire. Unlike 2.4's duplicate POST /creatures (which failed on the DB `UniqueConstraint("todo_id")`), a duplicate DELETE can 404 silently. Fix: guard the handler with `if (state.deletingTodos.has(popupTodo.id)) return;` before calling `deleteTodo(...)`, OR move `closePopup()` ahead so the button unmounts synchronously (blind).

- [x] [Review][Patch] **[High] Terminal `'deleted'` phase re-entry on component remount fires second ripple + flash** [frontend/src/components/pond/LilyPad.tsx `'deleting'` transition + `deletingStartTimeRef`] — If `<LilyPad>` unmounts mid-sequence (parent remount, hot-reload, route change, key churn) while `deletingTodos[id]` is still present, the next mount starts in `phaseRef='resting'`, `deleting` is still truthy, so the transition re-fires and `deletingStartTimeRef` is re-stamped to the *current* R3F clock — sequence replays from zero, second red flash, second `triggerRipple` call. `startDeletion` is idempotent but `LilyPad` has no guard against "already-in-progress-elsewhere". Fix: stamp `startedAt` in the store entry (inside `startDeletion` OR via a new `stampDeletionStart(id, t)` action called on first active frame) and read it back in LilyPad rather than re-stamping per-instance. Same hazard exists on the 2.4 completion path — fixing both at once is cleaner (edge).

- [x] [Review][Patch] **[Medium] `DeletingEntry.startedAt` is dead data that silently stays at 0 forever** [frontend/src/stores/usePondStore.ts startDeletion] — The interface field is commented "R3F clock, stamped by LilyPad on first active frame" but nothing writes back to the store — LilyPad only updates its local `deletingStartTimeRef`. Any future consumer reading `entry.startedAt` gets garbage. Directly tied to the High finding above — stamping the store-side value also fixes this. The 2.4 `CompletingEntry` inherits the identical hazard (blind).

- [x] [Review][Patch] **[Medium] `restorePadMaterials` leaves `material.transparent = true` after external-cancel recovery** [frontend/src/components/pond/LilyPad.tsx restorePadMaterials] — `fadePadMaterials` flips `m.transparent = true` on every walked material; `restorePadMaterials` only resets `opacity`. `lineBasicMaterial` (the bright neon rim line) ends up permanently `transparent=true`, disabling depth-buffer writes and causing z-fighting / sort flicker on rare external-cancel paths. AC #9 ("pad restores to `resting` with full opacity/scale") is not bit-identically satisfied. Fix: in `restorePadMaterials`, also restore `m.transparent` to its original value (track per-material or standardize by material type — rim `MeshBasicMaterial` stays true, others false) (blind+edge+auditor).

- [x] [Review][Patch] **[Medium] Cross-map override leak — completingTodos + deletingTodos entry for same id never cleans up** [frontend/src/components/pond/LilyPad.tsx `'completed'`/`'deleted'` terminal transitions] — If external code (dev tools, follow-up feature, injected test state) populates both `completingTodos[id]` and `deletingTodos[id]` concurrently, `LilyPad` enters `'completing'` first, reaches terminal `'completed'`, and the phase-early-return prevents the `!deleting && phase === 'deleting'` branch from ever running. `finishDeletion(id)` is never called and `deletingTodos` keeps the stale entry forever — `renderTodos` keeps re-rendering a ghost pad. `handlePadClick`'s guard prevents it in practice; defense in depth still wanted. Fix: on terminal transition, call BOTH `finishCompletion(id)` and `finishDeletion(id)` unconditionally (each is idempotent — no-op if not present) (edge+blind).

- [x] [Review][Patch] **[Medium] Task 6 marks "double-click guard" test complete, but no such test exists in `LilyPad.test.tsx`** [frontend/src/components/pond/LilyPad.test.tsx] — Task 6 subtask claims coverage of "double-click guard" and the checkbox is `[x]`, but the diff to `LilyPad.test.tsx` only extends the selector-aware store mock with `deletingTodosMock` — no `it(...)` block asserts that `handlePadClick` short-circuits when `deletingTodosMock.has(id)` is true. Dishonest checkbox. Fix: add a test that seeds `deletingTodosMock` with the todo id and asserts `openPopupMock` is NOT called when the pad is clicked (auditor).

- [x] [Review][Patch] **[Low] Deleting phase-transition check placed AFTER completing, violates spec ordering** [frontend/src/components/pond/LilyPad.tsx useFrame transition blocks] — Story spec Task 5 explicitly says "insert **before** the `completing` transition check (so deleting takes precedence over completing)". Code has `completing`-transition → `completing`-cancel → `deleting`-transition → `deleting`-cancel. No observable bug today (both gated by `handlePadClick`), but spec-code drift is load-bearing for future stories that inject state. Fix: move both `deleting` blocks above the matching `completing` blocks (blind+auditor).

- [x] [Review][Patch] **[Low] `useDeleteTodo` types the response as `Todo` — silent type lie if backend ever returns 204** [frontend/src/api/todoApi.ts useDeleteTodo] — `apiClient.delete<Todo>(...)` asserts a `TodoResponse` body. If a future backend change switches to the canonical 204 No Content DELETE pattern, `data` is `undefined` but typed `Todo`. Consumer currently ignores the return, so no runtime bug, but the contract is wrong. Fix: either `apiClient.delete<void>` (and drop the return), or validate shape before returning (blind).

- [x] [Review][Patch] **[Low] `usePopupDelete.test.ts` "returns void" test passes vacuously** [frontend/src/hooks/usePopupDelete.test.ts] — After `deleteMutate.mockReset()`, the mock returns `undefined` by default. The hook also returns `undefined`. The assertion `expect(ret).toBeUndefined()` is satisfied by any function that doesn't return. Test doesn't lock down the contract. Fix: either remove the test, or replace with a stronger assertion (e.g., "mutate is called synchronously before the callback returns") (blind).

- [x] [Review][Patch] **[Low] LilyPad.test.tsx `getState()` mock missing action methods — latent bomb for future un-mocks** [frontend/src/components/pond/LilyPad.test.tsx] — The mock exposes `openPopup`, `completingTodos`, `deletingTodos` only. Missing: `triggerRipple`, `startDeletion`, `finishDeletion`, `finishCompletion`. Tests work today because `useFrame` is mocked to no-op — the moment someone un-mocks `useFrame` for a phase-progression test (Task 6's deferred scaffolding in `deferred-work.md`), the suite explodes with cryptic "not a function" errors. Fix: add `vi.fn()` stubs for all actions the component touches via `usePondStore.getState()`, or at minimum a comment flagging the assumption (blind).

- [x] [Review][Patch] **[Low] `selectDeleting` exported but unused — LilyPad inlines the subscription** [frontend/src/components/pond/LilyPad.tsx L230, frontend/src/stores/usePondStore.ts selectDeleting] — Spec Task 5 prescribes using `selectDeleting(todo.id)` or matching whatever `completing` uses. Author went inline. `selectCompleting` is also unused (same drift inherited from 2.4). Fix: use `selectDeleting(todo.id)` and `selectCompleting(todo.id)` consistently in LilyPad, or remove the unused exports (edge+auditor).

- [x] [Review][Defer] Tab backgrounded / computer sleep mid-sequence collapses 1.6s animation to instant jump on resume [frontend/src/components/pond/LilyPad.tsx deleting branch] — deferred, inherited from 2.4. Already tracked in `deferred-work.md` for completion; deletion path has identical issue, same fix (edge).

- [x] [Review][Defer] Clicking Delete on a pad still in `forming`/`dropping`/`settling`/`pulsing` silently delays sequence up to ~2.1s [frontend/src/components/pond/LilyPad.tsx `deleting && phaseRef.current === 'resting'` guard] — deferred, inherited from 2.4. Same UX polish tradeoff as the completion delay (edge).

- [x] [Review][Defer] `uDropCenter` ripple collision — two rapid pad actions overwrite the water shader's single ripple uniform [frontend/src/components/pond/WaterSurface.tsx] — deferred, pre-existing limitation from story 1.2. Story 2.5 aggravates frequency but does not introduce the single-slot limit (edge).

- [x] [Review][Defer] Camera focus mid-lerp cut-off when Delete dispatches before the focus-zoom completes [frontend/src/components/pond/PondCamera.tsx + PondScene closePopup] — deferred, pre-existing. Spec explicitly dropped camera-restore in 2.3/2.4/2.5; intermediate-lerp abort is the known cost (edge).
