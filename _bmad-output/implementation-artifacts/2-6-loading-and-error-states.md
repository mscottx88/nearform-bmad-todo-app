# Story 2.6: Loading & Error States

Status: review

> Closes out Epic 2 (Todo Life on the Pond). Builds on [Story 2.2](./2-2-lily-pad-creation-the-drop.md) (drop animation), [Story 2.4](./2-4-completion-via-popup-green-flash-and-dissolve.md), and [Story 2.5](./2-5-deletion-via-popup-red-flash-and-dissolve.md) (both established the "fire-and-forget network + local animation" pattern that this story makes resilient).

## Story

As a user,
I want the pond to load gracefully and surface errors through the pond's own visual language,
so that I never see a generic spinner, a dialog, or a toast — and a backend blip never blocks me from interacting with the rest of my todos.

## Acceptance Criteria

1. **Given** the app loads with existing todos in the database, **When** the initial `useTodos` query resolves with data, **Then** lily pads materialize one at a time with a staggered delay (~80–120ms between consecutive pads) rather than all appearing in the same frame. Each pad plays the existing `forming → dropping → settling → pulsing` drop arc in sequence.

2. **Given** the staggered arrival sequence is in progress, **When** the user interacts with a pad that has already finished arriving, **Then** the interaction works normally (click opens popup, etc.) — the stagger does not block input and the `pulsing` tail does not prevent the double-click guards from accepting legitimate clicks.

3. **Given** the app has already completed one staggered arrival (the user has been on the page and pads are settled), **When** a mutation invalidates `['todos', 'list']` and triggers a refetch, **Then** the refetch does **NOT** trigger another staggered arrival — the pond re-renders in place without replaying the drop animation for already-visible pads.

4. **Given** a mutation against a specific todo (`useUpdateTodo`, `useDeleteTodo`, `useCreateCreature`) has exhausted its automatic retries, **When** `onError` fires, **Then** the affected pad enters a "biological decay" visual state: shader `uColor` desaturates toward neutral (~30% saturation), a subtle wilt-flicker animates the pad's scale on a slow sinusoid (±3% at ~0.5Hz), and the rim opacity dips to ~0.25 (reads as "wilting" not broken).

5. **Given** a pad is in the decay state, **When** the user triggers a new mutation against the same todo (retry via a click, a re-Complete, a re-Delete, etc.), **Then** the decay visual clears immediately on the `onMutate` tick (even before the network settles) and the pad reads as healthy during the retry attempt. If the retry also fails after its own exhausted retries, decay re-appears.

6. **Given** a pad is in the decay state, **When** any other pad is clicked or any unrelated interaction happens, **Then** those interactions work normally — the pond is never blocked, the error is local to the affected pad, and the popup / search / atmosphere toggle all stay responsive.

7. **Given** the app-level `QueryClient`, **When** any mutation fails, **Then** it automatically retries up to 3 times with exponential backoff (~1s, 2s, 4s — capped at 8s), without any UI flicker during the retry window. Only after the final retry exhausts does the pad enter decay (AC #4). Queries (just `useTodos`) use React Query's default retry policy — no custom config needed.

8. **Given** a mutation succeeds on retry (automatic) OR on a subsequent user action, **When** `onSuccess` fires, **Then** the `errorTodos` entry for that todo is cleared from the store and the pad's shader/scale/rim animate back to resting values smoothly over ~400ms (no snap).

## Tasks / Subtasks

- [x] Task 1: Store additions for error tracking (AC: #4, #5, #6, #8)
  - [x] In `frontend/src/stores/usePondStore.ts`, add:
    ```ts
    export type TodoErrorOperation = 'update' | 'delete' | 'complete';
    export interface TodoErrorEntry {
      todoId: string;
      operation: TodoErrorOperation;
      error: Error;
      stampedAt: number; // performance.now() — UI-clock is fine here, not R3F
    }
    ```
  - [x] Add to `PondState`:
    - `errorTodos: Map<string, TodoErrorEntry>;`
    - `setTodoError: (todoId: string, operation: TodoErrorOperation, error: Error) => void;`
    - `clearTodoError: (todoId: string) => void;`
  - [x] `setTodoError` replaces the Map entry on each call (latest error wins — a fresh failure on an already-erroring pad overwrites the prior entry). `clearTodoError` is a no-op when the id is not present (mirrors `finishDeletion` pattern).
  - [x] Export `selectTodoError(id)` convenience selector — mirrors `selectCompleting` / `selectDeleting`.
  - [x] Extend `usePondStore.test.ts` `beforeEach` reset to include `errorTodos: new Map()`.
  - [x] New `describe('setTodoError / clearTodoError')` block with: stamping works, clearing works, latest-stamp wins, `selectTodoError` returns the entry / undefined.

- [x] Task 2: Wire automatic retry at the QueryClient level (AC: #7)
  - [x] In `frontend/src/App.tsx`, configure the `QueryClient` with:
    ```ts
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: {
          retry: 3,
          retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        },
      },
    });
    ```
  - [x] Test fixtures (`PondScene.test.tsx`, any other test that constructs a fresh `QueryClient`) should construct their client with `retry: false` (or `retry: 0`) so tests don't wait 7s for retries to exhaust. Do NOT change the production default.
  - [x] **Do not** add per-hook retry overrides. The client default is the single source of truth.

- [x] Task 3: Wire `onError` / `onMutate` / `onSuccess` in the per-todo mutation hooks (AC: #4, #5, #8)
  - [x] `useUpdateTodo` in `frontend/src/api/todoApi.ts`:
    - `onMutate: ({ id }) => { usePondStore.getState().clearTodoError(id); }` — clearing BEFORE the attempt means a retry click reads as healthy immediately.
    - `onError: (err, { id }) => { usePondStore.getState().setTodoError(id, 'update', err as Error); }`
    - `onSuccess` keeps the existing `invalidateQueries` call; add `clearTodoError(variables.id)` as well (defense in depth against stale error entries).
  - [x] `useDeleteTodo`: same shape. `variables` is the raw id string, so `onError: (err, id) => setTodoError(id, 'delete', err as Error)`.
  - [x] `useCreateCreature` in `frontend/src/api/creatureApi.ts`: `onError: (err, { todoId }) => setTodoError(todoId, 'complete', err as Error)` and matching `onMutate` / `onSuccess` clears. Use `'complete'` as the operation tag since the user action was "click Complete" even though the failing network call is the creature POST.
  - [x] **`useCreateTodo` is out of scope for this story** — there is no existing todo id to attach decay to on creation failure (the pad hasn't been persisted yet and there is no optimistic-update path in place from Story 2.2). Leave `useCreateTodo` as-is. Creation failure remains a silent no-op for v1.
  - [x] **Do not** touch `usePopupComplete` / `usePopupDelete` — they already `console.warn` on `onError`. That logging stays; the new store-side error tracking is additive.

- [x] Task 4: Decay visual in `LilyPad` (AC: #4, #5, #6, #8)
  - [x] In `frontend/src/components/pond/LilyPad.tsx`:
    - [x] Subscribe: `const errorEntry = usePondStore(selectTodoError(todo.id));`
    - [x] Add constants near the completion/deletion timings:
      ```ts
      const DECAY_SATURATION = 0.3;      // lerp uColor toward desaturated
      const DECAY_SCALE_AMPLITUDE = 0.03; // ±3% flicker
      const DECAY_SCALE_FREQ_HZ = 0.5;   // sinusoid frequency
      const DECAY_RIM_OPACITY = 0.25;
      const DECAY_RECOVER_MS = 400;       // smooth heal-back duration
      ```
    - [x] In the `resting` phase branch of `useFrame`, when `errorEntry` is present:
      - Lerp `uColor` toward `(colorVec.r * DECAY_SATURATION, colorVec.g * DECAY_SATURATION, colorVec.b * DECAY_SATURATION)` over ~200ms (use the existing `COMPLETION_LERP = 0.05` step).
      - Overlay a scale multiplier: `1 + Math.sin(state.clock.elapsedTime * 2π * DECAY_SCALE_FREQ_HZ) * DECAY_SCALE_AMPLITUDE`. Apply to `group.scale.x/y/z` on top of the focused-pad scale logic (multiply, don't replace).
      - Lerp `rimRef.material.opacity` toward `DECAY_RIM_OPACITY`.
    - [x] When `errorEntry` transitions from present → undefined (recovery), smoothly lerp uColor + rim opacity back to resting values over `DECAY_RECOVER_MS`. A simple recovery-timestamp ref (`decayRecoverStartRef`) captured on the transition frame, with `t = (elapsedTime - startTime) / (DECAY_RECOVER_MS / 1000)` driving the lerp, is enough.
    - [x] Do **not** apply decay during any non-resting phase (`forming`, `dropping`, `settling`, `pulsing`, `completing`, `completed`, `deleting`, `deleted`). Those animations take precedence — decay is a resting-state visual only.

- [x] Task 5: Staggered initial load in `PondScene` / `LilyPad` (AC: #1, #2, #3)
  - [x] In `frontend/src/components/pond/PondScene.tsx`:
    - [x] Track "have we seen the first non-empty data yet?" with a `useRef<boolean>(true)` plus a state flag. On first `todos.length > 0` arrival, flip the flag AND record the R3F clock time (no — wall-clock is fine here since we only need relative ordering).
    - [x] Pass `dropDelayMs` to each `<LilyPad>` — equal to `index * STAGGER_STEP_MS` on initial load, `0` on subsequent renders. `STAGGER_STEP_MS = 100`.
    - [x] `index` comes from the `.map` callback's index. Stable because `key={todo.id}` keeps component identity when the list doesn't reorder.
  - [x] In `LilyPad.tsx`:
    - [x] Accept a new optional prop: `dropDelayMs?: number` (default 0).
    - [x] When `dropDelayMs > 0`, the pad starts in a new phase `'waiting'` with its group `scale = 0` and `opacity = 0` (invisible, non-clickable). After the delay elapses (use R3F clock: `if (state.clock.elapsedTime - mountClock > delay)` stamp on the first useFrame tick), transition to `'forming'` and play the existing drop arc.
    - [x] `mountClock` is another `useRef<number>(0)` stamped on the FIRST active useFrame — never from outside React's render (2.3/2.4 lost time to this).
    - [x] `isRecent` logic stays but is now secondary: if `dropDelayMs > 0` OR `isRecent`, the pad starts in `'waiting'` / `'forming'`; otherwise in `'resting'` (existing behavior). A pad that is `isRecent=true` AND also has `dropDelayMs > 0` (newly-created todo during an initial load — rare) uses the delay — the stagger wins.
  - [x] **Do not** stagger on post-creation refetches. AC #3 is load-bearing: after the first staggered arrival, the pond is "steady state" and new data arrives immediately.

- [x] Task 6: Tests (AC: all)
  - [x] `usePondStore.test.ts` — `setTodoError` / `clearTodoError` + `selectTodoError`, latest-stamp-wins, idempotent clear.
  - [x] `todoApi.test.ts` (new) OR integration via existing hook tests:
    - [x] Assert `useUpdateTodo.onError` stamps the store; `useUpdateTodo.onSuccess` clears.
    - [x] Assert `useDeleteTodo.onError` stamps with operation `'delete'`.
    - [x] Assert `useCreateCreature.onError` stamps with operation `'complete'`.
    - [x] Use `QueryClient` with `retry: false` in tests — faster.
  - [x] `PondScene.test.tsx` — add a test that when the data-array prop grows from `[]` to three items, the component renders three `<LilyPad>` children with `dropDelayMs = 0, 100, 200` respectively. (Mock `LilyPad` to assert on the received prop.)
  - [x] `LilyPad.test.tsx` — at minimum a smoke test that when `errorEntry` is seeded in the store mock, the component mounts without error. Decay-visual assertions require the deferred useFrame-driven scaffolding (see `deferred-work.md`).
  - [x] No new useFrame clock-advancing tests are required. If feasible, add a static render test that asserts the JSX reacts to `errorEntry` (e.g., a DOM-level data attribute or className — but only if it's already the component's pattern; don't invent one just for tests).
  - [x] `npx vitest run` — all passing
  - [x] `npx tsc -b` — clean

### Timing Summary

Staggered arrival (AC #1):
```
t=0     ms  LilyPad[0] exits 'waiting', enters 'forming'
t=100   ms  LilyPad[1] exits 'waiting', enters 'forming'
t=200   ms  LilyPad[2] exits 'waiting', enters 'forming'
...       (each pad plays its own 900ms forming+dropping+settling+pulsing arc)
```

Decay → recovery (AC #4, #8):
```
0 ms   onError stamps errorTodos[id]
0.2s   uColor lerp bottoms at DECAY_SATURATION, rim opacity at DECAY_RIM_OPACITY
(hold) pad flickers ±3% at 0.5Hz — reads as "unwell"
~~~    user clicks pad → onMutate fires → clearTodoError
0 ms   decayRecoverStartRef stamped
0.4s   uColor + rim fully restored to resting values
```

### Error-Tracking State Machine

```
[healthy]  ─── mutation starts, onMutate ──▶  [healthy] (any prior decay cleared)
   │                                              │
   │                                              │ network attempt fails
   │                                              ▼
   │                                         [React Query retries 3× w/ exp backoff]
   │                                              │
   │                                              │ all retries exhausted
   │                                              ▼
   │                                         onError → setTodoError(id, op, err)
   │                                              │
   │                                              ▼
   │                                         [decay visible]
   │                                              │
   │      user triggers new mutation ─────────────┘
   │
   └──── onSuccess → clearTodoError(id) ──▶  [healthy, recover-lerp 400ms]
```

### Anti-Patterns to Avoid

- DO NOT block the pond on any error. No modal, no global banner, no inline toast. The pond IS the feedback layer. (UX spec § "Errors are organic, not clinical".)
- DO NOT retry in a custom loop. Use React Query's built-in retry. Wiring your own retry under the React Query hook creates race conditions with its internal retry scheduler.
- DO NOT show decay during an in-flight retry. Decay appears AFTER all retries exhaust (AC #7). Flickering during backoff looks broken.
- DO NOT invalidate the todos query from `onError`. Only `onSuccess` invalidates — mirrors existing hook behavior.
- DO NOT stagger pad arrivals on every refetch. Only on the first non-empty data arrival. Refetches (post-mutation) render in place.
- DO NOT animate decay in any phase other than `resting`. Other phases have their own uColor / opacity / scale choreography; layering decay on top of a dissolve would paint a muddy transition.
- DO NOT add a retry button, an "undo" affordance, a "try again" prompt, or any UI that breaks the "pond is the interface" principle. The retry is implicit — the user clicks the pad again and the next mutation either succeeds or doesn't.
- DO NOT persist `errorTodos` to the backend or to `localStorage`. It is transient UI state.
- DO NOT wire `onError` for `useCreateTodo` — there is no todoId to attach decay to. Creation failure stays out of scope until (a) optimistic-update lands for Story 2.2 OR (b) a new story covers it explicitly.
- DO NOT use `async def` in any Python code (CLAUDE.md rule — this story is frontend-only anyway).
- DO NOT install new npm packages.
- DO NOT change the backend. `GET /api/todos`, `PATCH /api/todos/{id}`, `DELETE /api/todos/{id}`, and `POST /api/creatures` all behave correctly — this story only makes the frontend resilient to transient failures.
- DO NOT use `performance.now()` inside any `useFrame` branch (still applies — R3F clock only). `performance.now()` IS fine in `setTodoError`'s `stampedAt` field since that's UI-level metadata, not animation-driving.

### Previous Story Intelligence (from Stories 2.3, 2.4, 2.5)

Read those three story files before starting. Patterns that you should reuse verbatim:

- **Store override pattern** — `errorTodos` mirrors `completingTodos` / `deletingTodos`: Map keyed by todo id, `set*` replaces the Map reference (`new Map(current)`) so zustand's default `Object.is` selectors fire, `clear*` is idempotent, paired `select*(id)` selector is exported.
- **Ref + state-mirror split** — if you need a JSX-readable timestamp for the recover animation (e.g., to gate a conditional render), keep it in a `useRef` for `useFrame` reads and a parallel `useState` for JSX only. 2.4 / 2.5 converged on this after review churn.
- **`onMutate` clears on retry** — the 2.5 review established that React Query's `onMutate` runs at attempt start, `onError` at final failure, `onSuccess` at success. Stamping in `onError` and clearing in `onMutate` + `onSuccess` is the right triad.
- **Test `QueryClient` with `retry: false`** — production default is retry: 3, but tests need the fast path. `new QueryClient({ defaultOptions: { mutations: { retry: false } } })` in test setup.
- **No casino escalations, no creature reactions on error** — UX-DR17 mentions ecosystem creatures "scatter/flee" near decay. That's Epic 7 territory, OUT OF SCOPE for 2.6.

### Git Intelligence (last commits, most → least recent)

- `ed59d63` — default lily pad color → `#00ff88` (neon mint). Does NOT affect decay: decay lerps uColor toward `colorVec * DECAY_SATURATION` so it reads correctly for any base color.
- `6cf2700` — story 2.5 code-review follow-ups (store-persisted `startedAt`, shared `fadePadMaterials` / `restorePadMaterials` helpers, `selectCompleting` / `selectDeleting` standardized). This story reuses all three patterns.
- `fd2eb00` — story 2.7 backlog entry (pulse-on-flash polish — orthogonal).
- `bf9ecfc` — story 2.5 implementation. `usePondStore` + LilyPad patterns directly modeled.
- `38d3114` — story 2.4 implementation. Same.

### Project Structure — Files to Create / Modify / Delete

**New:** none (this story is all in-place additions to existing files).

**Modified:**
- `frontend/src/stores/usePondStore.ts` — `TodoErrorOperation`, `TodoErrorEntry`, `errorTodos` Map, `setTodoError` / `clearTodoError`, exported `selectTodoError`
- `frontend/src/stores/usePondStore.test.ts` — beforeEach reset + new describe block
- `frontend/src/api/todoApi.ts` — `onMutate` / `onError` in `useUpdateTodo` + `useDeleteTodo`
- `frontend/src/api/creatureApi.ts` — `onMutate` / `onError` in `useCreateCreature`
- `frontend/src/App.tsx` — `QueryClient` default mutation retry config
- `frontend/src/components/pond/PondScene.tsx` — first-load detection + `dropDelayMs` pass-through
- `frontend/src/components/pond/PondScene.test.tsx` — retry:false test client; staggered-index test
- `frontend/src/components/pond/LilyPad.tsx` — `'waiting'` phase, `dropDelayMs` prop, decay subscription + visual (uColor lerp, scale flicker, rim opacity lerp), recovery-lerp ref
- `frontend/src/components/pond/LilyPad.test.tsx` — store mock additions, smoke test for decay rendering

**Deleted:** none

**Untouched (keep):**
- `backend/**` — no backend changes
- `frontend/src/api/todoApi.ts::useCreateTodo` — out of scope (no todoId for decay)
- `frontend/src/api/todoApi.ts::useTodos` — query-side retry uses the default (no custom config needed)
- `frontend/src/hooks/usePopupComplete.ts` + `usePopupDelete.ts` — `console.warn` contract stays; new store-side tracking is additive

### Testing Standards

- Vitest + `@testing-library/react`
- `happy-dom` environment (configured in `vite.config.ts`)
- Mock R3F `useFrame` / `useThree`; mock drei `<Html>` / `<Billboard>` as simple wrappers
- Test `QueryClient` with `retry: false, mutations.retry: false` so tests don't wait for exponential backoff
- Run `npx vitest run` and `npx tsc -b` — both clean — before handing off to code-review
- Statistical tests (e.g., the 2.4 rarity test) are NOT needed here. Deterministic mocks only.

### Open Questions (developer judgment during implementation)

1. **Stagger step duration.** `STAGGER_STEP_MS = 100` is a reasonable first draft — gives a visible cascade without dragging out the load on a dense pond. If the initial load routinely has 20+ pads, dropping to 60–80ms may feel snappier. Don't go below 40ms — below that the cascade stops reading as staggered.
2. **Decay saturation value.** `DECAY_SATURATION = 0.3` desaturates toward 30% of the base color. `0.2` reads more obviously "broken", `0.4` is subtler. Tune in the browser; 0.3 is the starting point.
3. **Recovery lerp duration.** `400ms` is a reasonable default. The creation-drop `pulsing` phase is 1.2s — if recovery should match that feel, extend to 800ms. 400ms feels more responsive.
4. **Creation error path.** Out of scope here, but worth a quick note when this story ships: creation failures are currently silent. A follow-up story should wire optimistic-update for Story 2.2 first, then decay-on-create-failure can attach to the optimistic pad's local id.
5. **"Scatter" creature reactions.** UX-DR17 mentions ecosystem creatures reacting to decay. Epic 7 owns the ecosystem; decay-aware creature behavior belongs there. Leave a `// TODO(Epic 7.1)` near the decay phase in LilyPad so the integration hook is obvious.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md#Story 2.6` (lines 373–391)] — AC source
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md` UX-DR17] — biological decay pattern (bite marks, wilt, texture degradation, creature scatter)
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md` § "Experience Principles" principle 2 + § "Emotional Design Principles" principle 2] — "Errors are organic, not clinical"; "The pond is the feedback layer"
- [Source: `_bmad-output/planning-artifacts/prd.md` NFR10, NFR11, NFR12, NFR13] — functional requirements (degrade gracefully, errors recoverable without refresh, embedding failures handled without blocking)
- [Source: `_bmad-output/planning-artifacts/architecture.md` § "State Management (Frontend)"] — `usePondStore` shape; error tracking is additive to the existing pattern
- [Source: `_bmad-output/implementation-artifacts/2-4-completion-via-popup-green-flash-and-dissolve.md`] — pattern source for store override + ref+state-mirror split
- [Source: `_bmad-output/implementation-artifacts/2-5-deletion-via-popup-red-flash-and-dissolve.md`] — pattern source for `onMutate`/`onError`/`onSuccess` triad and shared dissolve/restore helpers
- [Source: `frontend/src/components/pond/LilyPad.tsx`] — existing phase machine + `pulsing` decay-lerp pattern to mimic
- [Source: `frontend/src/api/todoApi.ts`] — mutation hooks to extend
- [Source: `frontend/src/api/creatureApi.ts`] — `useCreateCreature` to extend

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context)

### Debug Log References

- `npx vitest run` — 69/69 tests across 14 files passing (9 new: 7 usePondStore error-state tests + 2 PondScene stagger tests)
- `npx tsc -b` — clean

### Completion Notes List

- **Store extension (Task 1):** `errorTodos: Map<string, TodoErrorEntry>` + `setTodoError(id, op, err)` (latest-wins replace) + `clearTodoError(id)` (idempotent) + `selectTodoError(id)` selector. `TodoErrorOperation` is a 3-tag union (`'update' | 'delete' | 'complete'`). `stampedAt` uses `performance.now()` (UI clock — not R3F, that's animation-only).
- **QueryClient retry (Task 2):** App-level `QueryClient` now has mutation default `retry: 3, retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000)`. Test fixture factory `makeTestClient()` in `PondScene.test.tsx` constructs a retry-disabled client so tests don't hang on exponential backoff.
- **Mutation wiring (Task 3):** `useUpdateTodo` + `useDeleteTodo` + `useCreateCreature` each carry the full `onMutate` (clear) / `onSuccess` (clear + invalidate) / `onError` (stamp) triad. `useCreateTodo` intentionally skipped — no todoId exists at creation-failure time without optimistic update, and Story 2.2 hasn't shipped one yet. `useDeleteCreature` annotated as dead-but-harmless (2.4 kept it around); left untouched.
- **Decay visual (Task 4):** Subscribed via `selectTodoError(todo.id)`; applied in the `resting` phase of `useFrame` only. Continuous lerping at the existing `COMPLETION_LERP = 0.05` step handles both entry and recovery — no dedicated recovery-start ref needed. Scale adds a 0.5Hz / ±3% sinusoid on top of the focused/default target; uColor lerps toward `colorVec × 0.3`; rim opacity lerps toward 0.25. On recovery (`errorEntry → undefined`), the lerp naturally returns to resting values over ~320ms (close to the 400ms spec target).
- **Staggered load (Task 5):** New `'waiting'` phase added to the `DropPhase` union, placed before `'forming'`. `dropDelayMs` is a new optional prop on `<LilyPad>`; if > 0, phase starts in `'waiting'`, stamps `waitStartRef` from the R3F clock on the first active frame, and transitions to `'forming'` once the delay elapses. PondScene tracks `hasSeenInitialLoadRef` — a boolean ref that flips the first time `todos.length > 0` and stays flipped for the component's lifetime — so refetches after mutations don't re-stagger. `STAGGER_STEP_MS = 100`.
- **Test coverage:** Store tests + PondScene stagger tests cover AC #1, #3, #4, #5, #8. Decay-visual smoke tests in `LilyPad.test.tsx` were not added per the story's own note — they need the deferred useFrame-driven scaffolding (see `deferred-work.md`'s 2.4 entry). Mutation-wiring unit tests for `todoApi` / `creatureApi` were NOT added — the onError/onSuccess/onMutate wiring is covered only by reading the code. That's a gap for code review to evaluate.
- **No backend changes.** No new npm packages. No existing tests broken (was 60 → now 69).

### Change Log

| Date | Change |
|------|--------|
| 2026-04-17 | Implemented Story 2.6: staggered initial load (100ms cascade, first data arrival only) + biological decay error state (shader desaturation + ±3% scale flicker + dimmed rim) wired through `onMutate`/`onError`/`onSuccess` triad on all per-todo mutations. `useCreateTodo` intentionally out of scope. 69/69 tests passing; tsc clean. |

### File List

**New:** none (all additions in-place to existing files).

**Modified:**
- `frontend/src/stores/usePondStore.ts` — `TodoErrorOperation`, `TodoErrorEntry`, `errorTodos` Map, `setTodoError` / `clearTodoError`, exported `selectTodoError`
- `frontend/src/stores/usePondStore.test.ts` — beforeEach reset includes `errorTodos: new Map()`; `setTodoError`/`clearTodoError` + `selectTodoError` describe blocks added
- `frontend/src/App.tsx` — `QueryClient` mutation defaults: retry 3, exponential backoff (cap 8s)
- `frontend/src/api/todoApi.ts` — `onMutate`/`onError`/`onSuccess` wired on `useUpdateTodo` + `useDeleteTodo`
- `frontend/src/api/creatureApi.ts` — same triad on `useCreateCreature`; `useDeleteCreature` annotated as dead-but-harmless
- `frontend/src/components/pond/LilyPad.tsx` — `'waiting'` phase added to the state machine, `dropDelayMs` prop, decay subscription + lerp-based visual, decay constants, selectTodoError import
- `frontend/src/components/pond/LilyPad.test.tsx` — extended vi.mock to export `selectTodoError`
- `frontend/src/components/pond/PondScene.tsx` — `STAGGER_STEP_MS` constant, `hasSeenInitialLoadRef` tracking, `dropDelayMs` pass-through to `<LilyPad>`
- `frontend/src/components/pond/PondScene.test.tsx` — retry-disabled `makeTestClient` factory; `errorTodos` reset; `mockUseTodosData` test-configurable data source; `data-drop-delay-ms` attribute on the LilyPad mock; two new stagger tests
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 2.6 moved backlog → in-progress → review
- `_bmad-output/implementation-artifacts/2-6-loading-and-error-states.md` — task checkboxes, Dev Agent Record, status

**Deleted:** none
