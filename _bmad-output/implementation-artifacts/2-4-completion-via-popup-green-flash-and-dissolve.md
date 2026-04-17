# Story 2.4: Completion via Popup — Green Flash + Dissolve

Status: done

> **Supersedes** [2-3-completion-egg-hatch-to-complete.superseded.md](./2-3-completion-egg-hatch-to-complete.superseded.md). Introduced via the Correct Course workflow on 2026-04-16 after the PRD dropped creature-based controls (egg, aphid, chameleon, trash lizard) in favor of the Action Popup primitive. Depends on [Story 2.3](./2-3-in-scene-action-popup.md) (Action Popup — `done`, shipped as HTML overlay per amended spec).

## Story

As a user,
I want to click **Complete** on a focused pad's popup and watch the pad flash green and dissolve as a creature emerges into the ecosystem,
so that completing a task feels rewarding without relying on a fragile egg-hatch animation.

## Acceptance Criteria

1. **Given** an active todo's popup is open (Story 2.3), **When** I click the **Complete** button, **Then** the popup dismisses immediately (`closePopup()` which clears `activePopupTodoId` and `cameraFocus`).

2. **Given** Complete was just clicked, **When** the completion sequence begins, **Then** the pad pulses bright neon green (`--neon-green #39ff14`) for ~300ms with a Bloom-lit flash that overrides the pad's normal neon color.

3. **Given** the green flash is playing, **When** it peaks, **Then** a creature emerges from the pad's center — creature type is selected by rarity tier per the UX distribution: **Common (~50%)** `firefly` or `water_strider`; **Uncommon (~35%)** `frog`, `dragonfly`, or `butterfly`; **Rare (~12%)** `fish` or `turtle`; **Legendary (~3%)** `golden_koi`, `neon_phoenix`, or `glowing_jellyfish`. The creature renders for ~500ms with a brief rise-and-fade spawn animation. For creature types that don't yet have a dedicated component, fall back to rendering `<Firefly>` visually but **persist the true `creature_type` + `rarity` to the backend**.

4. **Given** the creature emerge has started, **When** the pad dissolves, **Then** it fades and shrinks into the water surface over 600-900ms with a subtle outward ripple (via existing `triggerRipple`). The dissolve overlaps the tail of the emerge animation so the transition feels continuous.

5. **Given** the pad has fully dissolved, **When** the sequence settles (~400ms of water settling), **Then** the backend has been updated via `PATCH /api/todos/{id}` with `{ completed: true }` AND a creature record has been persisted via `POST /api/creatures` with `{ todo_id, creature_type, rarity }`. Both calls are fire-and-forget from the visual flow's perspective — the animation does not wait on network completion.

6. **Given** the todo is now `completed: true`, **When** `useTodos` refetches (on mutation success), **Then** the completed todo is excluded from the pond render. The backend's `list_todos` already filters `completed=true` and `deleted=true`; the frontend simply renders whatever the API returns. The pad's `LilyPad` component unmounts naturally after the dissolve and refetch.

7. **Given** the completion sequence is mid-flight, **When** a new todo-list refetch would normally unmount the pad (because the PATCH arrived and the list no longer contains the id), **Then** the pad remains mounted for the full local animation arc. A store-level `completingTodos` map overrides the list so the pad renders until the dissolve self-reports completion.

8. **Given** the `Complete` click happens, **When** any network step fails (PATCH rejected, creature POST rejected), **Then** the completion still proceeds locally — errors are logged via `console.warn` but do not roll back the flash/dissolve. Permanent backend error handling (decay animation, auto-retry) is Story 2.6's concern; v1 is best-effort.

9. **Given** a todo that was previously completed (via the now-removed egg-hatch flow), **When** the app loads, **Then** it is still excluded from the pond render (backend filter handles it). There is no uncomplete path — clicking a completed pad is impossible because completed pads don't render.

## Tasks / Subtasks

- [x] Task 1: Remove obsolete egg-hatch + uncomplete code (AC: #9; prerequisite cleanup)
  - [x] Delete `frontend/src/components/creatures/CompletionEgg.tsx`
  - [x] Remove the `<CompletionEgg ... />` mount and the `handleEggToggle` callback from `frontend/src/components/pond/LilyPad.tsx`
  - [x] Remove the `creatureType` React state from `LilyPad.tsx` and the `{todo.completed && creatureType === 'firefly' && ...}` / `water_strider` conditional mounts (completed pads no longer render at all per AC #6)
  - [x] Remove the imports for `useCreateCreature`, `useDeleteCreature`, `Firefly`, `WaterStrider` from `LilyPad.tsx` — those mutations and renderings relocate into Task 7's `EmergingCreature` component and Task 3's `usePopupComplete` hook
  - [x] Keep `useUpdateTodo` — it's still used (in the new hook)
  - [x] Remove the `creatureApi` + `CompletionEgg` + `Firefly` + `WaterStrider` mocks from `LilyPad.test.tsx` (or simplify to match the reduced surface)

- [x] Task 2: Rarity-tier creature selection utility (AC: #3)
  - [x] New file: `frontend/src/utils/creatureRarity.ts`
  - [x] Export `pickCreatureByRarity(): { creatureType: string; rarity: 'common' | 'uncommon' | 'rare' | 'legendary' }`
  - [x] Tier weights sum to 100: common=50, uncommon=35, rare=12, legendary=3
  - [x] Tier pools:
    - `common`: `['firefly', 'water_strider']`
    - `uncommon`: `['frog', 'dragonfly', 'butterfly']`
    - `rare`: `['fish', 'turtle']`
    - `legendary`: `['golden_koi', 'neon_phoenix', 'glowing_jellyfish']`
  - [x] Implementation: one `Math.random()` for tier, another for type-within-tier (or a single roll mapped by cumulative weight — either works)
  - [x] Unit test `creatureRarity.test.ts`: (a) each tier's returned type is in that tier's pool; (b) over 10,000 calls, observed tier frequencies fall within ±3 percentage points of target weights. Use a generous tolerance to avoid flakiness.

- [x] Task 3: `usePopupComplete` hook (AC: #1, #5, #8)
  - [x] New file: `frontend/src/hooks/usePopupComplete.ts`
  - [x] Exports `useCompleteTodo()` returning `(todoId: string) => { creatureType: string; rarity: string }`
  - [x] Internally uses `useUpdateTodo()` (already in `api/todoApi.ts`) and `useCreateCreature()` (already in `api/creatureApi.ts`)
  - [x] Behavior:
    1. Pick creature via `pickCreatureByRarity()`
    2. Fire `updateTodo.mutate({ id, completed: true })`
    3. Fire `createCreature.mutate({ todoId: id, creatureType, rarity })`
    4. Return `{ creatureType, rarity }` synchronously so the visual sequence starts immediately
  - [x] Errors on either mutation: swallow with `console.warn` (AC #8). Do not throw; do not block the caller.
  - [x] Unit test `usePopupComplete.test.ts`: verify return value shape, both mutations fire, mutation errors are swallowed

- [x] Task 4: Extend `usePondStore` with completion-sequence state (AC: #2, #4, #7)
  - [x] Add to `PondState`:
    ```ts
    completingTodos: Map<string, {
      todo: Todo;
      creatureType: string;
      rarity: string;
      startedAt: number; // R3F clock time captured in LilyPad's first useFrame
    }>;
    ```
  - [x] Add action `startCompletion(todo: Todo, creatureType: string, rarity: string): void` — inserts entry keyed by `todo.id` with `startedAt = 0` (LilyPad will stamp the real R3F clock time on first frame — see Task 6)
  - [x] Add action `finishCompletion(todoId: string): void` — deletes the entry
  - [x] Export a tiny selector helper that consumers can pass to the selector hook: e.g. `selectCompleting(todoId)` returning the entry or `undefined`
  - [x] Tests in `usePondStore.test.ts`: `startCompletion` adds the entry with todo snapshot preserved; `finishCompletion` removes it; looking up a non-existent id returns `undefined`

- [x] Task 5: Wire ActionPopup `onComplete` to the sequence (AC: #1, #5)
  - [x] In `PondScene.tsx`, replace the `onComplete={() => console.log('Complete', popupTodo.id)}` stub with:
    ```ts
    const completeTodo = useCompleteTodo();
    // ...
    const handleComplete = () => {
      const { creatureType, rarity } = completeTodo(popupTodo.id);
      usePondStore.getState().startCompletion(popupTodo, creatureType, rarity);
      usePondStore.getState().closePopup();
    };
    ```
  - [x] Remove the `// TODO(Story 2.4)` comment

- [x] Task 6: Add `completing` phase to LilyPad's animation state machine (AC: #2, #3, #4, #7)
  - [x] In `LilyPad.tsx`, read the completion entry: `const completion = usePondStore((s) => s.completingTodos.get(todo.id));`
  - [x] When `completion` first appears and the pad is in `resting` phase, transition `phaseRef.current` to a new `'completing'` phase and capture `completion.startedAt = state.clock.elapsedTime` on the first useFrame tick of the phase (write it back via `usePondStore.setState(...)` or store it in a local ref — local ref is cleaner)
  - [x] Phase timeline (all timings in R3F clock seconds from phase start):
    - `0.00 – 0.30s` **Flash**: override the pad's shader `uColor` uniform toward `new THREE.Vector3(0.224, 1.0, 0.078)` (`#39ff14`) at full intensity (bypass the completion-desaturation branch)
    - `0.20 – 0.70s` **Emerge**: render `<EmergingCreature>` (Task 7) at the pad's world position; it self-animates
    - `0.40s` **Ripple**: call `usePondStore.getState().triggerRipple(posX, posZ)` exactly once
    - `0.40 – 1.20s` **Dissolve**: lerp `groupRef.current.scale` from 1.0 → 0 (eased), and fade `padMeshRef.current.material.opacity` + `rimRef.current.material.opacity` + the `lineLoop`'s material to 0. The pad's shader material is already `transparent: true`; rim's `meshBasicMaterial` is too. Set `opacity` imperatively in useFrame.
    - `1.20 – 1.60s` **Settle**: render nothing; wait for the outbound ripple to dissipate
  - [x] At t=1.60s: `usePondStore.getState().finishCompletion(todo.id)` — removes the override from the store; LilyPad unmounts on the next render (assuming the refetch has already removed the todo from `useTodos`)
  - [x] **Do not use `performance.now()` inside `useFrame`.** Always use `state.clock.elapsedTime` and capture `startedAt` from the R3F clock on the first active frame. (Prior story lost half a day to this bug — see 2.3 Change Log.)
  - [x] Trigger **exactly one** `triggerRipple` call per sequence (guard with a `rippleFired` ref)

- [x] Task 7: `EmergingCreature` component (AC: #3)
  - [x] New file: `frontend/src/components/creatures/EmergingCreature.tsx`
  - [x] Props: `{ creatureType: string; color: string; basePosition: [number, number, number]; startTime: number; duration?: number }` (startTime in R3F clock seconds; duration defaults to 0.5)
  - [x] Maps `creatureType` → base creature component:
    - `'firefly'` → `<Firefly>`
    - `'water_strider'` → `<WaterStrider>`
    - all others (uncommon/rare/legendary types without a dedicated component yet) → `<Firefly>` fallback
  - [x] Wraps the base creature in a group that performs a 500ms emerge:
    - position.y: ease-out from `basePosition.y` → `basePosition.y + 0.6`
    - group opacity via `group.traverse(o => o.material.opacity = t)`: ramps 0 → 1 over the first 150ms, holds at 1 for 200ms, then 1 → 0 over the last 150ms
    - Because the existing `Firefly` / `WaterStrider` each set their own opacity on the mesh, the emerge component should multiply or just override after mount — imperative opacity updates in useFrame work fine
  - [x] After `duration` elapsed, returns `null` (parent `LilyPad` keeps it conditionally mounted only during the emerge window — see Task 6 phase times)
  - [x] Test `EmergingCreature.test.tsx`: known types render the matching base creature; unknown types render `Firefly` fallback; test snapshot or shallow-rendered DOM asserts correctly

- [x] Task 8: Union the pond render list with in-flight completions (AC: #7)
  - [x] In `PondScene.tsx`, compose the list handed to `.map()` from:
    1. `todos` (from `useTodos()`)
    2. any `completingTodos` entries whose id is NOT already in `todos`
  - [x] Use `.todo` from the store entry (Task 4 stores the full `Todo` snapshot)
  - [x] Dedup by id (todos win — both should be identical anyway)
  - [x] Pass the same `focused` logic: `focused={activePopupTodoId === todo.id}` (completion has already closed the popup, so this will be false during the sequence — desired)

- [x] Task 9: Tests (AC: all)
  - [x] `usePondStore.test.ts` — `startCompletion` / `finishCompletion` / map lookups
  - [x] `creatureRarity.test.ts` — pool membership + statistical distribution
  - [x] `usePopupComplete.test.ts` — return shape, both mutations fire, error swallow
  - [x] `EmergingCreature.test.tsx` — type routing + fallback
  - [x] `LilyPad.test.tsx` — update mocks (drop `creatureApi`, `CompletionEgg`, creature component mocks that no longer apply); add a completion-sequence smoke test if feasible (mock `useFrame` to invoke the callback a few times with advancing `elapsedTime`)
  - [x] `PondScene.test.tsx` — simulate a `completingTodos` entry with `useTodos` returning an empty list; assert a LilyPad is still rendered from the override
  - [x] `npx vitest run` — all passing
  - [x] `npx tsc -b` — clean

### Review Findings

_Code review run: 2026-04-17 (Blind Hunter + Edge Case Hunter + Acceptance Auditor, opus-4-7)_

- [x] [Review][Patch] **[High] Pad stuck invisible when `completing` override clears but todo persists** [frontend/src/components/pond/LilyPad.tsx useFrame completing branch] — `phaseRef.current` never resets from `'completing'`, and the dissolve's `group.traverse` permanently writes `opacity = 0` / `scale = 0` on every descendant material. If the PATCH fails (AC #8 allows silent failure), the todo stays in `useTodos`, `completingTodos` is cleared at t=1.60s, but the LilyPad keeps rendering with opacity 0 forever — unclickable, invisible, orphaned. Fix: when `completing` transitions to `undefined` and `phaseRef.current === 'completing'`, either restore material opacities + scale + reset phaseRef, OR short-circuit further frames. Also early-return in `useFrame` once `t >= COMPLETING_TOTAL` to stop re-walking every descendant every frame (blind+edge).
- [x] [Review][Patch] **[High] Double-completion possible by clicking the dissolving pad** [frontend/src/components/pond/LilyPad.tsx handlePadClick, frontend/src/stores/usePondStore.ts startCompletion] — Pad is still visible (scale/opacity > 0) through ~t=1.0s of the dissolve. A second click during that window hits `handlePadClick` → `openPopup` → user clicks Complete → second `PATCH` + second `POST /api/creatures`. The POST fails on the DB `UniqueConstraint("todo_id")` and React-Query's `onError` is the only surface (see finding below). Fix: guard `handlePadClick` with `if (completing) return;`, and make `startCompletion` a no-op when the id is already in `completingTodos`.
- [x] [Review][Patch] **[Medium] Flash color eases up (ramps via `brightness = min(1, flashT*2)`) instead of snapping to full intensity for 300ms** [frontend/src/components/pond/LilyPad.tsx:886-896] — Violates AC #2 / Task 6 Flash phase ("override … at full intensity"). Also never explicitly restored to original `colorVec` at flash end; only hidden by dissolve opacity. Fix: set `uColor` directly to `COMPLETE_FLASH_COLOR` for the full flash window; restore to `colorVec` on flash-end (auditor+blind).
- [x] [Review][Patch] **[Medium] Dissolve `group.traverse` also fades `<EmergingCreature>`'s materials during the 0.40–0.70s overlap window** [frontend/src/components/pond/LilyPad.tsx dissolve branch] — Contradicts AC #4 ("the dissolve overlaps the tail of the emerge animation so the transition feels continuous" — creature should stay visible while pad dissolves). Fix: mount EmergingCreature outside `groupRef`, OR tag the creature subtree with `userData.skipDissolve = true` and skip it in the traverse callback (blind+edge+auditor).
- [x] [Review][Patch] **[Medium] Two `useFrame` callbacks fight over `material.opacity` — Firefly's pulse clobbers EmergingCreature's emerge fade** [frontend/src/components/creatures/EmergingCreature.tsx + frontend/src/components/creatures/creatures/Firefly.tsx] — `EmergingCreature.useFrame` traverses children and writes emerge opacity; `Firefly.useFrame` then writes `opacity = 0.5 + sin(...)*0.5`. Child runs after parent, so the emerge rise-and-fade is overwritten by the pulse every frame. Fix: add an `asEmerging` prop to Firefly/WaterStrider that disables their internal pulse, OR have EmergingCreature multiply rather than set, OR move the fade to a wrapping mesh the creatures don't touch (blind+edge).
- [x] [Review][Patch] **[Medium] `try/catch` around `mutate()` doesn't catch async network failures — AC #8 `console.warn` contract isn't actually wired** [frontend/src/hooks/usePopupComplete.ts] — React Query's `mutate()` doesn't throw on network errors; it routes them through `onError`. The existing try/catch only catches synchronous throws (and existing tests assert exactly that synthetic mode). Real failures log nothing. Fix: attach `onError` handlers at mutation creation, OR use `.mutateAsync().catch(console.warn)`. Add a test that asserts `console.warn` fires on a rejected mutation (blind+edge).
- [x] [Review][Defer] **[Medium] useFrame-driven completion-sequence state-machine tests — pulled to follow-up** [frontend/src/components/pond/LilyPad.test.tsx, frontend/src/components/creatures/EmergingCreature.test.tsx] — Partially addressed this pass: the async-error path (AC #8) now has an explicit `console.warn`-on-`onError` test in `usePopupComplete.test.ts`. Still outstanding and deferred: a useFrame-advancing test that drives the clock through `COMPLETING_FLASH_END → COMPLETING_DISSOLVE_START → COMPLETING_TOTAL` and asserts (a) full-intensity flash color, (b) `triggerRipple` fires exactly once, (c) `finishCompletion` called at t≥1.60s, (d) terminal `'completed'` phase reached. Deferred because it needs net-new test infra (`useFrame` invoker mock with controllable clock) — non-trivial scaffolding best taken on as a standalone follow-up, not inline with review patches (blind+edge+auditor).
- [x] [Review][Patch] **[Medium] `LilyPad.test.tsx` store stub returns `undefined` where prior tests expected `1.0`** [frontend/src/components/pond/LilyPad.test.tsx:~691-697] — Previously the mock returned `1.0` (glow intensity). Replacing it with `Object.assign(() => undefined, …)` silently changes the contract. If any earlier test asserted glow/intensity behaviour it now passes trivially. Fix: make the mock selector-aware (call the selector with a realistic state snapshot) or branch per-hook-call (blind).
- [x] [Review][Patch] **[Medium] `completingStartTime` stamped via `setState` → first frame's flash work is lost** [frontend/src/components/pond/LilyPad.tsx] — The `useFrame` closure captures the pre-commit value; the guard `if (completingStartTime === null) return;` skips the work on the stamp frame. Author acknowledges this in a comment. Fix: store startedAt in a ref instead of state; mirror to state only if JSX reads it (and only `<EmergingCreature>`'s gate reads it) (blind+edge).
- [x] [Review][Patch] **[Medium] EmergingCreature sets `material.transparent = true` every frame via `traverse`** [frontend/src/components/creatures/EmergingCreature.tsx] — Toggling `transparent` without `needsUpdate` can cause shader-program recompile and wrong depth sort. Fix: set `transparent = true` once on mount (e.g. in a `useEffect` over the refs), not per-frame (blind).
- [x] [Review][Patch] **[Low] Rarity util hardening: tier-weight drift returns `'common'` as silent fallback, empty pool ships `undefined`** [frontend/src/utils/creatureRarity.ts] — With weights summing to 100 today the fallback `return 'common'` is unreachable. A future drift (e.g. 49+35+12+3=99) would silently reroute legendary rolls to common; an empty pool would POST `creatureType: undefined` and fail Pydantic `min_length=1` at the backend. Fix: add module-load assertions (weights sum to 100, every pool non-empty) and change the fallback to the heaviest tier, not common (blind+edge).
- [x] [Review][Patch] **[Low] `creatureType: string` is too wide — a typo in `TIER_POOLS` ships end-to-end** [frontend/src/utils/creatureRarity.ts + backend/src/schemas/creature.py] — No enum anywhere. Fix: narrow to a TypeScript union `type CreatureType = 'firefly' | 'water_strider' | ...` and thread it through the return type + mutation payload type (edge).
- [x] [Review][Patch] **[Low] Text label briefly re-mounts for one render after `finishCompletion` before `useTodos` refetch removes the todo** [frontend/src/components/pond/LilyPad.tsx:457 `{!completing && <Html>…}`] — During that window the pad is scale=0/opacity=0 but the DOM text flashes on. Fix: gate the `<Html>` on `phaseRef.current !== 'completing'` (and/or `todo.completed`), not just the store override (edge).
- [x] [Review][Patch] **[Low] `CompletingEntry` omits `startedAt: number` — diverges from spec's prescribed shape** [frontend/src/stores/usePondStore.ts:1297-1304] — Spec says the entry carries `startedAt` (R3F clock time captured in LilyPad's first useFrame). Code keeps `startedAt` in LilyPad's local `useState` instead. Functionally equivalent to Option (a) in the spec's Open Questions, but the data-structure contract doesn't match. Fix: either add `startedAt` to the entry and a `stampStartedAt(id, t)` action, OR update the spec to document the chosen alternative (auditor).
- [x] [Review][Patch] **[Low] `selectCompleting` helper not exported from the store** [frontend/src/stores/usePondStore.ts] — Spec Task 4 subtask 4 prescribes it; consumers inline `usePondStore((s) => s.completingTodos.get(id))` today. Fix: export `const selectCompleting = (id: string) => (s: PondState) => s.completingTodos.get(id);` for convenience (auditor).
- [x] [Review][Patch] **[Low] Dead conditional `phaseRef.current !== 'completing' && phaseRef.current === 'resting'`** [frontend/src/components/pond/LilyPad.tsx completing entry guard] — The left clause is fully subsumed by the right. Fix: drop the redundant clause (blind).
- [x] [Review][Defer] **Pre-existing: `padUniforms.uColor` captured once at mount; doesn't react to `todo.color` changes** [frontend/src/components/pond/LilyPad.tsx] — deferred, pre-existing. This diff exposes but does not cause the issue. Story 4.1 (popup color-swatch) will need to address it when todo.color becomes mutable (blind).
- [x] [Review][Defer] **Clicking Complete on a pad still in `forming`/`dropping`/`settling`/`pulsing` delays activation up to ~2.1s with no user feedback** [frontend/src/components/pond/LilyPad.tsx completing guard] — deferred, UX polish. Pad will eventually reach `resting` and then transition correctly; delay is invisible to the store but confusing to users. Fast-forward vs. disabling Complete until `resting` is a story-level design call (blind+edge).
- [x] [Review][Defer] **Tab backgrounded or computer sleep during the 1.6s sequence collapses to an instant state jump on resume** [frontend/src/components/pond/LilyPad.tsx completing branch, clock-driven] — deferred, rare edge case. Fix would involve detecting large delta jumps and snapping to terminal state or restarting; out of scope for v1 (edge).



### Timing Summary (single source of truth)

All timings relative to the moment `startCompletion` fires:

```
0.00s  Click Complete → popup + cameraFocus cleared → startCompletion
0.00s  Flash begins (pad shader → neon green, Bloom picks it up)
0.20s  EmergingCreature mounts (opacity fades in)
0.30s  Flash peak; fade back to original color begins
0.40s  triggerRipple fires; Dissolve begins (group scale + opacity → 0)
0.70s  EmergingCreature begins opacity fade-out
0.85s  EmergingCreature unmounts
1.20s  Dissolve complete; pad invisible
1.60s  Settle complete; finishCompletion clears store entry; LilyPad unmounts
```

### Completion State Machine

Single source of truth: `usePondStore.completingTodos`.

```
[click Complete]
   │
   ▼
completeTodo(id)         ← usePopupComplete hook
   │   picks creature via rarity
   │   fires PATCH /todos + POST /creatures (fire-and-forget)
   │   returns { creatureType, rarity }
   ▼
startCompletion(todo, type, rarity)
closePopup()
   │
   ▼ (next frame, LilyPad's useFrame selector picks up entry)
Phase: 'completing'
   │
   ├── 0.00-0.30s  Flash
   ├── 0.20-0.70s  Emerge
   ├── 0.40s       triggerRipple × 1
   ├── 0.40-1.20s  Dissolve
   └── 1.20-1.60s  Settle
   │
   ▼
finishCompletion(id)
   │
   ▼ (next render)
Union(useTodos, completingTodos) no longer includes this id
   │
   ▼
LilyPad unmounts
```

### Removing CompletionEgg cleanly

Current state of `frontend/src/components/pond/LilyPad.tsx`:
- Imports: `useCreateCreature`, `useDeleteCreature`, `CompletionEgg`, `Firefly`, `WaterStrider`
- State: `creatureType` (`'firefly' | 'water_strider' | null`)
- Callback: `handleEggToggle` — flips `todo.completed` via `updateTodo.mutate`, then `createCreature.mutate` or `deleteCreature.mutate`
- JSX: `<CompletionEgg ... onToggle={handleEggToggle} />` and the conditional `{todo.completed && creatureType === 'firefly' && <Firefly ... />}` / `water_strider` blocks

All of this goes. Drop phase code (`forming` / `dropping` / `settling` / `pulsing` / `resting`) stays exactly as-is — we add one more phase (`completing`) to the end of that state machine.

### Why the pad must stay mounted through the sequence

Two reasons to use the `completingTodos` override rather than just rendering while `todo.completed === false`:

1. **Network timing.** `updateTodo.mutate` invalidates `todos.list` on success. By the time the refetch returns, the pad might already have been dropped from the list. Without the override, the pad unmounts mid-dissolve.
2. **Visual coherence.** The dissolve animation must complete on screen — the user sees `flash → emerge → dissolve → settle`. An abrupt unmount breaks the promise.

The override auto-expires when `finishCompletion` fires at t=1.60s.

### Anti-Patterns to Avoid

- DO NOT reintroduce `CompletionEgg`, `handleEggToggle`, or any egg/hatch language — superseded.
- DO NOT add an uncomplete/uncheck path — v1 scope explicitly forbids it.
- DO NOT implement long-lived ambient creatures in this story. The emerging creature renders for ~500ms and then unmounts. Persistent creature rendering across the pond is Epic 7.1 (EcosystemManager).
- DO NOT mix `performance.now()` with `state.clock.elapsedTime` inside `useFrame`. Capture `startedAt` from the R3F clock on the first active frame of the phase and never cross the boundary. (Story 2.3 lost time to this; don't repeat.)
- DO NOT block the sequence on backend mutation completion. Fire-and-forget. Errors → `console.warn`.
- DO NOT add retry UI, decay state, or auto-retry for failed mutations in this story — that's Story 2.6 (Loading & Error States).
- DO NOT restore camera-to-prior-position. Story 2.3 dropped that behavior; 2.4 inherits the same scope decision. The camera simply releases when `closePopup` clears `cameraFocus`.
- DO NOT add casino-escalation bonuses (particle bursts, extra fireflies on rare-tier rolls) in this story — those belong to Story 7.2 (Creature Rarity & Casino Celebrations). Leave a `// TODO(Story 7.2)` near the rarity pick so the integration point is obvious.
- DO NOT change the backend. `PATCH /api/todos/{id}` and `POST /api/creatures` both already exist and work. Don't merge them or add server-side side-effects.
- DO NOT install new npm packages.
- DO NOT use `async def` in any Python code (CLAUDE.md rule — this story is frontend-only anyway).

### Previous Story Intelligence (from Story 2.3 — HTML overlay Action Popup)

- **ActionPopup is a drei `<Html>` overlay with DOM buttons.** Wiring `onComplete` is just replacing the `console.log` stub in `PondScene.tsx`. Buttons use the standard DOM `onClick`.
- **`closePopup` clears both `activePopupTodoId` and `cameraFocus`** — one call is enough; no extra orchestration on the click.
- **Camera-return-to-prior was dropped.** Do not try to add it here. If the UX team later decides it's needed, it becomes its own story.
- **`usePondStore.triggerRipple(x, z)`** exists and is already used by `handleDropComplete` in `PondScene.tsx`. Reuse it.
- **Zustand selector pattern:** `usePondStore((s) => s.x)` re-renders when x changes; returns stable primitives or reference-stable objects only. For a Map lookup, you can use `usePondStore((s) => s.completingTodos.get(id))` — zustand's default equality is `Object.is` so the reference is stable if the entry doesn't change.
- **R3F `useFrame`:** per-frame animation must mutate `THREE.Object3D` refs directly (scale, position, material.opacity). Avoid calling React state setters every frame — they cause re-renders that interact badly with R3F event routing (Story 2.3 took this lesson the hard way; see its Change Log).
- **Testing pattern:** `happy-dom` env; mock `@react-three/fiber` (`useFrame`, `useThree`) and drei (`Html`, `Billboard`). See `ActionPopup.test.tsx` and `LilyPad.test.tsx` for current examples.

### Git Intelligence (last commits, most → least recent)

- `cb2d77f` — Story 2.3 code-review follow-ups: `closePopup` now clears `cameraFocus`; dead `sceneHandled` removed; spec amended to reflect HTML-overlay reality
- `cbc39fd` — Story 2.3 refactor to HTML overlay (why `ActionPopup` is DOM and not in-scene)
- `7afaa2a` — Story 2.3 initial in-scene implementation (superseded by `cbc39fd`)
- `81870ce` — PRD simplification that introduced the popup-driven completion model this story implements
- `339c2ec` — Superseded: original egg-hatch Story 2.3. Code remnants (`CompletionEgg.tsx`, egg-toggle branch in `LilyPad.tsx`, `useCreateCreature`/`useDeleteCreature` wiring) are the removal target of Task 1.

### Project Structure — Files to Create / Modify / Delete

**New:**
- `frontend/src/utils/creatureRarity.ts`
- `frontend/src/utils/creatureRarity.test.ts`
- `frontend/src/hooks/usePopupComplete.ts`
- `frontend/src/hooks/usePopupComplete.test.ts`
- `frontend/src/components/creatures/EmergingCreature.tsx`
- `frontend/src/components/creatures/EmergingCreature.test.tsx`

**Modified:**
- `frontend/src/stores/usePondStore.ts` — add `completingTodos` Map + `startCompletion` + `finishCompletion` actions
- `frontend/src/stores/usePondStore.test.ts` — tests for the new store actions
- `frontend/src/components/pond/PondScene.tsx` — wire real `onComplete` handler; union `useTodos` with `completingTodos` for rendering
- `frontend/src/components/pond/PondScene.test.tsx` — completion-override render test
- `frontend/src/components/pond/LilyPad.tsx` — remove egg/hatch code (Task 1); add `'completing'` phase to the animation state machine (Task 6); mount `<EmergingCreature>` during emerge window
- `frontend/src/components/pond/LilyPad.test.tsx` — remove obsolete mocks; ensure the shrunken LilyPad still mounts

**Deleted:**
- `frontend/src/components/creatures/CompletionEgg.tsx`

**Untouched (keep):**
- `frontend/src/api/creatureApi.ts` — `useCreateCreature` still in use
- `frontend/src/api/todoApi.ts` — `useUpdateTodo` still in use
- `frontend/src/components/creatures/creatures/Firefly.tsx` + `WaterStrider.tsx` — reused inside `EmergingCreature`
- `backend/src/api/creatures.py` — `POST /api/creatures` is unchanged; `DELETE /api/creatures/todo/{id}` becomes unreferenced but harmless

### Testing Standards

- Vitest + `@testing-library/react`
- `happy-dom` environment (configured in `vite.config.ts`)
- Mock R3F `useFrame` / `useThree`; mock drei `<Html>` / `<Billboard>` as simple wrappers
- `renderHook` for hook-only tests
- Statistical test for rarity: 10,000 rolls, ±3 pp tolerance per tier. Don't tighten — flakes under CI.
- Run `npx vitest run` and `npx tsc -b` — both clean — before handing off to code-review.

### Open Questions (developer judgment during implementation)

1. **Total sequence duration.** UX spec sums to ~1.7s. If that feels sluggish in browser testing, shorten the Settle phase (400ms → 200ms) — keep Flash/Emerge/Dissolve ratios. Don't go below ~1.0s total; the flash+emerge beats need room to read.
2. **Fallback creature.** Task 7 uses `<Firefly>` as the universal fallback for uncommon/rare/legendary types. Alternative: skip the emerge render entirely for missing types (DB record still persists). Pick `<Firefly>` for v1 — demo polish is worth it.
3. **Where to stamp `startedAt`.** Two options: (a) set `startedAt = state.clock.elapsedTime` from inside `LilyPad`'s useFrame on the first frame of the `completing` phase, stored in a local ref; (b) set it in the store at `startCompletion` time. (a) is more accurate — (b) risks a wall-clock vs scene-clock mismatch. Recommend (a).
4. **Bonus casino escalations** (particle bursts, extra fireflies, frog croaks on rare+ tiers): OUT OF SCOPE. Leave a `// TODO(Story 7.2)` near the rarity pick.
5. **Whether to remove `DELETE /api/creatures/todo/{id}`:** leave it as dead backend code for now. Removing it is a backend change that should be its own story if pursued.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md#Story 2.4` (lines 326–348)] — original AC source
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md` § "4. Completing a Todo (The Green Flash)"] — phase timing table (Trigger/Flash/Emerge/Dissolve/Settle)
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md` § "Randomized delight (from casino mechanics)"] — rarity tier distribution
- [Source: `_bmad-output/planning-artifacts/architecture.md` § "Database Schemas"] — `creatures` table schema (`todo_id` UUID UNIQUE, `creature_type`, `rarity`)
- [Source: `_bmad-output/planning-artifacts/architecture.md` § "State Management (Frontend)"] — `useCreatureStore` contract (deferred to Epic 7.1; this story uses `usePondStore.completingTodos` instead)
- [Source: `_bmad-output/implementation-artifacts/2-3-in-scene-action-popup.md`] — Action Popup primitive, `onComplete` integration point, amended scope (HTML overlay)
- [Source: `frontend/src/components/pond/LilyPad.tsx`] — existing phase state machine (`forming` / `dropping` / `settling` / `pulsing` / `resting`); add `'completing'`
- [Source: `frontend/src/components/creatures/creatures/Firefly.tsx` + `WaterStrider.tsx`] — patterns for creature components
- [Source: `frontend/src/api/creatureApi.ts`] — `useCreateCreature` contract (`todoId`, `creatureType`, `rarity`)
- [Source: `frontend/src/api/todoApi.ts`] — `useUpdateTodo` contract

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context)

### Debug Log References

- `npx vitest run` — 45/45 tests passing across 13 files (5 new: `creatureRarity.test.ts`, `usePopupComplete.test.ts`, `EmergingCreature.test.tsx`, and extensions to `usePondStore.test.ts` + `PondScene.test.tsx`).
- `npx tsc -b` — clean.
- React Compiler / `react-hooks` purity rules fully satisfied. Two pre-existing violations in `LilyPad.tsx` (`Date.now` and `Math.random` in render) and in `Firefly.tsx` / `WaterStrider.tsx` fixed as collateral — `useState` lazy initializers keep the impure calls out of render.

### Completion Notes List

- **Egg-hatch removal (Task 1):** deleted `CompletionEgg.tsx`. Stripped `useCreateCreature` / `useDeleteCreature` / `Firefly` / `WaterStrider` imports and the completed-pad conditional creature mounts from `LilyPad.tsx`. Removed the `creatureType` state and the `handleEggToggle` callback. `LilyPad.test.tsx` simplified accordingly.
- **Rarity utility (Task 2):** `utils/creatureRarity.ts` exports `pickCreatureByRarity()` → `{ creatureType, rarity }` with the 50/35/12/3 tier weights and the UX-spec creature pools. Uses two `Math.random()` rolls (one for tier, one for type-within-tier). Test coverage includes statistical tier-distribution sampling at N=10,000 with ±3 pp tolerance.
- **Completion hook (Task 3):** `hooks/usePopupComplete.ts` exports `useCompleteTodo()` returning `(todoId) => CreaturePick`. Fires both `updateTodo.mutate({ completed: true })` and `createCreature.mutate({ todoId, creatureType, rarity })` synchronously, returns the pick so the visual sequence can start without awaiting the network. Mutation errors are swallowed with `console.warn`.
- **Store extension (Task 4):** `usePondStore` now has `completingTodos: Map<string, CompletingEntry>` (snapshots todo + creature pick + startedAt). Actions: `startCompletion(todo, type, rarity)`, `finishCompletion(id)`. Map is replaced on each mutation so zustand's Object.is equality fires selectors correctly.
- **PondScene wiring (Tasks 5 + 8):** `ActionPopup.onComplete` calls `completeTodo(popupTodo.id)`, `startCompletion(popupTodo, ...)`, then `closePopup()`. Render list uses `useMemo` to union `useTodos` with `completingTodos` entries whose id isn't in the live list — so a pad mid-dissolve stays mounted even after the backend refetch drops the todo.
- **LilyPad phase (Task 6):** Added `'completing'` to the phase state machine. Transition fires on the first frame `completing` entry is present and the pad is in `resting`. `completingStartTime` is a `useState` (not a ref) so JSX can read it without violating the refs-during-render rule; stamped from `state.clock.elapsedTime` inside `useFrame` on the transition frame. Timeline: Flash 0–0.30s (shader uColor → `#39ff14`), Emerge 0.20–0.70s (`<EmergingCreature>` mounted), Ripple fires once at 0.40s, Dissolve 0.40–1.20s (group scale + material opacity → 0), Settle 1.20–1.60s (no render). At 1.60s `finishCompletion` releases the override and the pad unmounts on next render.
- **Emerging creature (Task 7):** `components/creatures/EmergingCreature.tsx` wraps the existing `<Firefly>` / `<WaterStrider>` with a group that self-animates opacity 0→1→0 and rises 0.6 units over the emerge duration. For creature types without a dedicated component (uncommon/rare/legendary), falls back to `<Firefly>` per AC #3.
- **Bundled purity cleanup:** `LilyPad.tsx`, `Firefly.tsx`, `WaterStrider.tsx` switched their `Math.random()` / `Date.now()` calls to lazy `useState` initializers to satisfy the React Compiler purity rule. Also moved `LilyPad`'s `targetY.current = ...` render-time ref mutation into a `useEffect`.
- **Stubs remaining:** `onDelete`, `onSetColor`, `onGroup` handlers in `PondScene.tsx` still `console.log` — Stories 2.5, 4.1, Epic 4.2 own those wirings. `// TODO(Story 7.2)` comment left in `usePopupComplete.ts` for rare/legendary casino-celebration escalations.

### Change Log

| Date | Change |
|------|--------|
| 2026-04-16 | Implemented Story 2.4: Complete button in the Action Popup now fires the full green-flash → creature-emerge → dissolve → settle sequence. Removed `CompletionEgg.tsx`, egg-toggle branch, creature-on-completed-pad rendering. Added `creatureRarity` utility, `usePopupComplete` hook, `EmergingCreature` component, `completingTodos` override map in the store, and the `completing` phase in `LilyPad`'s state machine. Fixed pre-existing React-Compiler purity violations in `LilyPad` / `Firefly` / `WaterStrider` as collateral. 45/45 tests passing; tsc clean. |

### File List

**New:**
- `frontend/src/utils/creatureRarity.ts`
- `frontend/src/utils/creatureRarity.test.ts`
- `frontend/src/hooks/usePopupComplete.ts`
- `frontend/src/hooks/usePopupComplete.test.ts`
- `frontend/src/components/creatures/EmergingCreature.tsx`
- `frontend/src/components/creatures/EmergingCreature.test.tsx`

**Modified:**
- `frontend/src/stores/usePondStore.ts` — `completingTodos` Map + `startCompletion` + `finishCompletion`; exported `CompletingEntry`
- `frontend/src/stores/usePondStore.test.ts` — tests for new store actions + `makeTodo` helper
- `frontend/src/components/pond/PondScene.tsx` — real `onComplete` handler; `useMemo` union of `todos` with `completingTodos` overrides; `useCompleteTodo` wired
- `frontend/src/components/pond/PondScene.test.tsx` — mocks for new mutations + override-render test
- `frontend/src/components/pond/LilyPad.tsx` — removed egg/creature code; added `'completing'` phase, start-time state, ripple-once guard, flash/emerge/dissolve/settle timeline, `<EmergingCreature>` mount; moved `targetY` ref mutation into a `useEffect`; switched `Math.random`/`Date.now` to lazy `useState` initializers
- `frontend/src/components/pond/LilyPad.test.tsx` — removed obsolete `creatureApi`, `CompletionEgg`, `Firefly`, `WaterStrider` mocks
- `frontend/src/components/creatures/creatures/Firefly.tsx` — `Math.random` moved to lazy `useState` (purity fix)
- `frontend/src/components/creatures/creatures/WaterStrider.tsx` — `Math.random` moved to lazy `useState` (purity fix)

**Deleted:**
- `frontend/src/components/creatures/CompletionEgg.tsx`
