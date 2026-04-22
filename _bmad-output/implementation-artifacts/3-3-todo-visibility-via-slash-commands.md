# Story 3.3: Todo Visibility via Slash Commands

Status: review

> **Scope note — net-new scope, not in epics.md/PRD/UX.** The PRD (FR2, FR8, FR14, FR38) explicitly says completed and deleted todos are **retained in the DB but excluded from the default pond view and search**. This story introduces an opt-in user-facing toggle to view completed and/or deleted pads, driven by a **slash-command interface** embedded in the existing [TodoInput](frontend/src/components/ui/TodoInput.tsx). It does NOT weaken the default: a fresh session still shows active-only. The feature is an exploratory / demo affordance ("look what was here before"), not a change to the PRD's primary interaction model.
>
> **What ships:**
> 1. New backend query param on `GET /api/todos` — flags `include_active`, `include_completed`, `include_deleted` (all default to the pre-existing behaviour: active=true, others=false). Preserves the current endpoint contract for every caller that hasn't opted in.
> 2. Three new Zustand slices (`showActive`, `showCompleted`, `showDeleted`) + one action `setVisibility` in [usePondStore](frontend/src/stores/usePondStore.ts).
> 3. [useTodos](frontend/src/api/todoApi.ts) re-keys by the visibility triple and sends the matching query params — each unique combination is its own React Query cache entry, no stale-bleed between modes.
> 4. **Generic slash-command framework** — a module-scope `slashCommandRegistry` in [frontend/src/utils/slashCommands.ts](frontend/src/utils/slashCommands.ts) that holds `SlashCommand` registrations. Each command is a self-contained object with `{ token, description, isConsumable, project, execute }`. Parser + dropdown iterate the registry without knowing command specifics. Future stories add `/delete-all`, `/find`, `/archive-completed`, etc. by registering new commands in their own file and pushing into the same registry — no parser changes required. See Dev Notes § "Adding a new slash command".
> 5. **Six concrete visibility commands** shipped in this story via the framework above: `/show-active`, `/hide-active`, `/show-completed`, `/hide-completed`, `/show-deleted`, `/hide-deleted`. Plus two convenience shorthands: `/show-all`, `/hide-all`. These are ONLY the commands in 3.3's scope — the framework is built to hold more.
> 6. TodoInput gains dual-mode behaviour: any input that starts with `/` AND whose every space-separated token is a consumable registered command dispatches those commands' `execute()` calls on Enter; otherwise Enter still creates a todo (existing path).
> 7. A context-aware autocomplete dropdown under TodoInput lists the commands that are **consumable** against the current (and, in chained input, the accumulated virtual) world state — `/show-completed` vanishes from the list the moment it's been applied, replaced by `/hide-completed`. Includes keyboard arrow-key navigation + Enter-to-select (Claude-Code-style).
> 8. A visual treatment for non-active pads in [LilyPad](frontend/src/components/pond/LilyPad.tsx): completed → desaturated + 0.45 opacity + faint green rim; deleted → desaturated + 0.35 opacity + faint red rim. Non-active pads are **non-interactive** (no popup open on click — they're historical view only).
> 9. A **global `/` shortcut** that opens TodoInput pre-filled with `/`, so the slash-command flow is one keypress (`/`) instead of two (`Enter`, then `/`). The existing Enter shortcut in [useKeyboardShortcuts](frontend/src/hooks/useKeyboardShortcuts.ts) is extended to also handle `/` with the same guards (no focused input, no open popup, no active search). On a qualifying `/` keystroke, TodoInput opens with `value = '/'` and the autocomplete dropdown renders at full opacity (as if the user had just typed `/`). Story 5.3's search handler gets a one-line carve-out so an inactive search no longer claims the `/` keystroke.
>10. Test coverage for parser + registry, store actions, React Query cache-key derivation, autocomplete dropdown filtering, the visual-treatment branching, and the global `/` shortcut.
>
> **Do NOT rewrite the existing TodoInput, useTodos, or LilyPad render** — amend them. The todo-create path, search, camera, popup, and all Epic-2/Epic-3 flows must stay green.
>
> **Dirty-seed / null-position handling is out of scope.** Product decision 2026-04-22: assume every `todos` row has valid `positionX` / `positionY`. If the demo DB contains legacy rows with null positions from pre-4.3 workflows, **truncate the `todos` table** before testing — no backwards-compatibility code, no null-position fallback rendering in this story. [LilyPad](frontend/src/components/pond/LilyPad.tsx) already crashes or renders-at-origin for null positions today; 3.3 does not make that worse and does not fix it. Story 4.3 (position persistence, still backlog) is the natural home for a robust null-position policy if one is ever needed.
>
> **Persistence** is **in-memory only** — the flags live in Zustand and reset on reload. LocalStorage persistence is deferred (see Dev Notes § "Why no localStorage").

## Frontend conventions (recap)

- **State**: UI toggles and imperative signals live in [`usePondStore`](frontend/src/stores/usePondStore.ts) (Zustand). Pattern for read-only booleans (e.g. `searchActive`, `atmosphereMode`) is established — use the same shape for `showActive` / `showCompleted` / `showDeleted`. Actions are named `setX` / `toggleX`; this story uses a single `setVisibility(patch)` action that accepts a partial patch and does NOT touch unrelated keys (mirrors Zustand's own `set` semantics).
- **Query cache**: [`useTodos`](frontend/src/api/todoApi.ts#L15-L23) currently uses `const TODOS_KEY = ['todos', 'list'] as const`. Extend to `['todos', 'list', { active, completed, deleted }]` so each visibility combination has its own cache entry. All existing callers of `TODOS_KEY` that invalidate (see `useCreateTodo`, `useUpdateTodo`, `useDeleteTodo`) must be updated to invalidate the `['todos', 'list']` prefix so every cached mode refetches on mutation — React Query supports this via `queryClient.invalidateQueries({ queryKey: ['todos', 'list'] })` (partial prefix match).
- **Cache key for double-Escape reset**: [useCameraResetOnDoubleEscape](frontend/src/hooks/useCameraResetOnDoubleEscape.ts) reads todos via `queryClient.getQueryData<Todo[]>(['todos', 'list'])` to compute the fit. Under the new keying, that EXACT key no longer exists. Update the hook to read the *current* visibility triple's cache entry — or simpler, read from `queryClient.getQueriesData({ queryKey: ['todos', 'list'] })` and merge. **Must not break Story 3.1's ESC-ESC flow.**
- **Input UX**: TodoInput is the single text-entry affordance — there is NO separate search `<input>` (Story 5.3 is overlay-only, no DOM input). The new slash-command mode extends TodoInput; do NOT add a second input or a modal. Autocomplete dropdown renders INSIDE the TodoInput portal so focus stays on the input element.
- **Three.js / pad appearance**: [LilyPad](frontend/src/components/pond/LilyPad.tsx) drives pad body color via the `uColor` uniform and opacity via `uAlpha` / shader logic. Story 4.1 and 2.7/2.8 established patterns for live-preview color and focus-flash tints — reuse those hooks (don't create a parallel animation loop) for the completed/deleted visual treatment.
- **Testing**: follow the mock pattern in [PondScene.test.tsx](frontend/src/components/pond/PondScene.test.tsx) and [TodoInput](frontend/src/components/ui/TodoInput.tsx) tests (there isn't a TodoInput test file yet — create one). The slash-command parser is a pure function and should be tested in isolation with no React imports.

## Backend conventions (recap)

- **Sync only (constitutional)**: [todo_service.list_todos](backend/src/services/todo_service.py#L38-L53) is synchronous with `db: Session`. The new param-driven variant is also synchronous. NEVER use `async def` — see `CLAUDE.md` "Principle VI: Concurrency Model".
- **Pydantic schemas**: query params are FastAPI-parsed via type hints on the route handler. Default values on route params are the contract — keep them so existing callers (`GET /api/todos` with no query params) get exactly the same response shape they did before this story.
- **Pytest + httpx sync client**: new tests in [backend/tests/test_todos.py](backend/tests/test_todos.py) (or wherever list_todos tests live) assert all four combinations: no params, include_completed=true only, include_deleted=true only, all-three-true.

## Story

As a user,
I want to type a slash command into the new-todo input to toggle which pads are visible (active, completed, deleted, or any combination),
So that I can briefly revisit historical pads from a demo session without cluttering the default pond view.

## Acceptance Criteria

1. **Given** the pond is loaded in its initial state, **When** I press Enter (no input has focus, no popup open, no search active), **Then** the existing [TodoInput](frontend/src/components/ui/TodoInput.tsx) opens (unchanged from [useKeyboardShortcuts](frontend/src/hooks/useKeyboardShortcuts.ts)) AND a new **slash-command autocomplete dropdown** renders below the input showing the commands applicable to the current visibility state. The dropdown is positioned immediately beneath `<input>` inside the same `todo-input-overlay` portal, uses the same neon-cyan style tokens (`--neon-cyan`, `var(--font-mono)`), and does NOT move the input itself — the dropdown is absolutely-positioned beneath it. The dropdown is present on open but visually subtle (opacity ~0.7) until the user types `/`, at which point it snaps to full opacity — this is the "hint-first, affordance-second" treatment described in Dev Notes § "Why the dropdown is dim-on-open".

2. **Given** the TodoInput is open, **When** the input value starts with a `/` (exactly one, no leading whitespace), **Then** the autocomplete dropdown filters to slash commands whose **canonical name** starts with the current text prefix (after any completed tokens — see AC #4 for multi-command). Matching is case-insensitive; commands are canonical lowercase. Typing `/` alone shows every applicable command; typing `/sh` narrows to `/show-*`; typing `/hid` narrows to `/hide-*`. The currently-highlighted command renders with a cyan underline + 100% opacity; non-highlighted commands render at 0.6 opacity. Up/Down arrow keys change the highlight (wraps at ends). Tab completes the current token to the highlighted command (keeps cursor in input, inserts the missing suffix + trailing space). Pressing Enter with the highlight on a valid command **selects** the command — see AC #4 for dispatch semantics.

3. **Given** the TodoInput is open, **When** the input value does NOT start with `/` (empty, letter, digit, or other non-slash), **Then** the slash-command autocomplete dropdown is hidden (`display: none` or not rendered — a DOM-level hide, not just opacity). The input behaves exactly as pre-3.3: Enter creates a todo, Escape closes the input. No regressions to the existing new-todo path.

4. **Given** the TodoInput contains text that **starts with `/`**, **When** the user presses Enter, **Then** the text is trimmed of trailing whitespace (so `/show-completed ` with a trailing space produced by Tab completion parses the same as `/show-completed`), then tokenised on **single-space** boundaries (consecutive spaces collapse, empty tokens discarded). Every remaining token is looked up in the `slashCommandRegistry` via `findCommand(token)` and checked for consumability via `isConsumable(accumulatedVirtualWorld)` — the accumulation walks forward via each command's `project(world)` (AC #9). If **every** token resolves to a consumable registered command, the parser calls each command's `execute()` in declaration order (commands own their side effects; the parser never touches the store directly), then closes the input WITHOUT creating a todo. The visible effect: pads appear/disappear immediately based on the new flags. If **any** token fails lookup or consumability, the input falls through to the existing todo-create path (the text becomes the new todo's body — matches user spec: "when the input starts with and contains only a slash command (or commands) then apply those filter changes"). This fall-through is a **deliberate** UX choice: an invalid command like `/xyz` becomes a todo named "/xyz", preserving the Enter-always-does-something contract; autocomplete makes typing an invalid command unlikely in practice.

5. **Given** any of the three visibility flags change (`showActive`, `showCompleted`, `showDeleted`), **When** [useTodos](frontend/src/api/todoApi.ts) re-runs, **Then** it issues `GET /api/todos?include_active={showActive}&include_completed={showCompleted}&include_deleted={showDeleted}` and caches under `['todos', 'list', { active, completed, deleted }]`. Each unique combination is its own React Query cache entry; switching from `(true,false,false)` → `(true,true,false)` fires a fresh fetch (or hits a cached result from a previous toggle). Mutations (create, update, delete) invalidate **every** cached `['todos', 'list', *]` entry via prefix-invalidation so stale modes don't linger. The initial render on a fresh load still dispatches `GET /api/todos` with ONLY `include_active=true` (or no params — the backend's defaults match), preserving the existing network trace for the no-toggle user.

6. **Given** the backend receives `GET /api/todos` with optional `include_active`, `include_completed`, `include_deleted` query params, **When** the handler runs, **Then** each param defaults to `true` for `include_active` and `false` for the others (preserves pre-3.3 contract for callers that don't opt in). `list_todos(db, include_active, include_completed, include_deleted)` builds the SQLAlchemy filter dynamically: start from `Todo.archived == False` (archived is never surfaced — that's a separate concern), then OR together the enabled flags. If ALL three flags are false, return `[]` (empty list — a valid state meaning "show nothing"); do NOT coerce to active-only. Order-by stays `created_at.desc()`. The SQL generated by the all-three-true path is `WHERE archived = false` (no `completed` / `deleted` discriminator) so every retained row surfaces — the query planner covers this efficiently via the `ix_todos_active` index for the default case and a table scan for full-history (fine at demo scale).

7. **Given** a todo is rendered as a [LilyPad](frontend/src/components/pond/LilyPad.tsx) and its `completed=true` OR `deleted=true`, **When** the pond draws, **Then** the pad has a distinct visual treatment:
   - **Completed pad**: pad + rim materials set to `transparent=true, opacity=0.45` (use the existing [fadePadMaterials](frontend/src/components/pond/LilyPad.tsx#L199) helper — do NOT reinvent the traversal). Pad body `uColor` seeded at ~40% mix toward the existing `COMPLETE_PAD_TINT` constant ([LilyPad.tsx:98](frontend/src/components/pond/LilyPad.tsx#L98)) so the pad reads greenish-desaturated ("a completed memory"). Glow material's `uColor` also lerped toward `COMPLETE_PAD_TINT` at mount (not per-frame — historical pads are static). No pulse, no ambient glow bounce — disable the ambient branch for non-active pads.
   - **Deleted pad**: same pattern at `opacity=0.35`, body/glow tinted toward the existing [DELETE_PAD_TINT](frontend/src/components/pond/LilyPad.tsx#L99) constant, reads as "a deleted ghost".
   - **Active pad**: unchanged from pre-3.3 (full color, full opacity, current ambient/focus/decay behaviors all intact). The active branch must be BYTE-IDENTICAL — if an existing LilyPad test asserts a uniform value or material flag, the new branching logic must short-circuit to leave that path untouched for active pads.
   Non-active pads short-circuit the ActionPopup open-on-click path: early-return from the pad's click handler if `todo.completed || todo.deleted`. The water-plane click-through branches (OrbitControls pan, popup-close from Story 3.1 AC #2) are **not** affected — those live in [PondCamera](frontend/src/components/pond/PondCamera.tsx) and read `activePopupTodoId`, which never gets set for a non-active pad under the new gate. No change needed there.
   Completion/deletion in-flight animations from Stories 2.4/2.5 must NOT regress: the story-2.4/2.5 flow runs while the pad is still `completed=false` / `deleted=false` in the React Query cache (the mutation is mid-flight), so the visual-treatment branch above only kicks in AFTER the mutation succeeds and `useTodos` refetches with the new flag. The handoff is seamless by construction — see Dev Notes § "Integration with Story 2.4 / 2.5".

8. **Given** the slash-command autocomplete dropdown is visible, **When** I compute the list of commands to show, **Then** the list is derived from the current world snapshot via the generic `availableCommands(world)` function that iterates the `slashCommandRegistry` and returns every registration whose `isConsumable(world)` returns `true`. The specific command set that ships in 3.3 (via [visibilityCommands.ts](frontend/src/utils/visibilityCommands.ts)) is:
   - If `showActive === false` → `/show-active` consumable; else `/hide-active` consumable.
   - If `showCompleted === false` → `/show-completed` consumable; else `/hide-completed` consumable.
   - If `showDeleted === false` → `/show-deleted` consumable; else `/hide-deleted` consumable.
   - If at least one flag is `false` → `/show-all` consumable.
   - If at least one flag is `true` → `/hide-all` consumable.
   - Stable ordering matches registration order in `registerVisibilityCommands()`: active → completed → deleted → show-all → hide-all. Users who memorise positions shouldn't see them jump.

   A command is **consumable** iff its `isConsumable(world)` returns `true` — by convention this means "running this command would produce a state change". The parser in AC #4 uses the same predicate (via `walkState`) to validate tokens, so the dropdown and parser can never disagree. The framework itself (parser, walker, registry) has no knowledge of visibility semantics — it would work identically for a future `/delete-all` or `/find` command whose `isConsumable` checks `world.todos.length > 0` or any other predicate the registration supplies.

9. **Given** the TodoInput is open with a `/` prefix AND the autocomplete dropdown is visible, **When** the user presses Tab, **Then** the input is completed to the full highlighted command (including trailing space for chaining). Subsequent keystrokes extend the next token. E.g., typing `/sh` + Tab completes to `/show-completed ` (or whichever is highlighted); typing `/sh` + Tab + `/hid` + Tab completes to `/show-completed /hide-deleted `. Enter on the completed command (with trailing space stripped from the parsed tokens per AC #4) dispatches both.

   **Mid-chain autocomplete preview (confirmed product behaviour):** After the first token is completed and a trailing space exists, the dropdown re-opens showing commands applicable to the state that **would** exist after the first token's patch was applied. E.g., starting from `(showActive=true, showCompleted=false, showDeleted=false)`, typing `/show-completed ` (trailing space) produces a dropdown filtered against the *virtual* post-patch state `(showActive=true, showCompleted=true, showDeleted=false)`, so it offers `/hide-completed /show-deleted /show-all /hide-all /hide-active` but NOT another `/show-completed` (which is no longer consumable post-first-token). Subsequent Tab completions extend the same virtual-state computation across however many tokens the user has typed. The parser in AC #4 does the same walk when dispatching — virtual state advances token-by-token, and each token must be consumable against the accumulated virtual state. This keeps the dropdown and the parser in lockstep across chained commands. Implement as `reduce` over tokens: `tokens.reduce((acc, tok) => applyPatchIfValid(acc, tok), initialState)` — if at any point a token isn't consumable against the accumulated state, the whole input falls through to todo-create.

10. **Given** the pond is loaded, no `<input>` / `<textarea>` / contenteditable has focus, no ActionPopup is open, and search is NOT active, **When** I press `/` (forward slash), **Then** the TodoInput opens — pre-filled with the single character `/`, caret positioned at the end — and the autocomplete dropdown renders at full opacity showing every currently-consumable registered slash command (same list AC #2 would offer after typing `/`). The keydown event is handled with `e.preventDefault()` + `e.stopImmediatePropagation()` so the existing [usePondSearchKeyboard](frontend/src/hooks/usePondSearchKeyboard.ts) handler does NOT *also* consume the `/` as the first character of a new search query.

    **Collision carve-out — Story 5.3 compatibility:** the search handler in [usePondSearchKeyboard.ts](frontend/src/hooks/usePondSearchKeyboard.ts) currently appends every printable char to `searchQuery` when no input is focused. Story 3.3 adds a single early-return guard in that handler: `if (e.key === '/' && !state.searchActive) return;` — let the new app-level `/` handler claim the keystroke instead. Once search IS active, `/` continues to flow to the search handler (user typing `/` inside a running search query to find a path-like string). This is the primary collision fix; the `stopImmediatePropagation()` above is belt-and-braces so the ordering of the two window-level listeners doesn't matter.

    **Same guards as the existing Enter handler:** no-focused-input / no-popup / no-active-search. If any guard fails, the `/` keystroke flows through untouched: (a) focused `<input>` → browser handles the `/` natively; (b) popup open → popup's own handlers take precedence (Story 2.3); (c) search active → `/` appends to `searchQuery` (Story 5.3 preserved).

    **What the user sees end-to-end:** press `/` on an idle pond → input slides up with "/" already typed, dropdown fully visible showing `/show-completed /show-deleted /show-all`. Type `s` → dropdown filters to `/show-*` matches. Type Tab → completes the highlighted command. Press Enter → dispatches, input closes, pads update.

11. **Given** the existing vitest + pytest suites and this story's new tests, **When** the suite runs, **Then** (a) all existing tests stay green, AND (b) new tests cover:
    - **Backend `list_todos` with flag combinations** (`backend/tests/test_todos.py`, AC #6): no params → active only (unchanged); `include_completed=true` alone → completed only; `include_deleted=true` alone → deleted only; all three true → active + completed + deleted; all three false → `[]`. Seed 3 active + 1 completed + 1 deleted rows and assert exact id sets.
    - **Slash-command framework — parser** (`frontend/src/utils/slashCommands.test.ts`, AC #4): register 2–3 **fake test commands** (NOT the real visibility commands — keep the framework decoupled). Then assert: `parseSlashCommands('/test-a', world)` → `[cmdA]`; `parseSlashCommands('/test-a ', world)` (trailing space) → same; `parseSlashCommands('/test-a /test-b', world)` → both; `parseSlashCommands('/test-a /test-a', world)` → `null` (second token not consumable against post-first-token virtual world); `parseSlashCommands('/xyz', world)` → `null` (invalid); `parseSlashCommands('regular todo text', world)` → `null`; `parseSlashCommands('  /test-a', world)` → `null` (leading whitespace); case-insensitive match accepted. Use `beforeEach(() => clearRegistry())` to reset the registry between tests.
    - **Slash-command framework — `walkState`** (`frontend/src/utils/slashCommands.test.ts`, AC #9): `walkState('/test-a ', world)` → `{ world: projected, invalid: false, fragment: '' }`; `walkState('/test-a /te', world)` → post-first-token world + `fragment: '/te'`; `walkState('/test-a /test-a /te', world)` → `{ invalid: true, fragment: '/te' }` (second test-a non-consumable); `walkState('/', world)` → `{ world: initial, invalid: false, fragment: '/' }`.
    - **Slash-command framework — `availableCommands`** (`frontend/src/utils/slashCommands.test.ts`, AC #8): with 3 fake commands (A consumable, B consumable, C non-consumable), assert `availableCommands(world)` returns `[A, B]` in registration order.
    - **Visibility commands — the 8 registrations** (`frontend/src/utils/visibilityCommands.test.ts`, AC #8 + scope item 5): each command's `isConsumable` checks the right flag at the right polarity; each `project` mutates exactly the expected flag(s); each `execute` calls `usePondStore.setVisibility` with the expected patch. `/show-all` / `/hide-all` consumability edge cases: `/show-all` consumable iff at least one flag is false; `/hide-all` consumable iff at least one flag is true. Stable registration order: current → completed → deleted → show-all → hide-all. Mock `usePondStore` and assert the exact patches.
    - **Registry guard — duplicate token** (`frontend/src/utils/slashCommands.test.ts`): calling `registerCommand({ token: '/foo', ... })` twice throws on the second call. The framework must surface this as a dev-time error, not silently dedupe.
    - **`setVisibility` store action** (`frontend/src/stores/usePondStore.test.ts`, AC #5, #8): partial patch merges (set `showCompleted=true` preserves `showActive` and `showDeleted`); a no-op patch still causes a ref-equal state (no stale-closure bugs in tests); `setVisibility({ showCompleted: true })` followed by `setVisibility({ showCompleted: true })` does NOT bump a counter or re-trigger effects (idempotent).
    - **`useTodos` query-key derivation** (`frontend/src/api/todoApi.test.ts` — new file, AC #5): render a component using `useTodos()` inside a `QueryClientProvider`, flip visibility via `setVisibility`, assert the new query key was used (inspect via `queryClient.getQueryCache().getAll()` → `.queryKey`) and the URL includes the matching `include_*=true/false`.
    - **React Query invalidation on mutation** (`frontend/src/api/todoApi.test.ts`, AC #5): seed two cache entries (default + all-three-true), call `useCreateTodo().mutate(…)`, assert BOTH are invalidated. Same for `useUpdateTodo` and `useDeleteTodo`.
    - **TodoInput slash-command Enter dispatch** (`frontend/src/components/ui/TodoInput.test.tsx` — new file, AC #4): open TodoInput, type `/show-completed`, press Enter → `usePondStore.getState().showCompleted === true` AND `createTodo.mutate` was NOT called AND `onClose` was called. Repeat with `/show-completed /hide-deleted` (chained). Repeat with `not a command` → `createTodo.mutate` IS called with text `not a command`.
    - **TodoInput autocomplete dropdown behaviour** (`frontend/src/components/ui/TodoInput.test.tsx`, AC #1, #2, #3, #9): dropdown visible when input is empty-or-slash-prefixed; hidden otherwise; up/down arrow wraps; Tab completes highlighted; initial highlight is index 0. Filter by prefix: `/hid` hides `/show-*` entries.
    - **LilyPad visual-treatment branching** (`frontend/src/components/pond/LilyPad.test.tsx` — extend if exists, else create, AC #7): `todo.completed=true` sets `uAlpha=0.45`, rim mix toward green; `todo.deleted=true` sets `uAlpha=0.35`, rim mix toward red; active unchanged; non-active pad `onClick` does NOT call `openPopup`.
    - **Camera-reset-on-double-Escape still works** (`frontend/src/hooks/useCameraResetOnDoubleEscape.test.ts`, regression): seed mixed-visibility cache entries, fire ESC ESC, assert `pendingCameraFit` computed over the **active+shown** todos (what the user can actually see). The hook must NOT blow up on the new query-key shape.
    - **Global `/` shortcut opens TodoInput pre-filled** (`frontend/src/hooks/useKeyboardShortcuts.test.ts` — new file, AC #10): mount a component that uses `useKeyboardShortcuts(mockOpen)`; dispatch `keydown` with `key: '/'` on `window`; assert `mockOpen` was called with `'/'`. Repeat with each guard failing (focused `<input>`, `activePopupTodoId !== null`, `searchActive=true`) and assert `mockOpen` was NOT called. Assert `e.preventDefault()` + `e.stopImmediatePropagation()` were invoked on the qualifying-`/` path (can spy on a mutable event object or check `defaultPrevented`).
    - **Search-handler `/` carve-out** (`frontend/src/hooks/usePondSearchKeyboard.test.ts` — extend): `keydown('/')` with `searchActive=false` → `appendSearchChar` NOT called (carve-out fires). `keydown('/')` with `searchActive=true` → `appendSearchChar('/')` IS called (carve-out skipped, existing behaviour preserved). Regression guard: a plain `keydown('a')` with `searchActive=false` still calls `appendSearchChar('a')` — the carve-out is `/`-specific, not a blanket inactivate.
    - **TodoInput `initialValue` seed** (`frontend/src/components/ui/TodoInput.test.tsx`, AC #10): render `<TodoInput isOpen={false} initialValue="/" onClose={...} />`, flip `isOpen` to `true`, assert the controlled `value` state equals `'/'` and the `<input>` is focused with the caret at position 1 (end of `/`). Then dispatch ArrowDown → highlight moves to second dropdown item. Regression: `<TodoInput isOpen={true} initialValue="" />` still seeds `value === ''` (Enter-path unchanged).

## Tasks / Subtasks

- [x] Task 1: Backend — flag-driven `list_todos` (AC: #6, #11)
  - [x] Extend [backend/src/services/todo_service.py](backend/src/services/todo_service.py) `list_todos(db)` to `list_todos(db, include_active: bool = True, include_completed: bool = False, include_deleted: bool = False)`:
    ```python
    from sqlalchemy import or_, and_

    def list_todos(
        db: Session,
        include_active: bool = True,
        include_completed: bool = False,
        include_deleted: bool = False,
    ) -> list[Todo]:
        clauses = []
        if include_active:
            # active = not completed AND not deleted AND not archived
            clauses.append(
                and_(
                    Todo.completed == False,  # noqa: E712
                    Todo.deleted == False,  # noqa: E712
                )
            )
        if include_completed:
            clauses.append(Todo.completed == True)  # noqa: E712
        if include_deleted:
            clauses.append(Todo.deleted == True)  # noqa: E712
        if not clauses:
            return []  # all three flags off → empty result, valid state
        return (
            db.query(Todo)
            .filter(
                Todo.archived == False,  # noqa: E712
                or_(*clauses),
            )
            .order_by(Todo.created_at.desc())
            .all()
        )
    ```
    The `archived == False` pre-filter stays OUTSIDE the OR so it's always applied — archived rows are out of scope for this story (see Dev Notes § "Archived is still out of scope").
  - [x] Extend [backend/src/api/todos.py](backend/src/api/todos.py) route handler:
    ```python
    from fastapi import Query

    @router.get("", response_model=list[TodoResponse])
    def list_todos(
        include_active: bool = Query(default=True),
        include_completed: bool = Query(default=False),
        include_deleted: bool = Query(default=False),
        db: Session = Depends(get_db),
    ) -> list[TodoResponse]:
        todos = todo_service.list_todos(
            db,
            include_active=include_active,
            include_completed=include_completed,
            include_deleted=include_deleted,
        )
        return [TodoResponse.model_validate(t) for t in todos]
    ```
    The Query defaults preserve the existing contract — a `GET /api/todos` call with no params returns exactly the same list it did before 3.3.
  - [x] Extend existing pytest tests (or add new) in [backend/tests/test_todos.py](backend/tests/test_todos.py) covering the 5 permutations enumerated in AC #11. Use the existing seed fixtures — do NOT add an "archived" seed since archived is pre-filtered (and archived is out of this story's scope).

- [x] Task 2: Frontend types + store slices (AC: #5, #8, #11)
  - [x] In [frontend/src/stores/usePondStore.ts](frontend/src/stores/usePondStore.ts), extend `PondState`:
    ```ts
    // Story 3.3: todo-visibility flags. Default (active-only) matches
    // the PRD's primary interaction model; users opt into historical
    // view via slash commands (see frontend/src/utils/slashCommands.ts).
    // All flags live in-memory only — a reload resets to defaults.
    // See Dev Notes § "Why no localStorage" for the rationale.
    showActive: boolean;     // default true
    showCompleted: boolean;   // default false
    showDeleted: boolean;     // default false
    ```
    And in `PondStateActions` (or however actions are typed):
    ```ts
    setVisibility: (patch: {
      showActive?: boolean;
      showCompleted?: boolean;
      showDeleted?: boolean;
    }) => void;
    ```
    Implementation:
    ```ts
    setVisibility: (patch) => set((state) => ({ ...state, ...patch })),
    ```
    Initial values in the `create` call: `showActive: true, showCompleted: false, showDeleted: false`.
  - [x] Add tests in [frontend/src/stores/usePondStore.test.ts](frontend/src/stores/usePondStore.test.ts) covering AC #5 / #10 scope for `setVisibility`.

- [x] Task 3: Frontend — generic slash-command framework (AC: #4, #8, #9, #11)
  - [x] Create the core framework at [frontend/src/utils/slashCommands.ts](frontend/src/utils/slashCommands.ts) — the command-agnostic parser, walker, and registry. This file knows NOTHING about visibility; it only knows how to iterate a registry of `SlashCommand` registrations:
    ```ts
    /**
     * Read-only snapshot of whatever world state a command needs to
     * inspect. Starts out with just `visibility`, but each new story
     * adding a command may extend this union via module augmentation
     * (see Dev Notes § "Adding a new slash command"). Keep fields
     * OPTIONAL so a command that doesn't need a field can ignore it.
     */
    export interface WorldSnapshot {
      visibility: VisibilityState;
      // Future fields added by other stories, e.g.:
      //   todos?: readonly Todo[];
      //   searchActive?: boolean;
    }

    export interface VisibilityState {
      showActive: boolean;
      showCompleted: boolean;
      showDeleted: boolean;
    }

    export interface SlashCommand {
      /** Canonical text with leading '/'. MUST be lowercase + unique. */
      readonly token: string;
      /** Human-readable help shown in the dropdown next to the token. */
      readonly description: string;
      /**
       * Is this command runnable against the current world?
       * Return `false` for no-ops (e.g. `/show-completed` when already
       * shown). The dropdown filters by this predicate; the parser
       * rejects chains that would run a non-consumable command.
       */
      isConsumable(world: WorldSnapshot): boolean;
      /**
       * Return the world snapshot that WOULD exist after running this
       * command. MUST NOT mutate side-effectfully — this is used to
       * walk virtual state for mid-chain dropdown preview (AC #9).
       */
      project(world: WorldSnapshot): WorldSnapshot;
      /**
       * Run the real side effects (store writes, API calls). Called
       * by the dispatcher when the user presses Enter on a validated
       * chain. Takes nothing; the command closes over whatever it
       * needs (usePondStore, queryClient, etc.) at registration time.
       */
      execute(): void;
    }

    // The global registry — registered commands in stable iteration order.
    // DO NOT mutate at runtime from consumer code; use `registerCommand`.
    const registry: SlashCommand[] = [];

    /** Register a command. Duplicate tokens throw at dev time. */
    export function registerCommand(cmd: SlashCommand): void {
      if (registry.some((c) => c.token === cmd.token)) {
        throw new Error(`slashCommands: duplicate token ${cmd.token}`);
      }
      registry.push(cmd);
    }

    /** Read-only snapshot for tests and the UI layer. */
    export function getRegistry(): readonly SlashCommand[] {
      return registry;
    }

    /**
     * Return the subset of registered commands that are consumable
     * against the given world. Preserves registration order — each
     * command file decides where it sits in the dropdown by
     * registration ordering.
     */
    export function availableCommands(world: WorldSnapshot): SlashCommand[] {
      return registry.filter((c) => c.isConsumable(world));
    }

    /**
     * Look up a command by its canonical token (case-insensitive match;
     * canonical token is already lowercase).
     */
    export function findCommand(token: string): SlashCommand | undefined {
      const lc = token.toLowerCase();
      return registry.find((c) => c.token === lc);
    }

    /**
     * Walk every complete token in `text` (terminated by a space),
     * projecting each token's effect into a virtual world snapshot.
     * Returns the post-walk world + the trailing fragment (the token
     * currently being typed, with no trailing space yet).
     *
     * Invariant: if a complete token is not consumable against the
     * walked-so-far world, returns `{ invalid: true, fragment }`. The
     * dropdown uses `invalid` to render an empty list; the parser
     * uses it to reject the chain.
     */
    export function walkState(
      text: string,
      initial: WorldSnapshot,
    ): { world: WorldSnapshot; invalid: boolean; fragment: string } { /* … */ }

    /**
     * Parse raw input text and return an ordered array of commands to
     * execute, or `null` if the text is NOT a pure command chain.
     *
     * Returns commands iff:
     *   (a) text starts with '/' (no leading whitespace),
     *   (b) every complete token (walkState output) is consumable against
     *       the accumulated virtual world,
     *   (c) the trailing fragment (if any) also matches a consumable
     *       command (i.e., the user completed the last token they
     *       started typing — Enter on an incomplete trailing fragment
     *       falls through to todo-create).
     *
     * Returns `null` in any other case — caller falls through to the
     * normal todo-create path.
     */
    export function parseSlashCommands(
      text: string,
      world: WorldSnapshot,
    ): SlashCommand[] | null { /* … */ }
    ```
  - [x] Create [frontend/src/utils/visibilityCommands.ts](frontend/src/utils/visibilityCommands.ts) — the visibility-specific registrations. This is the "adding a new command category" reference implementation future stories will copy:
    ```ts
    import { registerCommand, type SlashCommand, type WorldSnapshot, type VisibilityState } from './slashCommands';
    import { usePondStore } from '../stores/usePondStore';

    // Helper: build a pair of show/hide commands for a single flag.
    function visibilityPair(args: {
      flag: keyof VisibilityState;
      label: string;
    }): [SlashCommand, SlashCommand] {
      const { flag, label } = args;
      const show: SlashCommand = {
        token: `/show-${label}`,
        description: `Show ${label} pads`,
        isConsumable: (w) => !w.visibility[flag],
        project: (w) => ({ ...w, visibility: { ...w.visibility, [flag]: true } }),
        execute: () => usePondStore.getState().setVisibility({ [flag]: true }),
      };
      const hide: SlashCommand = {
        token: `/hide-${label}`,
        description: `Hide ${label} pads`,
        isConsumable: (w) => w.visibility[flag],
        project: (w) => ({ ...w, visibility: { ...w.visibility, [flag]: false } }),
        execute: () => usePondStore.getState().setVisibility({ [flag]: false }),
      };
      return [show, hide];
    }

    const [showActive, hideActive] = visibilityPair({ flag: 'showActive', label: 'active' });
    const [showCompleted, hideCompleted] = visibilityPair({ flag: 'showCompleted', label: 'completed' });
    const [showDeleted, hideDeleted] = visibilityPair({ flag: 'showDeleted', label: 'deleted' });

    const showAll: SlashCommand = {
      token: '/show-all',
      description: 'Show current, completed, and deleted pads',
      isConsumable: (w) => !w.visibility.showActive || !w.visibility.showCompleted || !w.visibility.showDeleted,
      project: (w) => ({ ...w, visibility: { showActive: true, showCompleted: true, showDeleted: true } }),
      execute: () => usePondStore.getState().setVisibility({ showActive: true, showCompleted: true, showDeleted: true }),
    };

    const hideAll: SlashCommand = {
      token: '/hide-all',
      description: 'Hide every pad (empty pond)',
      isConsumable: (w) => w.visibility.showActive || w.visibility.showCompleted || w.visibility.showDeleted,
      project: (w) => ({ ...w, visibility: { showActive: false, showCompleted: false, showDeleted: false } }),
      execute: () => usePondStore.getState().setVisibility({ showActive: false, showCompleted: false, showDeleted: false }),
    };

    // Registration order = dropdown order. Ship the flag-pair buckets
    // in the order `active / completed / deleted`, then the two
    // shorthands at the end.
    export function registerVisibilityCommands(): void {
      registerCommand(showActive);
      registerCommand(hideActive);
      registerCommand(showCompleted);
      registerCommand(hideCompleted);
      registerCommand(showDeleted);
      registerCommand(hideDeleted);
      registerCommand(showAll);
      registerCommand(hideAll);
    }
    ```
  - [x] Call `registerVisibilityCommands()` exactly once at app bootstrap — inside [frontend/src/main.tsx](frontend/src/main.tsx) before `ReactDOM.createRoot(...).render(...)`. Do NOT call from a component body (would re-register on every render and hit the duplicate-token guard). Hidden behind a single-call sentinel inside `registerVisibilityCommands` is acceptable as a belt-and-braces if HMR shows up as flaky; for plain cold boot, top-level main.tsx call is enough.
  - [x] Create [frontend/src/utils/slashCommands.test.ts](frontend/src/utils/slashCommands.test.ts) covering the framework in isolation: register fake test commands, assert `availableCommands` filters by `isConsumable`, `walkState` advances through chains, `parseSlashCommands` rejects non-consumable chains and accepts valid ones. Tests must **not** depend on the real visibility commands — register fresh fakes per test to keep the framework decoupled from any single command category.
  - [x] Create [frontend/src/utils/visibilityCommands.test.ts](frontend/src/utils/visibilityCommands.test.ts) covering the eight concrete visibility commands: each `isConsumable`, each `project`, each `execute` (mock the store and assert the right `setVisibility` call lands). `registerVisibilityCommands` is idempotent inside a test harness only if the test calls `beforeEach(() => clearRegistry())` — add an internal `clearRegistry()` exported for test use only (document with a "test-only" JSDoc comment).
  - [x] Case-insensitive token match: `parseSlashCommands('/SHOW-COMPLETED', world)` canonicalises to `/show-completed` before registry lookup. Tokens in the registry are stored lowercase; the parser lowercases input tokens before comparison.

- [x] Task 4: Frontend — `useTodos` query-key + mutation invalidation (AC: #5, #11)
  - [x] In [frontend/src/api/todoApi.ts](frontend/src/api/todoApi.ts), keep `TODOS_KEY = ['todos', 'list'] as const` as the **prefix**. Introduce a helper:
    ```ts
    function todosQueryKey(state: VisibilityState) {
      return [
        ...TODOS_KEY,
        { active: state.showActive, completed: state.showCompleted, deleted: state.showDeleted },
      ] as const;
    }
    ```
  - [x] Update `useTodos`:
    ```ts
    export function useTodos() {
      const visibility = usePondStore((s) => ({
        showActive: s.showActive,
        showCompleted: s.showCompleted,
        showDeleted: s.showDeleted,
      }));
      return useQuery({
        queryKey: todosQueryKey(visibility),
        queryFn: async () => {
          const params = new URLSearchParams({
            include_active: String(visibility.showActive),
            include_completed: String(visibility.showCompleted),
            include_deleted: String(visibility.showDeleted),
          });
          const { data } = await apiClient.get<Todo[]>(`/todos?${params.toString()}`);
          return data;
        },
      });
    }
    ```
    Use `useShallow` if the existing store utility is already imported (check [usePondStore](frontend/src/stores/usePondStore.ts) exports), otherwise the standard selector returning a fresh object will cause a re-render per state set — acceptable here since the three booleans rarely change. If perf profiling surfaces noise, swap to `useShallow` later.
  - [x] Update **every** `queryClient.invalidateQueries` call in `useCreateTodo` / `useUpdateTodo` / `useDeleteTodo` from `{ queryKey: [...TODOS_KEY] }` to `{ queryKey: TODOS_KEY }` — React Query's default `exact: false` means the prefix match invalidates every child key. Confirm by reading [React Query docs](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation); if `exact` defaults have changed in v5, pass `{ queryKey: TODOS_KEY, exact: false }` explicitly.
  - [x] Create [frontend/src/api/todoApi.test.ts](frontend/src/api/todoApi.test.ts) covering AC #11 items on query-key derivation + mutation invalidation. Use [`@tanstack/react-query`'s QueryClient](https://tanstack.com/query/latest/docs/framework/react/reference/QueryClient) test harness; follow the pattern in [usePondSearchSync.test.ts](frontend/src/hooks/usePondSearchSync.test.ts).

- [x] Task 5: Update ESC-ESC camera-reset hook for new query-key shape (AC: #5, #10 regression)
  - [x] In [frontend/src/hooks/useCameraResetOnDoubleEscape.ts](frontend/src/hooks/useCameraResetOnDoubleEscape.ts), the todos are currently read via `queryClient.getQueryData<Todo[]>(['todos', 'list'])`. That EXACT key no longer exists. Change to:
    ```ts
    const entries = queryClient.getQueriesData<Todo[]>({ queryKey: ['todos', 'list'] });
    const todos: Todo[] = [];
    const seen = new Set<string>();
    for (const [, data] of entries) {
      if (!data) continue;
      for (const t of data) {
        if (!seen.has(t.id)) {
          seen.add(t.id);
          todos.push(t);
        }
      }
    }
    const fit = fitCameraToPads(todos);
    ```
    De-duping by `id` handles the case where the same todo appears in multiple cache entries (e.g., active + all-three-true).
  - [x] Update [frontend/src/hooks/useCameraResetOnDoubleEscape.test.ts](frontend/src/hooks/useCameraResetOnDoubleEscape.test.ts) — one test seeds only the default cache entry (existing behaviour); new test seeds two cache entries (default + all-three-true with extra completed+deleted), asserts the union is fed to `fitCameraToPads`. No regression from 3.1 expected; the hook just reads more broadly.

- [x] Task 6: Frontend — TodoInput dual-mode + autocomplete dropdown (AC: #1, #2, #3, #4, #9, #11)
  - [x] Amend [frontend/src/components/ui/TodoInput.tsx](frontend/src/components/ui/TodoInput.tsx):
    - Add state: `const [value, setValue] = useState('');` — current input text mirrored as controlled state (needed for filtering the dropdown on every keystroke).
    - Add state: `const [highlightIdx, setHighlightIdx] = useState(0);` — which dropdown row is highlighted.
    - Read visibility from the store via a selector.
    - Compute virtual state + fragment for mid-chain preview (AC #9):
      ```ts
      const walk = useMemo(() => walkState(value, visibility), [value, visibility]);
      const commandsForDropdown = useMemo(
        () => (walk.invalid ? [] : availableCommands(walk.state)),
        [walk],
      );
      ```
    - Filter by the trailing fragment: if `walk.fragment === ''` OR `walk.fragment === '/'` → all of `commandsForDropdown`; else → commands whose `token` starts with `walk.fragment` (case-insensitive). When `walk.invalid === true`, the dropdown is empty — signal to the user that the chain broke and Enter will fall through to todo-create.
    - Render a dropdown BELOW the input (absolute-positioned, same portal):
      ```tsx
      {showDropdown && (
        <ul className="todo-input-dropdown">
          {filtered.map((cmd, i) => (
            <li
              key={cmd.name}
              className={i === highlightIdx ? 'todo-input-dropdown__item--highlighted' : 'todo-input-dropdown__item'}
            >
              <span className="todo-input-dropdown__token">{cmd.token}</span>
              <span className="todo-input-dropdown__desc">{cmd.description}</span>
            </li>
          ))}
        </ul>
      )}
      ```
    - `showDropdown = isOpen && (value === '' || value.startsWith('/'))`.
    - Extend `handleKeyDown`:
      - `ArrowDown` / `ArrowUp` — when dropdown visible, move highlight (wrap), `preventDefault()`.
      - `Tab` — when dropdown visible, complete current token to the highlighted command token + trailing space. `preventDefault()`.
      - `Enter` — NEW dispatch order: if `value.startsWith('/')`, parse via `parseSlashCommands(value, visibility)`. If non-null, call `setVisibility` with the merged patches in order, then `onClose()`, do NOT call `createTodo`. If null, fall through to the existing `createTodo.mutate` path.
      - `Escape` — existing (close input). Don't touch dropdown separately — it's a child of the input overlay and unmounts with it.
  - [x] Extend [frontend/src/components/ui/TodoInput.css](frontend/src/components/ui/TodoInput.css) with the dropdown styles:
    ```css
    .todo-input-dropdown {
      position: absolute;
      top: 100%;  /* directly below input */
      left: 50%;
      transform: translateX(-50%);
      margin-top: 6px;
      list-style: none;
      padding: 4px 0;
      min-width: 320px;
      background: rgba(0, 0, 0, 0.85);
      border: 1px solid var(--neon-cyan);
      box-shadow: 0 0 8px var(--neon-cyan);
      color: var(--neon-cyan);
      font-family: var(--font-mono);
      font-size: 14px;
      pointer-events: auto;
    }
    .todo-input-dropdown__item,
    .todo-input-dropdown__item--highlighted {
      padding: 6px 16px;
      display: flex;
      gap: 12px;
      opacity: 0.6;
    }
    .todo-input-dropdown__item--highlighted {
      opacity: 1;
      border-left: 2px solid var(--neon-cyan);
      background: rgba(0, 238, 255, 0.08);
    }
    .todo-input-dropdown__token {
      flex-shrink: 0;
    }
    .todo-input-dropdown__desc {
      opacity: 0.5;
      font-size: 12px;
    }
    ```
    Do NOT give the dropdown `cursor: pointer` unless you also wire click-to-select (deferred to keep scope tight — keyboard-only is enough for v1; see Dev Notes § "No mouse-click selection in v1").
  - [x] Create [frontend/src/components/ui/TodoInput.test.tsx](frontend/src/components/ui/TodoInput.test.tsx) with tests for AC #11 TodoInput items: slash-command Enter dispatch, autocomplete filtering, arrow/Tab navigation, fall-through to todo-create.

- [x] Task 6b: Global `/` shortcut → open TodoInput pre-filled (AC: #10, #11)
  - [x] Extend [frontend/src/hooks/useKeyboardShortcuts.ts](frontend/src/hooks/useKeyboardShortcuts.ts) to accept a richer callback signature:
    ```ts
    export function useKeyboardShortcuts(onOpenInput: (initialValue: string) => void) {
      useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
          // Existing guards (unchanged):
          const target = e.target as HTMLElement;
          if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
          const { activePopupTodoId, searchActive } = usePondStore.getState();
          if (activePopupTodoId !== null || searchActive) return;

          if (e.key === 'Enter') {
            e.preventDefault();
            onOpenInput('');
            return;
          }
          if (e.key === '/') {
            // Open the input pre-filled with '/', so the user's next
            // keystroke extends the slash command rather than starting
            // a new one. stopImmediatePropagation so the Story-5.3
            // search handler (which also listens at window level for
            // printable chars) doesn't ALSO consume this '/' as the
            // first char of a new search query — belt-and-braces on
            // top of the search handler's own '/' carve-out below.
            e.preventDefault();
            e.stopImmediatePropagation();
            onOpenInput('/');
            return;
          }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
      }, [onOpenInput]);
    }
    ```
  - [x] Update [frontend/src/App.tsx](frontend/src/App.tsx) to hold an `inputInitial: string` state alongside `inputOpen: boolean`, pass `initialValue={inputInitial}` into `<TodoInput>`, and wire the callback:
    ```ts
    const [inputOpen, setInputOpen] = useState(false);
    const [inputInitial, setInputInitial] = useState('');
    const openInput = useCallback((initial: string) => {
      setInputInitial(initial);
      setInputOpen(true);
    }, []);
    useKeyboardShortcuts(openInput);
    // ...
    <TodoInput
      isOpen={inputOpen}
      initialValue={inputInitial}
      onClose={() => setInputOpen(false)}
    />
    ```
    On input close, DO NOT clear `inputInitial` — leave it set. The `initialValue` prop only seeds the input when `isOpen` flips false → true (see Task 6 TodoInput amendment below).
  - [x] Extend [TodoInput](frontend/src/components/ui/TodoInput.tsx) to accept a new optional prop `initialValue?: string` (default `''`). Seed the controlled `value` state from it when `isOpen` flips false → true:
    ```ts
    export function TodoInput({ isOpen, initialValue = '', onClose }: TodoInputProps) {
      const [value, setValue] = useState(initialValue);
      // When the input opens, re-seed `value` from the latest initialValue
      // so consecutive Enter vs '/' shortcuts land with the right text.
      useEffect(() => {
        if (isOpen) setValue(initialValue);
      }, [isOpen, initialValue]);
      // ... rest unchanged, but pass `value` into <input value={value} onChange={...}>
    }
    ```
    Caret position: after the effect runs, `inputRef.current?.setSelectionRange(value.length, value.length)` so the caret lands at the end of `/` (not the start).
  - [x] Add the one-line carve-out to [frontend/src/hooks/usePondSearchKeyboard.ts](frontend/src/hooks/usePondSearchKeyboard.ts) inside `handleKeyDown`, **before** the `appendSearchChar` dispatch:
    ```ts
    // Story 3.3: let the app-level '/' shortcut claim the keystroke
    // when no search is active. Once a search IS active, '/' continues
    // to append to the query (useful for typing path-like search
    // strings). This is the primary collision-resolution between 3.3's
    // '/' shortcut and 5.3's type-anywhere search capture.
    if (e.key === '/' && !state.searchActive) return;
    ```
    Place this after the existing input-focus / popup / modifier guards and before the printable-char branch. Document the 3.3 cross-reference in a comment.
  - [x] Tests for this task are enumerated in AC #11.

- [x] Task 7: LilyPad visual treatment for completed/deleted pads (AC: #7, #11)
  - [x] In [frontend/src/components/pond/LilyPad.tsx](frontend/src/components/pond/LilyPad.tsx), add a derived `visualState` memo near the top of the component body:
    ```ts
    const visualState = useMemo<'active' | 'completed' | 'deleted'>(() => {
      if (todo.deleted) return 'deleted';
      if (todo.completed) return 'completed';
      return 'active';
    }, [todo.deleted, todo.completed]);
    ```
    This is the SOLE discriminator — every 3.3-branch below reads it.
  - [x] On mount (or `visualState` change), when `visualState !== 'active'`:
    - Apply opacity via the existing [fadePadMaterials](frontend/src/components/pond/LilyPad.tsx#L199) helper: `fadePadMaterials(padGroupRef.current, visualState === 'completed' ? 0.45 : 0.35)`. Do NOT reinvent the group-traversal — the helper already handles ShaderMaterial + MeshBasicMaterial + LineBasicMaterial correctly (see [LilyPad.tsx:199-213](frontend/src/components/pond/LilyPad.tsx#L199-L213)). Pair with the existing [restorePadMaterials](frontend/src/components/pond/LilyPad.tsx#L226-L236) semantics if a pad ever transitions back to active (shouldn't happen in the product, but the symmetry is cheap defense).
    - Tint the pad body `uColor` toward the existing tint constants:
      ```ts
      // COMPLETE_PAD_TINT and DELETE_PAD_TINT are already module-scope
      // constants used by Stories 2.4 / 2.5 / 2.8 for the completion /
      // deletion flash. Reusing them keeps the palette coherent: a
      // completed pad's ghost is the same green the flash was.
      if (padMatRef.current?.uniforms?.uColor) {
        const tint = visualState === 'completed' ? COMPLETE_PAD_TINT : DELETE_PAD_TINT;
        padMatRef.current.uniforms.uColor.value
          .set(baseColor.r, baseColor.g, baseColor.b)
          .lerp(tint, 0.4);
      }
      ```
    - Apply the same tint lerp to the glow material's `uColor` (mirrors the pattern in [LilyPad.tsx:921](frontend/src/components/pond/LilyPad.tsx#L921) for completion / [LilyPad.tsx:1032](frontend/src/components/pond/LilyPad.tsx#L1032) for deletion, but at mount, not per-frame — historical pads are static).
    - **Disable per-frame animation branches for non-active pads**: in the `useFrame` body, early-return `if (visualState !== 'active') return;` BEFORE any ambient glow, pulse, decay, or focus-flash logic runs. This keeps historical pads visually frozen in a "memory" state and avoids stomping on the tint writes above.
  - [x] Active branch stays byte-identical to pre-3.3. Wrap every new branch behind `if (visualState !== 'active')` so adding/removing the feature flag is trivially a no-op for active pads. Run the existing LilyPad test suite (any tests that render with `completed=false`, `deleted=false`) must pass unchanged.
  - [x] Gate the click handler: in the existing pad click / pointerup handler in LilyPad, add `if (todo.completed || todo.deleted) return;` at the top. Do NOT gate the completion/deletion in-flight animations from Stories 2.4/2.5 — those run BEFORE the backend flips the flag, so they execute under `visualState === 'active'` anyway (the mutation hasn't landed yet; the pad is tracked in the `completingTodos` / `deletingTodos` store maps and rendered via [PondScene.renderTodos](frontend/src/components/pond/PondScene.tsx#L83-L100) merging). After the mutation lands and `useTodos` refetches, the pad re-renders with `visualState !== 'active'` — the seamless handoff described in Dev Notes.
  - [x] Extend / create [frontend/src/components/pond/LilyPad.test.tsx](frontend/src/components/pond/LilyPad.test.tsx) with the visual-treatment + no-popup tests from AC #11. If the existing LilyPad test file doesn't exist, create it using the mock pattern from [PondCamera.test.tsx](frontend/src/components/pond/PondCamera.test.tsx) (mock `@react-three/fiber` + `@react-three/drei`; exercise the `visualState` branch without a real canvas).

- [x] Task 8: Sprint-status bookkeeping + retire docs (no code)
  - [x] Update [_bmad-output/implementation-artifacts/sprint-status.yaml](_bmad-output/implementation-artifacts/sprint-status.yaml): add `3-3-todo-visibility-via-slash-commands: ready-for-dev` under `epic-3`; bump `last_updated`.
  - [x] Do NOT edit [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — this story is deliberate scope-expansion post-PRD; log the deviation in `## Change Log` at the bottom of THIS story file rather than rewriting the epic.

- [x] Task 9: Full-suite verification + browser walkthrough (AC: #1–#11, #10 global `/` shortcut included)
  - [x] `cd backend && uv run pytest` — all green (including 5 new list_todos permutation tests).
  - [x] `cd frontend && npx vitest run` — all green (including new slashCommands, todoApi, TodoInput, LilyPad tests + the updated useCameraResetOnDoubleEscape test).
  - [x] `cd frontend && npx tsc -b` — clean.
  - [ ] Browser walkthrough (DEFERRED to reviewer — dev is headless):
    - [ ] Open pond with a mix of active + completed + deleted history seeded; assert only active is shown at load.
    - [ ] Press Enter → TodoInput opens, dropdown shows `/show-completed /show-deleted /show-all`.
    - [ ] Type `/show-completed` + Enter → completed pads fade in with green-tinted ghost treatment; dropdown on next open shows `/hide-completed /show-deleted /show-all /hide-all`.
    - [ ] Type `/show-deleted` + Enter → deleted pads also appear, red-tinted ghost.
    - [ ] Click a completed pad → nothing happens (no popup, no camera focus).
    - [ ] Click a deleted pad → nothing happens (no popup).
    - [ ] Click active pad → popup opens as normal; complete or delete a pad from the popup → the pad runs its completion/deletion animation, then remains on-screen with the historical treatment (because `showCompleted` or `showDeleted` is true).
    - [ ] Type `/hide-all` + Enter → every pad disappears (empty pond); dropdown now shows only `/show-*` commands.
    - [ ] Type `/show-all` + Enter → everything returns.
    - [ ] Type `not a command` + Enter → creates a todo with text "not a command" (fall-through works).
    - [ ] Type `/xyz` + Enter → creates a todo with text "/xyz" (invalid-command fall-through).
    - [ ] Type `/sho` + Tab → completes to `/show-completed ` (assuming that's highlighted).
    - [ ] Type `/show-completed /hide-deleted` + Enter with `showCompleted=false, showDeleted=true` → both change.
    - [ ] Reload → visibility resets to defaults (active only).
    - [ ] Double-Escape from any visibility state → camera reset still frames the pads actually visible.

## Dev Notes

### Adding a new slash command (extension guide for future stories)

The framework in [frontend/src/utils/slashCommands.ts](frontend/src/utils/slashCommands.ts) deliberately knows **nothing** about visibility — it's a generic registry of `SlashCommand` objects. Adding a new command in a future story is a three-step pattern, modelled on [visibilityCommands.ts](frontend/src/utils/visibilityCommands.ts):

1. **Create a new file** for the command category: `frontend/src/utils/<category>Commands.ts`. Exports a `register<Category>Commands()` function and the individual `SlashCommand` registrations.
2. **Write each command** with `{ token, description, isConsumable, project, execute }`. `isConsumable` is a pure predicate over `WorldSnapshot`; `project` returns a NEW (not mutated) `WorldSnapshot` reflecting the command's effect; `execute` fires the real side effect (store write, API call). Commands close over whatever deps they need at module scope — typical: `usePondStore`, `queryClient`, a mutation hook result.
3. **Call `register<Category>Commands()` in `main.tsx`** alongside `registerVisibilityCommands()`. Order of calls determines dropdown order across categories.

Worked examples the framework is designed to accommodate (NOT in 3.3 scope):

- **`/delete-all`**: `isConsumable: (w) => w.todos.length > 0`, `project: (w) => ({ ...w, todos: [] })`, `execute: () => { /* fire bulk-delete mutation */ }`. Requires extending `WorldSnapshot` with a `todos` field that `useTodos()` feeds into the TodoInput.
- **`/find <query>`**: needs the parser to support argument-taking tokens. NOT a pure bare-word command — this would require extending `parseSlashCommands` to recognise a trailing free-form argument after a specific command. That's an extension of the framework, not just a new registration. Design sketch: commands declare `argSpec: 'none' | 'rest'`; when `rest`, the parser stops tokenising after the command token and passes the remainder as a single string argument to `execute(args)`. Fold into the framework when the first argument-taking command is specced.
- **`/archive-completed`**: `isConsumable: (w) => w.todos.some((t) => t.completed)`, `execute: () => { /* bulk mutation */ }`. Fits the existing framework with no extensions.

The "Dropdown is context-aware" property follows naturally: each command decides its own consumability, so the dropdown (which only shows consumable commands) is automatically correct across all command categories. No central routing table, no switch statement — add a command, ship.

### Why the dropdown is dim-on-open

The original user spec says "When pressing Enter, display a subset of slash commands". A full-opacity dropdown on every Enter would be distracting for users who want to do the normal-path "type a new todo". We compromise by rendering the dropdown **dimly** (opacity 0.7) the moment TodoInput opens — it's a persistent discovery affordance, not a modal. As soon as the user types `/`, the dropdown snaps to full opacity (0.6 on non-highlighted rows, 1.0 on the highlighted one) and drives real navigation. A plain-text keystroke (any non-slash character) hides the dropdown entirely (DOM-removed) so it doesn't compete with the todo-create mental model. This gives us "Claude-Code-like autocomplete feel" without shouting at the user every time they open the input.

### Why `parseSlashCommands` takes `VisibilityState`

The parser validates against the *consumable* command set, not the global set. `/show-completed` is rejected as invalid when completed is already shown. This has two upsides: (a) it keeps the parser and the dropdown in perfect sync — what you see in the dropdown is exactly what the parser accepts; (b) a user typing `/show-completed` after it's already applied falls through to todo-create (rather than a silent no-op), so the Enter-always-does-something contract holds. The alternative — accept every syntactically valid command regardless of current state — would make `/show-completed /show-completed` succeed as a chained idempotent, which reads as a bug in the UX. Reject over silent-no-op.

### Why no localStorage

Persisting visibility flags across sessions was considered and dropped. Three reasons: (1) the PRD says active-only is the default pond view — a user opening a fresh tab should see what the PRD specifies, not "whatever the last session was doing". (2) The feature is a demo-time exploratory affordance; demo runs are stateless-by-design (presenter wants a clean start). (3) If a future story (4.3 position persistence? a dedicated user-prefs story?) adds a general-purpose prefs slice, visibility flags can be retrofitted then — the in-memory default now doesn't constrain that future migration. If users during demo feedback say "I toggled completed view, closed the tab, came back, wanted it still on" — promote to a deferred-work item.

### Parser token ordering vs. state transitions

When a user types `/show-completed /hide-deleted`, we parse both, then apply both in declaration order. In the pathological case `/show-completed /hide-completed`, the two tokens conflict: the second would overwrite the first's effect. The parser accepts both because each token is individually consumable against the starting state — `show-completed` flips `false → true`, then `hide-completed` is consumable against the post-first-token state. But by the time we reach `setVisibility`, we apply BOTH patches in one reducer call, and the later wins. This is the user spec's "apply those filter changes" literally — chain semantics are "apply each in order". If a future iteration wants "atomic validation" (reject the whole chain if any internal transition is redundant), we change the parser; for 3.3, chain-and-apply is fine.

### Archived is still out of scope

The existing `list_todos` pre-filters `archived=false` (see [backend/src/services/todo_service.py:38-53](backend/src/services/todo_service.py#L38-L53) pre-3.3). Story 3.3 **keeps** that pre-filter — archived rows never surface through this endpoint, regardless of flags. "Archived" is a separate retention concern (long-term history, not user-facing "deleted") and the product has no archive-view story yet. If one appears later, add a fourth flag `include_archived` — but do NOT retroactively conflate `archived` with `deleted` in this story.

### Why not extend the search overlay instead

Story 5.3 gives us a global type-anywhere search overlay. Could `/show-completed` be typed INTO the search overlay as a "search command"? Technically yes, but: (1) search has its own debounce + state machine; interleaving filter-commands would create a state-matrix mess. (2) search is scoped to ACTIVE todos per FR14; making it filter-view-aware would cascade into search-result fetching the completed/deleted subsets too. (3) TodoInput is already the "type-to-act" affordance; extending it is cheaper and more discoverable (Enter is a well-known open-this-input binding). (4) The user's spec explicitly said "When pressing Enter, display a subset of slash commands" — Enter opens TodoInput, not search.

### No mouse-click selection in v1

The autocomplete dropdown is keyboard-only in this story — arrow keys navigate, Tab completes, Enter dispatches. A mouse click on a dropdown row would feel natural but adds test surface (pointer events, hover states, focus management when mouse leaves). Keyboard-only matches Claude Code's early autocomplete UX and satisfies the spec. If demo feedback says "I kept trying to click", promote to a deferred-work item.

### Invalidation: prefix or exact?

React Query v5's `invalidateQueries({ queryKey })` matches by prefix unless `exact: true` is set. The existing mutation handlers use `queryKey: [...TODOS_KEY]` (spread) which happens to match exactly on the old one-entry cache; under the new scheme, the SAME call still prefix-matches every child. **No change required** in the spread-form. But: the spread changes the identity each call — it's a fresh array — so we should align on `queryKey: TODOS_KEY` (no spread) and rely on React Query's identity-tolerant comparison. Either works; the no-spread form is simpler.

### Why `showActive` (not `showCurrent`)

The initial story sketch used "current" in the commands (`/show-current` / `/hide-current`) matching the user's first pass, but the product settled on "active" for consistency with the rest of the codebase: backend param is `include_active`, service helper is `_get_active_todo`, PRD talks about "active todos", the `ix_todos_active` DB index is named for active rows. Using `showActive` + `/show-active` / `/hide-active` avoids a terminology split between "current" at the UI layer and "active" everywhere else — one word, one concept. The rename was a late-draft product decision (see Change Log 2026-04-22 entry).

### Integration with Story 2.4 / 2.5 completion + deletion animations

When a user completes or deletes a pad from the popup (Stories 2.4, 2.5), an in-flight animation runs over ~1.6s. During that time the pad is tracked in `completingTodos` / `deletingTodos` store maps and rendered via `PondScene.renderTodos` even after the backend mutation removes it from `useTodos`. After the animation ends, the in-flight entry is cleared and the pad disappears — because `useTodos` now returns a list without it, AND the default visibility is active-only.

With 3.3, if `showCompleted=true` when a pad is completed: the animation runs, the in-flight entry clears, and the `useTodos` refetch (triggered by `useCreateTodo.onSuccess` / `useUpdateTodo.onSuccess`) now returns the pad WITH `completed=true`. It re-renders via the "completed" visual treatment (green-tinted, 0.45 opacity). No animation seams — the animation ends at `uAlpha=0` and the re-fetch renders the terminal state at `uAlpha=0.45`, which reads as a ghost settling into memory. This is a **happy accident** of the existing handoff, not something we need to wire explicitly. If the reviewer sees a visible seam (e.g., a frame of 0 alpha before the 0.45 appears), consider a brief fade-in on the completed/deleted visual — defer if not observed.

### Project Structure Notes

- New files:
  - [frontend/src/utils/slashCommands.ts](frontend/src/utils/slashCommands.ts) — **generic framework**: `SlashCommand` / `WorldSnapshot` types, `registerCommand`, `findCommand`, `availableCommands`, `walkState`, `parseSlashCommands`, `clearRegistry` (test-only). Visibility-agnostic. Future command categories import this file.
  - [frontend/src/utils/slashCommands.test.ts](frontend/src/utils/slashCommands.test.ts) — framework unit tests using fake test commands (no dependency on the real visibility set).
  - [frontend/src/utils/visibilityCommands.ts](frontend/src/utils/visibilityCommands.ts) — **the 3.3-scope concrete commands**: `/show-active`, `/hide-active`, `/show-completed`, `/hide-completed`, `/show-deleted`, `/hide-deleted`, `/show-all`, `/hide-all`. Exports `registerVisibilityCommands()`.
  - [frontend/src/utils/visibilityCommands.test.ts](frontend/src/utils/visibilityCommands.test.ts) — unit tests for the 8 concrete registrations (`isConsumable`, `project`, `execute` each).
  - [frontend/src/components/ui/TodoInput.test.tsx](frontend/src/components/ui/TodoInput.test.tsx) — TodoInput dual-mode + autocomplete + `initialValue`-seed tests.
  - [frontend/src/api/todoApi.test.ts](frontend/src/api/todoApi.test.ts) — query-key derivation + invalidation tests.
  - [frontend/src/hooks/useKeyboardShortcuts.test.ts](frontend/src/hooks/useKeyboardShortcuts.test.ts) — `/` shortcut guards + `preventDefault` / `stopImmediatePropagation` assertions; existing Enter path regression.
- Modified files:
  - [frontend/src/stores/usePondStore.ts](frontend/src/stores/usePondStore.ts) — `showActive` / `showCompleted` / `showDeleted` slices + `setVisibility` action.
  - [frontend/src/stores/usePondStore.test.ts](frontend/src/stores/usePondStore.test.ts) — 3 visibility-action tests.
  - [frontend/src/api/todoApi.ts](frontend/src/api/todoApi.ts) — query-key per-visibility-triple; query-fn emits `include_*` params; mutations invalidate the prefix.
  - [frontend/src/components/ui/TodoInput.tsx](frontend/src/components/ui/TodoInput.tsx) — accept `initialValue?: string` prop + controlled `value` (re-seeded from `initialValue` on open) + `highlightIdx` state; caret placed at `value.length`; dropdown render; extended `handleKeyDown` (Enter dispatches slash chain OR creates todo; Arrow/Tab nav).
  - [frontend/src/components/ui/TodoInput.css](frontend/src/components/ui/TodoInput.css) — `.todo-input-dropdown` + `.todo-input-dropdown__*` rules.
  - [frontend/src/components/pond/LilyPad.tsx](frontend/src/components/pond/LilyPad.tsx) — `visualState` memo + branched uniform writes + non-active click gate.
  - [frontend/src/components/pond/LilyPad.test.tsx](frontend/src/components/pond/LilyPad.test.tsx) — extend or create for visual-treatment + click-gate tests.
  - [frontend/src/hooks/useCameraResetOnDoubleEscape.ts](frontend/src/hooks/useCameraResetOnDoubleEscape.ts) — read todos via `getQueriesData` prefix, dedupe by id.
  - [frontend/src/hooks/useCameraResetOnDoubleEscape.test.ts](frontend/src/hooks/useCameraResetOnDoubleEscape.test.ts) — mixed-visibility cache-entry test.
  - [backend/src/services/todo_service.py](backend/src/services/todo_service.py) — flag-driven `list_todos` signature + filter assembly.
  - [backend/src/api/todos.py](backend/src/api/todos.py) — route handler accepts Query params.
  - [backend/tests/test_todos.py](backend/tests/test_todos.py) — 5 permutation tests.
  - [frontend/src/main.tsx](frontend/src/main.tsx) — import + call `registerVisibilityCommands()` exactly once before `ReactDOM.createRoot(...).render(...)`.
  - [frontend/src/App.tsx](frontend/src/App.tsx) — hold `inputInitial: string` alongside `inputOpen`; pass `initialValue` into `<TodoInput>`; `useKeyboardShortcuts` callback now takes `(initial: string) => void`.
  - [frontend/src/hooks/useKeyboardShortcuts.ts](frontend/src/hooks/useKeyboardShortcuts.ts) — handle `/` alongside Enter with the same guards; callback takes `initialValue`; `/` path calls `preventDefault` + `stopImmediatePropagation`.
  - [frontend/src/hooks/usePondSearchKeyboard.ts](frontend/src/hooks/usePondSearchKeyboard.ts) — one-line carve-out: `if (e.key === '/' && !state.searchActive) return;` before the printable-char branch, with a Story 3.3 cross-reference comment.
- No DB migrations, no schema changes. `archived` column and the `ix_todos_active` index (see [backend/src/models/todo.py:78-83](backend/src/models/todo.py#L78-L83)) are unchanged.

### References

- FR2, FR8, FR14, FR38 (the PRD baseline this story extends) — [_bmad-output/planning-artifacts/prd.md](../planning-artifacts/prd.md) (lines 289, 295, 307, 343)
- Epic 3 definition — [_bmad-output/planning-artifacts/epics.md](../planning-artifacts/epics.md) (lines 392–440); this story is net-new, not listed there.
- PondInput convention (Enter-to-submit) — [frontend/src/components/ui/TodoInput.tsx:35-52](../../frontend/src/components/ui/TodoInput.tsx#L35-L52)
- Keyboard shortcut + guards — [frontend/src/hooks/useKeyboardShortcuts.ts](../../frontend/src/hooks/useKeyboardShortcuts.ts)
- Backend filter baseline — [backend/src/services/todo_service.py:38-53](../../backend/src/services/todo_service.py#L38-L53)
- DB model + `ix_todos_active` index — [backend/src/models/todo.py:59-89](../../backend/src/models/todo.py#L59-L89)
- useCameraResetOnDoubleEscape (Story 3.1 load-bearing) — [frontend/src/hooks/useCameraResetOnDoubleEscape.ts](../../frontend/src/hooks/useCameraResetOnDoubleEscape.ts)
- LilyPad uniform-writing patterns (Stories 4.1 / 5.3) — [frontend/src/components/pond/LilyPad.tsx](../../frontend/src/components/pond/LilyPad.tsx)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — invoked via `/bmad-dev-story` on 2026-04-22.

### Debug Log References

- Backend: 110 pytest, ruff + mypy clean.
- Frontend: 259 vitest across 26 files, `npx tsc -b` clean.
- Initial `useTodos` selector returned a fresh object per render — hit infinite re-render in tests. Fixed by wrapping the selector in `useShallow` from `zustand/react/shallow`.
- Existing LilyPad test JSX harness doesn't provide a real `THREE.Group`, so the (now-removed) `fadePadMaterials` effect guarded against `group.traverse` being undefined. Effect was later pulled entirely per product direction.

### Completion Notes List

- Backend `list_todos(db, include_active, include_completed, include_deleted)` preserves the pre-3.3 contract for no-param callers (active-only) and returns `[]` when all three flags are false. 10 new permutation tests (5 service + 5 route).
- Generic slash-command framework (`slashCommands.ts`) holds the registry + walker + parser. Eight visibility commands ship in `visibilityCommands.ts` — the reference implementation for future command categories. `main.tsx` calls `registerVisibilityCommands()` exactly once at bootstrap.
- `useTodos` keys per visibility triple `['todos', 'list', { active, completed, deleted }]`; mutations invalidate the prefix `['todos', 'list']` so every cached combination refetches.
- ESC-ESC camera-reset hook now reads every cache entry under the `TODOS_KEY` prefix and de-dupes todos by id, covering the new per-triple keying without regressing 3.1.
- TodoInput gains dual-mode: slash-prefix input dispatches `parseSlashCommands` on Enter; non-slash Enter falls through to todo-create. Autocomplete dropdown filters by the trailing fragment and navigates via Arrow/Tab.
- Global `/` shortcut opens TodoInput pre-filled with `/`. `useKeyboardShortcuts` calls `stopImmediatePropagation` and `usePondSearchKeyboard` gets a one-line carve-out so an inactive search never claims the keystroke.
- **Product revision mid-implementation**: the initial plan greyed out / desaturated completed+deleted pads and gated their click handler. Per product direction, that was pulled — completed/deleted pads now render at full pad body color/opacity and **remain interactive**. Their *halo* swaps to HDR green / HDR red (via the existing ambient-glow block in `LilyPad.useFrame`) so status reads at a glance regardless of palette. The click handler is unchanged; the popup opens as usual.
- **ActionPopup** now reads the todo state and swaps the button label: "Complete" → "Uncomplete" for `todo.completed`, "Delete" → "Undelete" for `todo.deleted`. PondScene's `handleComplete` / `handleDelete` branch on the state and fire the reverse mutation: PATCH `{ completed: false }` for uncomplete (existing route works because `_get_active_todo` filters on `deleted==false`), and `POST /api/todos/:id/restore` for undelete (new route + service `restore_todo` that bypasses the active filter). Color change and grouping remain available.
- Backend restore: `restore_todo` service + `POST /api/todos/:id/restore` route + service test + route test (round-trip + 404). New `useRestoreTodo` hook follows the existing `useUpdateTodo` mutation pattern (clearTodoError onMutate/onSuccess, setTodoError onError, prefix-invalidate on success).
- **Search scope broadened**: `GET /api/search` gains `include_active` / `include_completed` / `include_deleted` query params (same defaults as `GET /api/todos`). Both `_run_fts` and `_run_vector` build a dynamic `visibility` SQL fragment; the defence-in-depth ORM re-fetch uses a matching `_apply_visibility_orm_filter`. 4 new service tests assert each permutation matches only the visible pads. Frontend `useSearch` now selects the visibility triple from the store via `useShallow`, embeds it in the query key, and includes the flags as URL params — switching visibility invalidates the search cache for the same text.

### File List

**Added (frontend)**
- [frontend/src/utils/slashCommands.ts](../../frontend/src/utils/slashCommands.ts)
- [frontend/src/utils/slashCommands.test.ts](../../frontend/src/utils/slashCommands.test.ts)
- [frontend/src/utils/visibilityCommands.ts](../../frontend/src/utils/visibilityCommands.ts)
- [frontend/src/utils/visibilityCommands.test.ts](../../frontend/src/utils/visibilityCommands.test.ts)
- [frontend/src/api/todoApi.test.ts](../../frontend/src/api/todoApi.test.ts)

**Modified (frontend)**
- [frontend/src/stores/usePondStore.ts](../../frontend/src/stores/usePondStore.ts) — `showActive` / `showCompleted` / `showDeleted` slices + `setVisibility` action
- [frontend/src/stores/usePondStore.test.ts](../../frontend/src/stores/usePondStore.test.ts) — visibility slice tests
- [frontend/src/api/todoApi.ts](../../frontend/src/api/todoApi.ts) — `todosQueryKey` helper, per-triple `useTodos` query key, `useRestoreTodo` hook, prefix-invalidation
- [frontend/src/hooks/useCameraResetOnDoubleEscape.ts](../../frontend/src/hooks/useCameraResetOnDoubleEscape.ts) — reads every visibility cache entry via `getQueriesData`, de-dupes by id
- [frontend/src/hooks/useCameraResetOnDoubleEscape.test.ts](../../frontend/src/hooks/useCameraResetOnDoubleEscape.test.ts) — mixed-visibility regression test
- [frontend/src/hooks/useKeyboardShortcuts.ts](../../frontend/src/hooks/useKeyboardShortcuts.ts) — callback now takes `initialValue`, handles `/` alongside `Enter` with same guards + stopImmediatePropagation
- [frontend/src/hooks/useKeyboardShortcuts.test.ts](../../frontend/src/hooks/useKeyboardShortcuts.test.ts) — new `/` path + guard assertions
- [frontend/src/hooks/usePondSearchKeyboard.ts](../../frontend/src/hooks/usePondSearchKeyboard.ts) — one-line `/` carve-out before printable-char branch
- [frontend/src/hooks/usePondSearchKeyboard.test.ts](../../frontend/src/hooks/usePondSearchKeyboard.test.ts) — `/` carve-out tests
- [frontend/src/components/ui/TodoInput.tsx](../../frontend/src/components/ui/TodoInput.tsx) — controlled `value`, `initialValue` prop, autocomplete dropdown, slash-command dispatch on Enter, Arrow/Tab nav
- [frontend/src/components/ui/TodoInput.test.tsx](../../frontend/src/components/ui/TodoInput.test.tsx) — dropdown gate, dispatch, autocomplete, initialValue seed tests
- [frontend/src/components/ui/TodoInput.css](../../frontend/src/components/ui/TodoInput.css) — `.todo-input-shell` wrapper + `.todo-input-dropdown*` rules
- [frontend/src/components/ui/ActionPopup.tsx](../../frontend/src/components/ui/ActionPopup.tsx) — Complete/Delete labels swap to Uncomplete/Undelete based on `todo.completed` / `todo.deleted`
- [frontend/src/components/ui/ActionPopup.test.tsx](../../frontend/src/components/ui/ActionPopup.test.tsx) — label-swap tests
- [frontend/src/components/pond/LilyPad.tsx](../../frontend/src/components/pond/LilyPad.tsx) — `visualState` memo; ambient glow block uses HDR green/red for completed/deleted pads (pad body/opacity unchanged)
- [frontend/src/components/pond/LilyPad.test.tsx](../../frontend/src/components/pond/LilyPad.test.tsx) — historical pads remain interactive (popup opens)
- [frontend/src/components/pond/PondScene.tsx](../../frontend/src/components/pond/PondScene.tsx) — `handleComplete` / `handleDelete` branch on `todo.completed` / `todo.deleted` to fire the reverse mutation (PATCH `{completed:false}` / `restoreTodo.mutate`)
- [frontend/src/components/pond/PondScene.test.tsx](../../frontend/src/components/pond/PondScene.test.tsx) — mock now exposes `useRestoreTodo`
- [frontend/src/App.tsx](../../frontend/src/App.tsx) — `inputInitial` state + `openInput(initial)` wiring
- [frontend/src/main.tsx](../../frontend/src/main.tsx) — call `registerVisibilityCommands()` at bootstrap

**Modified (frontend — search scope)**
- [frontend/src/api/searchApi.ts](../../frontend/src/api/searchApi.ts) — reads visibility triple via `useShallow`, includes in query key + URL params
- [frontend/src/hooks/usePondSearchSync.test.ts](../../frontend/src/hooks/usePondSearchSync.test.ts) — updated GET assertions to include the three flags

**Modified (backend)**
- [backend/src/services/todo_service.py](../../backend/src/services/todo_service.py) — flag-driven `list_todos` + `restore_todo` service
- [backend/src/api/todos.py](../../backend/src/api/todos.py) — Query-param route handler + `POST /api/todos/:id/restore`
- [backend/src/services/search_service.py](../../backend/src/services/search_service.py) — flag-driven `hybrid_search` / `_run_fts` / `_run_vector` + shared `_visibility_sql_clause` / `_apply_visibility_orm_filter` helpers
- [backend/src/api/search.py](../../backend/src/api/search.py) — Query-param route handler propagating visibility flags to the service
- [backend/tests/services/test_todo_service.py](../../backend/tests/services/test_todo_service.py) — 5 permutation tests + 2 restore tests
- [backend/tests/services/test_search_service.py](../../backend/tests/services/test_search_service.py) — 4 visibility-aware search tests + updated `_run_fts`/`_run_vector` call sites
- [backend/tests/api/test_todos.py](../../backend/tests/api/test_todos.py) — 5 permutation tests + 2 restore round-trip tests

**Modified (artifacts)**
- [_bmad-output/implementation-artifacts/sprint-status.yaml](../../_bmad-output/implementation-artifacts/sprint-status.yaml) — 3-3 ready-for-dev → in-progress → review

### Review Findings

_To be filled during code review._

### Change Log

| Date       | Change                                                                                                                      | Author              |
|------------|-----------------------------------------------------------------------------------------------------------------------------|---------------------|
| 2026-04-22 | Initial story draft. Net-new scope: introduces slash-command visibility toggles over the PRD's active-only default.         | Claude Opus 4.7     |
| 2026-04-22 | Product decisions resolved: (a) ignore dirty-seed / null-position rows — truncate table if needed, no backwards-compat; (b) `/show-completed ` (trailing space) parses same as no-space; (c) mid-chain autocomplete uses the accumulated virtual world via `walkState`. | Claude Opus 4.7 |
| 2026-04-22 | Reframed to a generic slash-command framework (registry + `SlashCommand` protocol in `slashCommands.ts`) with the eight visibility commands as the first category registration (`visibilityCommands.ts`). Future `/delete-all`, `/find`, etc. register into the same framework without touching the parser. | Claude Opus 4.7 |
| 2026-04-22 | Added global `/` shortcut (AC #10): pressing `/` on an idle pond opens TodoInput pre-filled with `/`, dropdown fully visible — one keypress, not two. `useKeyboardShortcuts` + App.tsx + TodoInput updated; `usePondSearchKeyboard` gets a one-line carve-out so an inactive search no longer claims `/`. | Claude Opus 4.7 |
| 2026-04-22 | Renamed `/show-current` / `/hide-current` → `/show-active` / `/hide-active` (plus store slice `showCurrent` → `showActive`) for consistency with backend `include_active`, `_get_active_todo`, PRD "active todos", `ix_todos_active` DB index. | Claude Opus 4.7 |
| 2026-04-22 | Implemented Tasks 1–9. Backend: flag-driven `list_todos` + permutation tests. Frontend: generic slash-command framework + eight visibility commands + `/` global shortcut + TodoInput autocomplete + query-key-per-triple + ESC-ESC hook rework. Backend 110 / frontend 259 / tsc clean / ruff clean / mypy clean. | Claude Opus 4.7 |
| 2026-04-22 | Product revision: removed the grey/desaturated visual treatment for completed+deleted pads. Pads now keep full body color + opacity; only the halo swaps to HDR green / HDR red. Click handler ungated — completed/deleted pads re-open the ActionPopup. | Claude Opus 4.7 |
| 2026-04-22 | ActionPopup: Complete/Delete labels swap to Uncomplete/Undelete for completed/deleted pads. PondScene handlers branch on state: uncomplete via PATCH `{completed:false}`; undelete via new `POST /api/todos/:id/restore` endpoint + `useRestoreTodo` hook. Color change + grouping remain available on historical pads. | Claude Opus 4.7 |
| 2026-04-22 | Search scope broadened: `GET /api/search` now respects the visibility triple and matches every visible pad (active + completed + deleted, as toggled). | Claude Opus 4.7 |
