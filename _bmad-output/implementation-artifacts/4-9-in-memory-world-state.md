# Story 4.9: In-Memory World State

Status: ready-for-dev

> **Supersedes Story 4.3 (Position Persistence).** Created 2026-04-24 from user direction ("Can we simplify all the state management especially around position and refs?"). The original 4.3 model — "drag → 2 s debounce → PATCH" — was partly delivered by Story 4.8 (batch-position endpoint) and is being replaced wholesale here with an in-memory-canonical world-metadata store + periodic save + exit flush.
>
> **Scope:** Move world-metadata (position, rotation, drift seed, transient velocity) out of the `Todo` prop + LilyPad refs and into a single Zustand-backed in-memory store keyed by todo id. The store is hydrated on mount from the existing `GET /api/todos` response, mutated directly by drag / spread / nudge / drift, and flushed to the backend via `PATCH /api/todos/positions` every 5 minutes (configurable) + on tab exit. LilyPad stops owning ~15 refs around position/velocity and reads everything through selectors.
>
> **Why now:** Story 3.4 CR surfaced a recurring class of bug caused by the reactive "drag-triggers-save" model + LilyPad's per-instance refs — stale ref reads during render, sticky-position leaks, drag-follow races, popup-position drift during the refetch window. Story 4-5 (Strict Compliance Sweep) is also in backlog explicitly because of this. A single in-memory store solves the architecture problem; 4-5 becomes a 10-line follow-up instead of a sweep.
>
> **What ships:**
> 1. **`useWorldStore`** — new Zustand store (or new slice of `usePondStore`) with a `worldMetadata: Map<todoId, WorldEntry>` field, setters for position / rotation / velocity mutations that stamp `lastUpdatedLocalMs`, and selectors that return stable references for R3F `useFrame` readers.
> 2. **Hydration** — on `useTodos` success, fill the store from the response. Subsequent refetches merge into the store using the "clean → overwrite, dirty → keep" rule.
> 3. **Periodic save timer** — a long-lived `setInterval` (or thread-safe equivalent) that, every `PERIODIC_SAVE_INTERVAL_MS`, collects dirty entries and fires one `PATCH /api/todos/positions`.
> 4. **Exit save** — `beforeunload` + `visibilitychange=hidden` listeners that flush dirty entries via `navigator.sendBeacon` (or `fetch` with `keepalive: true`).
> 5. **LilyPad refactor** — delete ~15 refs; read position / rotation / velocity from the store; write updates through store setters.
> 6. **Cap** — `MAX_LOADED_TODOS` constant (default 500). If the server returns more, log a dev-console warning and load the first N; overflow is deferred to a future story.
>
> **Not in scope (defer):**
> - Persisting velocity / direction to the backend (stays in-memory only — the drift animation is deterministic from `driftSeed` + clock; velocity in the store is for nudge / cascade dynamics, not a schema field).
> - Paging / virtualising pads when `MAX_LOADED_TODOS` is exceeded. Log a warning, load the cap, proceed. Fix when real users hit it.
> - Multi-tab reconciliation. Each tab's in-memory store is independent; on reload any tab re-hydrates from the most recent server state. Realtime sync across tabs is not a goal.
> - CRDT / offline editing. The app is online-first; a failed network at exit means some dirty entries don't reach the server (acceptable — worst case: their latest drag isn't saved).
> - Story 4-5 follow-up (Strict Compliance Sweep) is NOT absorbed here — this story reduces its surface area; 4-5 closes whatever's left.

---

## Frontend conventions (recap)

- **Store pattern**: Zustand with identity-preserving setters (no-op on unchanged value). Follow the existing `usePondStore` pattern — `setActiveDragAnchor`, `setCursorMode`, `setHoveredTodoId` all short-circuit when the new value equals the old. Do NOT use Redux / Jotai / other stores.
- **Selector subscriptions**: components subscribe with narrow selectors like `usePondStore((s) => s.worldMetadata.get(todo.id))` so re-renders stay scoped.
- **R3F reads in `useFrame`**: to avoid re-rendering the 3D scene on every position mutation, LilyPad's `useFrame` body reads `useWorldStore.getState()` imperatively — mutation events flow one-way (LilyPad writes, store holds, `useFrame` reads).
- **Batch PATCH endpoint**: `PATCH /api/todos/positions` already exists from Story 4.8 — `[{ id, position_x, position_y, rotation_y? }, ...]`. Extend if needed to accept `rotation_y` (verify whether 4.8 included it — if not, this story adds it; 1-line schema extension).
- **Testing**: Vitest. For the periodic-save timer, use `vi.useFakeTimers()`; for `beforeunload`, dispatch the event via `window.dispatchEvent`. Mock `navigator.sendBeacon` on globalThis.

---

## Story

**As a user of the pond,**
I want the pond's dynamics to feel fluid — no jittering when pads drift, no 2-second delay between dropping a pad and trusting the save — and I want my arrangement to persist when I close the tab,
so that the pond feels like a living space I'm rearranging directly, not a form I'm submitting.

**As the developer maintaining this codebase,**
I want a single canonical place to read and write per-pad world-metadata so I can stop chasing ref-sync bugs between LilyPad, PondScene, and the store,
so that future animation / physics work is composable instead of rediscovering the same invariants each time.

---

## Acceptance Criteria

### Upfront hydration

1. **Given** the app mounts and the backend returns N todos via `GET /api/todos`, **When** `N <= MAX_LOADED_TODOS` (default 500), **Then** all N entries populate the world-metadata store with `positionX`, `positionY`, `rotationY`, `driftSeed` from the response and `velocityX = 0`, `velocityZ = 0`, `lastUpdatedLocalMs = 0`, `lastSavedAtMs = performance.now()` (mount-time hydration counts as "just saved from the server's POV").

2. **Given** the backend returns `N > MAX_LOADED_TODOS`, **Then** the first `MAX_LOADED_TODOS` entries (by DB default order — `created_at` ascending) hydrate normally, overflow is skipped, and a `console.warn` fires with the count skipped. The cap is a single constant in the store module, not an env var for this story.

3. **Given** the app already hydrated once and `useTodos` refetches (e.g., after a text-edit mutation or a soft-delete), **Then** for each todo in the response: if the store entry for that id is **clean** (`lastUpdatedLocalMs <= lastSavedAtMs`), the incoming `positionX/Y`, `rotationY`, `driftSeed` overwrite the store; if the entry is **dirty**, ONLY non-positional fields update (store's in-memory position wins until it's flushed).

4. **Given** a todo is present in the backend response but absent from the store (created by another tab, or dropped from the cap and then made room by a deletion), **Then** a fresh store entry is created as in AC #1.

5. **Given** a todo is absent from the backend response but present in the store (soft-deleted, or missed from a partial refetch), **Then** the store entry is removed. Dirty state on a removed entry is discarded silently.

### In-memory as canonical during the session

6. **Given** a LilyPad mesh needs to render, **When** it reads its pond position, **Then** it reads from the world-metadata store via a selector — NOT from the `todo` prop's `positionX / positionY` and NOT from a local ref. The `todo` prop provides `id` and the identity/text/completion state; world-metadata provides spatial state.

7. **Given** the user drags a pad, **When** the pointer moves during the drag, **Then** the world-metadata entry's `positionX / positionY` updates directly on every frame and `lastUpdatedLocalMs = performance.now()`. No `PATCH` is fired during the drag.

8. **Given** a cascade nudge moves a sibling pad, **When** the nudge commits (crosses the `DISPLACED_PUBLISH_THRESHOLD`), **Then** the sibling's store entry updates in-place; no per-sibling `PATCH` is fired. The nudge uses `velocityX / velocityZ` from the store if useful for momentum dynamics (future-work hook — may be zero-valued for this story).

9. **Given** the spread-out command resolves overlaps, **When** each target position is committed, **Then** the store is the single write target — no `PATCH` per arrival. Animation still runs per-pad (staggered).

10. **Given** any of the above mutations, **Then** the entry's `lastUpdatedLocalMs > lastSavedAtMs` after the mutation. The entry is considered **dirty** by any selector / iterator that asks.

### Periodic save

11. **Given** the app has mounted, **Then** a recurring job (implemented via `setInterval` or an idle-resilient equivalent) runs every `PERIODIC_SAVE_INTERVAL_MS` (default 5 minutes, i.e. 300000) that collects every dirty entry and fires one `PATCH /api/todos/positions` with `[{ id, position_x, position_y, rotation_y }, ...]`.

12. **Given** the periodic-save `PATCH` resolves successfully, **Then** for each returned todo, its store entry's `lastSavedAtMs` is set to the dispatch time (captured BEFORE the await). Entries that were mutated during the in-flight window (their `lastUpdatedLocalMs > dispatch time`) remain dirty and will re-flush on the next cycle.

13. **Given** the dirty set is empty at a save tick, **Then** no `PATCH` is fired that cycle.

14. **Given** a save is in flight and the next save tick fires, **Then** the next tick is skipped (no overlapping saves). The skipped tick's work is deferred to the cycle after the current one resolves.

15. **Given** the periodic save `PATCH` fails (network, 5xx), **Then** dirty entries stay dirty (no rollback), no modal error surfaces (background save is silent), the error is logged via `console.error('[world-state] periodic save failed', err)`, and the next cycle retries. React-Query retry budget is NOT used here — this is a plain `fetch`.

### Exit save

16. **Given** the tab is about to close, **When** `beforeunload` fires, **Then** all dirty entries are flushed to `PATCH /api/todos/positions` via `navigator.sendBeacon(url, JSON.stringify(payload))`. `sendBeacon` is best-effort — the response is not awaited; the function just returns a boolean indicating the payload was accepted into the beacon queue.

17. **Given** the tab goes into the background without closing, **When** `visibilitychange` fires with `document.visibilityState === 'hidden'`, **Then** the same flush runs (iOS/Safari closes tabs from the background without always firing `beforeunload`; covering `visibilitychange` hits both cases).

18. **Given** `navigator.sendBeacon` returns `false` (payload too large — unlikely at 500 pads × ~50 bytes = 25 kB, but possible), **Then** fall back to `fetch(url, { method: 'PATCH', body, keepalive: true })`. Neither path blocks the unload.

19. **Given** the exit flush has run, **Then** the `lastSavedAtMs` is NOT bumped locally (we can't await the response on unload; the next mount will re-hydrate from whatever the server actually persisted).

### LilyPad refactor (regression check)

20. **Given** LilyPad previously declared per-instance refs for spatial state, **When** this story lands, **Then** the following refs are DELETED or REPLACED with store selectors:
    - `targetY` — stays (it's vertical animation state, not world-metadata)
    - `raycastSucceededRef` — stays (transient per-drag)
    - `stickyDragRef` + `stickySetAtMsRef` — DELETE (store is always canonical; no need for "sticky" window)
    - `dragPosRef` — REPLACE with store writes during drag
    - `siblingNudgeRef` + `lastNudgeTargetRef` — REPLACE with store writes
    - `siblingRotationRef` — REPLACE with `store.worldMetadata.get(id).rotationY`
    - `hadDragAnchorRef` — DELETE (drag end path becomes simpler without sticky)
    - `pointerOverRef` — stays (pointer-state, not world-metadata)
    - `isDraggingRef` — stays (drag-in-progress flag, not world-metadata)
    - `focusFlashPendingRef`, `phaseTimer`, `completingRippleFired`, `deletingRippleFired`, `rideElevRef`, `prevFocusedRef`, `dropNotified`, `restStartTime`, `wasSelectedRef`, `searchSaturationRef` — stay (non-positional)

21. **Given** the refactor is complete, **Then** running the app under React `<StrictMode>` produces no `react-hooks/refs` warnings originating from `LilyPad.tsx`. (Warnings from other files are out of scope — Story 4-5 handles those.)

22. **Given** existing tests, **Then** no regression across: drift animation (ambient sine-wave bob), drag + release + cascade nudge, spread-out command, completion dissolve, deletion dissolve, focus/Escape cycle, popup positioning (story 3-4), selection drag (story 4-7 once it lands).

### Failure modes + edge cases

23. **Given** a `POST /api/todos` creates a new todo, **When** the optimistic / refetch flow adds it to the store, **Then** the new entry's `lastSavedAtMs = performance.now()` (it matches server state immediately) and `lastUpdatedLocalMs = 0` (clean until the user moves it).

24. **Given** the user's clock skews backwards (NTP correction, manual change), **When** a mutation's `lastUpdatedLocalMs` is less than its own `lastSavedAtMs` from a moment earlier, **Then** the entry's dirty check uses `performance.now()` (monotonic, unaffected by wall-clock changes), NOT `Date.now()`. All local timestamps in this store are `performance.now()` values.

25. **Given** a tab is reloaded mid-drag (rare — browsers may show confirm dialog if a drag is in progress), **Then** the in-flight drag's in-memory positions flush via the exit path (AC #16/17); the next mount hydrates whatever arrived.

### Tests

26. **Given** I run `npx vitest run` after this story, **Then** all existing tests plus new tests pass. New tests cover:
    - (a) Hydration: 3 todos → store has 3 entries with expected fields.
    - (b) Cap: 501 todos in response → 500 loaded, 1 skipped, `console.warn` called.
    - (c) Clean-merge: refetch with new position on a clean entry → store entry updates.
    - (d) Dirty-protect: mutation sets dirty; refetch with different position on dirty entry → non-positional fields update, position stays in-memory.
    - (e) Dirty set: mutate 3 entries → `getDirtyEntries()` returns exactly those 3.
    - (f) Periodic dispatch: `vi.useFakeTimers()`, mutate 2 entries, advance 5 minutes, assert `PATCH /api/todos/positions` called once with 2-entry payload.
    - (g) In-flight mutation: start a save, mutate one entry during flight, resolve save, assert the in-flight-mutated entry stays dirty.
    - (h) Exit save: dispatch `beforeunload`, assert `navigator.sendBeacon` called with the JSON payload of dirty entries.
    - (i) Visibilitychange hidden: dispatch event, assert same flush fires.
    - (j) `sendBeacon` returns false → fallback `fetch` with `keepalive: true` is called.
    - (k) Periodic save failure: mock `fetch` to reject, assert entries stay dirty, `console.error` called, no retry stall.

---

## Tasks / Subtasks

- [ ] **Task 1: World-metadata store** (AC: #1–#5, #10, #24)
  - [ ] Create `frontend/src/stores/useWorldStore.ts` (or extend `usePondStore` with a `world` slice — discuss with user if unclear; `useWorldStore` keeps the new concern isolated and is the recommended default).
  - [ ] Shape: `worldMetadata: Map<string, WorldEntry>`, where `WorldEntry = { positionX: number; positionY: number; rotationY: number; driftSeed: number; velocityX: number; velocityZ: number; lastUpdatedLocalMs: number; lastSavedAtMs: number; }`.
  - [ ] Setters:
    - `hydrateFromTodos(todos: Todo[]): void` — bulk set; apply MAX_LOADED_TODOS cap + warn.
    - `mergeRefetch(todos: Todo[]): void` — clean entries overwrite; dirty entries keep in-memory position + only update non-positional fields.
    - `setPosition(id: string, x: number, z: number): void` — atomic position write + timestamp stamp.
    - `setRotation(id: string, rotY: number): void`
    - `setVelocity(id: string, vx: number, vz: number): void`
    - `applySaveCommit(ids: string[], savedAtMs: number): void` — bulk-set `lastSavedAtMs` after a successful PATCH.
    - `removeEntry(id: string): void` — for soft-deletes falling out of the refetch.
  - [ ] Selectors: `useWorldEntry(id)`, `useWorldPosition(id)`, plus imperative `useWorldStore.getState().worldMetadata.get(id)` for `useFrame` consumers.
  - [ ] Constants exported from the store module: `MAX_LOADED_TODOS = 500`, `PERIODIC_SAVE_INTERVAL_MS = 300_000`.
  - [ ] Unit tests (`useWorldStore.test.ts`) covering setters + dirty detection + merge policy.

- [ ] **Task 2: Hydration + refetch merge wiring** (AC: #1–#5)
  - [ ] Find the current `useTodos` consumer mount point (likely `PondScene.tsx`). Add a `useEffect` that calls `useWorldStore.getState().hydrateFromTodos(todos)` on first non-empty response and `mergeRefetch(todos)` on subsequent responses (use a ref to track "has hydrated" so the logic doesn't replay).
  - [ ] Verify: after an `updateTodo.mutate({ text: ... })` success, the refetched todo's position in-memory is unchanged (the entry is clean and its position matched server's anyway, but verify the clean-branch runs).

- [ ] **Task 3: Periodic save + error handling** (AC: #11–#15, #23)
  - [ ] Create `frontend/src/hooks/usePeriodicWorldSave.ts` — a hook mounted once in `App.tsx` (or `PondScene.tsx`) that sets up the `setInterval` and tears it down on unmount.
  - [ ] Dispatch logic: on tick, snapshot dirty entry ids + capture `dispatchMs = performance.now()`; build payload; call `PATCH /api/todos/positions`; on success, call `applySaveCommit(ids, dispatchMs)`; on failure, `console.error` + no state change.
  - [ ] In-flight guard: module-level `inFlight` boolean (or ref in the hook) that short-circuits subsequent ticks until the current one settles.
  - [ ] Unit tests using `vi.useFakeTimers()`.

- [ ] **Task 4: Exit save (beforeunload + visibilitychange)** (AC: #16–#19)
  - [ ] Add listeners in the same `usePeriodicWorldSave` hook or a sibling `useExitWorldSave` hook. Remove on unmount.
  - [ ] Prefer `navigator.sendBeacon(url, new Blob([JSON.stringify(payload)], { type: 'application/json' }))`. FastAPI accepts beacon JSON the same as regular JSON given the correct Content-Type (via Blob type).
  - [ ] Fallback: `fetch(url, { method: 'PATCH', body, keepalive: true, headers: { 'Content-Type': 'application/json' } })`.
  - [ ] Do NOT bump `lastSavedAtMs` on the exit path (AC #19).
  - [ ] Tests: jsdom supports dispatching `beforeunload` + `visibilitychange`; mock `navigator.sendBeacon`.

- [ ] **Task 5: LilyPad refactor** (AC: #6–#10, #20–#22)
  - [ ] Replace `todo.positionX / todo.positionY` reads with `useWorldStore.getState().worldMetadata.get(todo.id)?.positionX/Y`. Use `useWorldEntry(todo.id)` for the React re-render path (popup position, etc.) and imperative `getState()` for `useFrame`.
  - [ ] Delete refs listed in AC #20 as "DELETE" / "REPLACE". Migrate their write paths to store setters.
  - [ ] Replace the `siblingRotationRef` pattern with store reads/writes. Rotation commits during drift go through `setRotation`.
  - [ ] Confirm drag-release no longer fires `PATCH` directly — the drag just writes to the store and lets the periodic/exit save pick it up. (If a user wants immediate feedback, leave a `flushNow()` escape hatch on the store that the existing drag-release path can call — up to the dev to judge during implementation.)
  - [ ] Run the app under `<StrictMode>` (update `main.tsx` if not already) and verify no `react-hooks/refs` warnings from LilyPad.

- [ ] **Task 6: `rotationY` in the batch PATCH payload** (AC: #11 — if not already supported by 4.8)
  - [ ] Check `backend/src/api/todos.py` + `backend/src/schemas/todo.py`: does the `PATCH /api/todos/positions` request schema accept `rotation_y`?
  - [ ] If not: add it as an optional field per entry. Update the service layer to apply it when present. Add a backend test. This is a 1-file-per-layer change.

- [ ] **Task 7: PondScene smoke + integration test** (AC: #22)
  - [ ] Update `PondScene.test.tsx` to assert the store is hydrated after mount.
  - [ ] Add a test that mutates a position via store setter, advances fake timers by `PERIODIC_SAVE_INTERVAL_MS`, and asserts `fetch` was called with the batch payload.

- [ ] **Task 8: Quality gates**
  - [ ] `npx tsc --noEmit -p tsconfig.app.json` — clean.
  - [ ] `npx vitest run` — green.
  - [ ] Backend: `ruff check` / `ruff format --check` / `mypy` — clean. `pytest` green.
  - [ ] Manually verify in browser: drag a few pads, wait 5 min (or shorten `PERIODIC_SAVE_INTERVAL_MS` for the test), confirm a `PATCH` fires. Close the tab with unsaved drags, reopen, confirm positions persisted.

---

## Dev Notes

### Why Zustand and not React Query / Context / Redux

The app already uses Zustand for `usePondStore` (hover, cursor mode, drag anchor, displaced pads, search state, color preview, etc.). A world-metadata store in the same shape keeps the pattern consistent. React Query is the server-cache layer — it's NOT the right home for write-through-optimistic spatial state because RQ's cache is keyed by query and its optimistic-update model fights with the "in-memory is canonical" rule we want.

You MAY implement the world store as a new slice on `usePondStore` (co-located) OR as a dedicated `useWorldStore` (isolated). The spec recommends **dedicated `useWorldStore`**: the concern is different (spatial state vs UI state), the mutation volume is much higher (every drag frame), and an isolated store keeps `useFrame` consumers from subscribing to unrelated changes.

### `performance.now()` vs `Date.now()`

All local timestamps (`lastUpdatedLocalMs`, `lastSavedAtMs`, `dispatchMs` in the save path) MUST be `performance.now()` — it's monotonic and immune to NTP corrections / manual clock changes. `Date.now()` is fine for display (e.g., "modified 2 minutes ago") but NOT for dirty-tracking arithmetic.

### Merge policy during refetch

When a refetch lands, for each incoming todo:

```
if (store entry is clean) {
  // Server's position is fresh; trust it.
  store.setPosition(id, incoming.positionX, incoming.positionY);
  store.setRotation(id, incoming.rotationY);
  // Bump lastSavedAtMs to now — clean entry matches server state.
  store.applySaveCommit([id], performance.now());
} else {
  // In-memory has unsaved moves; don't stomp.
  // Still update non-positional fields on the Todo prop (text, completed, etc.)
  // via React Query's cache — the store doesn't hold those.
}
```

The "non-positional fields update" in AC #3 is actually automatic: React Query owns the Todo records, and LilyPad reads `todo.text / todo.completed / ...` from props. The world store only holds spatial fields. So "merge" is really just "decide whether to accept the incoming spatial fields".

### `useFrame` reads the store imperatively

`useFrame(() => { const entry = useWorldStore.getState().worldMetadata.get(todo.id); ... })` — do NOT use the React-subscription selector inside `useFrame`, or every state change re-subscribes. Use `.getState()` for all 60-FPS reads; use selectors only for React-render paths (popup positioning, for instance).

### Rotation in the batch PATCH

Verify whether Story 4.8's `PATCH /api/todos/positions` already accepts `rotation_y`. If yes, great. If not, Task 6 is a trivial backend extension. Do NOT roll back 4.8's behaviour — just extend.

### Open questions (flag for user or resolve during impl)

1. **Should `PERIODIC_SAVE_INTERVAL_MS` be user-configurable (settings UI)?** Default answer for this story: no — single hardcoded constant. Revisit if a user requests it.
2. **Should the dragger still fire an immediate `flushNow()` on drag release, so other tabs see the result sooner?** Default for this story: no — the 5-min cadence + exit flush is sufficient. Adding `flushNow()` is a one-liner if the user asks later.
3. **What happens when `MAX_LOADED_TODOS` is exceeded?** This story: warn + truncate. The pond visually shows the first 500 pads in DB order. A follow-up story could add "load more" or visibility-window culling.
4. **Does the `visibilitychange` flush also fire when the user switches to another tab for 10 seconds and comes back?** Yes (AC #17) — it fires on every hidden transition. The cost is ~one extra beacon send per tab-switch. Acceptable.
5. **Multi-tab: tab A drags a pad to position X; tab B is open and still shows the old position.** Each tab's store is independent; tab B's refetch (triggered by any other mutation or on next mount) will pick up X via the clean-merge path. We do NOT broadcast positions between tabs. If this becomes a real pain point, add a `BroadcastChannel` in a follow-up.

### Consequences for other stories

- **Story 4-5 (Strict Compliance Sweep)** — becomes much smaller after this lands. The primary ref-mutation-during-render offenders (PondScene's `hasSeenInitialLoadRef`, LilyPad's position refs) are either replaced or untouched. Run 4-5 after 4-9 to sweep whatever's left.
- **Story 4-7 (Selection Drag and Repel)** — its drag + repel paths should write to the world store directly. Planning 4-7 after 4-9 will make it much cleaner.
- **Story 2-11 (Ripple System v2) / 2-12 (Pad Phase Guard)** — unaffected. Neither touches the position-persistence model.

### Completion test plan

- **Unit**: `useWorldStore.test.ts`, `usePeriodicWorldSave.test.ts`, extended `LilyPad.test.tsx` for the new read paths.
- **Integration**: `PondScene.test.tsx` hydration + periodic dispatch smoke test.
- **Manual**: 5-minute browser session with at least 3 drags, 1 spread-out command, 1 pad completion. Observe the 5-min PATCH fires. Close the tab; reopen; positions persist.

---

## Dev Agent Record

### Agent Model Used

_To be filled by the dev agent._

### Implementation Notes

_To be filled by the dev agent._

### Debug Log

_To be filled by the dev agent._

### Completion Checklist

- [ ] `useWorldStore` (or `usePondStore.world`) with `hydrateFromTodos`, `mergeRefetch`, `setPosition`, `setRotation`, `setVelocity`, `applySaveCommit`, `removeEntry` + unit tests
- [ ] Hydration wired at the `useTodos` success path; clean-merge / dirty-protect logic active on refetch
- [ ] `usePeriodicWorldSave` hook with `setInterval` dispatch, in-flight guard, error handling, + unit tests
- [ ] `beforeunload` + `visibilitychange=hidden` exit flush via `sendBeacon` with `fetch(keepalive)` fallback + unit tests
- [ ] LilyPad refactored: refs listed in AC #20 deleted / replaced; position reads through store selectors; `useFrame` reads via `.getState()`
- [ ] `rotation_y` accepted in `PATCH /api/todos/positions` payload (verify / add)
- [ ] `MAX_LOADED_TODOS = 500` cap honoured with dev-console warning on overflow
- [ ] No `react-hooks/refs` warnings from `LilyPad.tsx` under `<StrictMode>`
- [ ] `npx tsc --noEmit -p tsconfig.app.json` clean
- [ ] `npx vitest run` green (with ~11 new tests per AC #26)
- [ ] Backend `ruff` / `mypy` / `pytest` clean
- [ ] Manually verified in browser: drag → 5 min wait → observe PATCH; close tab with dirty → reopen → positions persist

### File List

_To be filled by the dev agent. Expected additions: `frontend/src/stores/useWorldStore.ts` + test, `frontend/src/hooks/usePeriodicWorldSave.ts` + test. Expected modifications: `frontend/src/components/pond/LilyPad.tsx` (delete ~7 refs, rewire reads), `frontend/src/components/pond/PondScene.tsx` (hydration wiring), `frontend/src/App.tsx` (mount periodic-save hook), possibly `backend/src/schemas/todo.py` + `backend/src/api/todos.py` (rotation in batch PATCH)._

### Change Log

_To be filled by the dev agent._
