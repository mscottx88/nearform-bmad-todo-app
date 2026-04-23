# Story 5.6: Cluster-Aware Search — RETIRED

Status: retired

> **⚠️ RETIRED (2026-04-23).** FR20 was removed from the PRD per
> `planning-artifacts/sprint-change-proposal-2026-04-23.md`. This
> story depended on `todo.groupId` which no longer exists in the
> schema. No code was ever merged for this story; this file is
> retained as historical reference only.

> **Captures PRD FR20** (retired): "Matching clusters surface as units with matching members highlighted and non-matching siblings faded."
>
> This story depends on Story 4.6 (lily pad clustering) landing first — specifically `todo.groupId` existing on the `Todo` type and in the search response, and the `matchingGroupIds` concept described below.
>
> **What ships:**
> 1. **`matchingGroupIds` store slice** — a `Set<string>` populated by `usePondSearchSync` after each search response. Contains the `groupId` of every group that has at least one matching member.
> 2. **LilyPad grouped-sibling visual** — a pad that does not directly match search, but is in a group that DOES have a match, surfaces at a reduced saturation (`0.35`) instead of submerging to `0`. The matching sibling(s) in the same group continue to surface at full score-derived saturation.
> 3. **Cluster surfaces as a unit** — the combined effect is that an entire cluster rises when any member matches. Non-matching members read as "present but dimmer", making the cluster visually legible as a unit.
> 4. **Clean restore** — when search clears (Escape), `matchingGroupIds` is cleared alongside `searchResults`; all pads restore to resting state together.
>
> **No backend changes needed.** The search endpoint already returns `Todo` objects (which will carry `groupId` after story 4.6). Group membership is derived from the search response itself — no extra query.
>
> **Dependency on story 4.6**: this story assumes `Todo.groupId: string | null` exists in `frontend/src/types/index.ts` and that the backend includes `group_id` in `TodoResponse`. If 4.6 hasn't landed, this story cannot be implemented. The implementation must be sequenced after 4.6.

---

## Frontend conventions (recap)

- **State reads in `useFrame`**: LilyPad already reads store state imperatively inside `useFrame` to avoid re-rendering on every search keystroke. Follow the exact same pattern for `matchingGroupIds`: `usePondStore.getState().matchingGroupIds.has(todo.groupId)`.
- **`searchSaturation`**: the existing float ref (`searchSaturationRef`) that LilyPad lerps each frame. Currently it goes to `sqrt(score)` for matches and `0` for non-matches. This story adds a third value: `GROUPED_SIBLING_SATURATION = 0.35` for pads that are non-matching siblings of a matched cluster member.
- **`usePondSearchSync`**: the hook that applies search responses to the store. FR20's `matchingGroupIds` computation lives in the same `applySearchResponse` function that already computes `searchResults`. The search response's `results` array contains full `Todo` objects (post-4.6 these carry `groupId`), so no extra query is needed.
- **Testing**: follow the existing `usePondSearchSync.test.ts` pattern (real timers for response handling). LilyPad visual state is tested via `searchSaturationRef` snapshots; use the existing LilyPad test file structure.

---

## Story

As a user,
I want matching search results to surface entire lily pad clusters when any member matches,
so that I can see groupings stay coherent during search rather than having cluster members scatter between surfaced and submerged states.

---

## Acceptance Criteria

### Store slice

1. **Given** a search response arrives with results, **When** `applySearchResponse` processes it, **Then** `matchingGroupIds: Set<string>` in the store is set to contain the `groupId` of every todo in the results whose `groupId` is non-null. Order does not matter; uniqueness is guaranteed by `Set`.

2. **Given** search is cleared (Escape / empty input), **When** the store resets `searchActive` to false, **Then** `matchingGroupIds` is also cleared to `new Set()` — same timing as `searchResults` is cleared.

3. **Given** the search response uses the `ftsSupported=false` (all-matches) path (`searchAllMatches=true`), **Then** `matchingGroupIds` is irrelevant (all pads surface regardless). The store may set it to `new Set()` or leave it unchanged; LilyPad's `searchAllMatches` check takes priority and never reads `matchingGroupIds`.

### LilyPad search saturation

4. **Given** search is active and a pad directly matches (its id is in `searchResults`), **Then** its `searchSaturation` is `sqrt(score)` as before — unchanged behavior.

5. **Given** search is active and a pad does NOT directly match, but its `todo.groupId` is non-null and is present in `matchingGroupIds`, **Then** its `searchSaturation` is `GROUPED_SIBLING_SATURATION = 0.35`. The pad surfaces (does not submerge) but reads as visually dimmer than the directly-matching sibling(s). The lerp toward this target uses the existing `RIDE_LERP = 0.08` so the transition is smooth.

6. **Given** search is active and a pad does NOT match and either (a) has no `groupId`, or (b) its group has no matching members, **Then** its `searchSaturation` is `0` — submerges as before.

7. **Given** `searchAllMatches=true` (FTS-unsupported query), **Then** all pads — including grouped non-matching siblings — surface at full saturation. No change from current behavior; `matchingGroupIds` is not consulted.

### Cluster as a unit

8. **Given** a cluster has N pads and M of them match (M ≥ 1, M < N), **When** search is active, **Then** all N pads surface: the M matching pads surface at score-derived saturation, the remaining (N-M) pads surface at `0.35` saturation. No pad in a matched cluster submerges.

9. **Given** a cluster has N pads and NONE match, **When** search is active, **Then** all N pads submerge (saturation → 0). Cluster behaves identically to N independent non-matching pads.

10. **Given** a cluster has N pads and ALL match, **When** search is active, **Then** all N pads surface at their individual score-derived saturations. The `matchingGroupIds` path is not needed in this case (each pad has a direct hit); the direct-match branch covers it.

### Restore

11. **Given** search is active and clusters are surfaced/dimmed per above, **When** the user presses Escape to clear search, **Then** all pads — including former grouped siblings at `0.35` saturation — smoothly lerp back to their resting saturation (`1.0`) via the existing `RIDE_LERP` path. No new restore logic is needed; clearing `matchingGroupIds` and `searchActive` is sufficient.

### Quality gate

12. **Given** the full test suite runs after this story, **Then** all existing tests remain green plus new tests cover: `applySearchResponse` populates `matchingGroupIds` from result `groupId`s, `matchingGroupIds` is empty when cleared, LilyPad `searchSaturation` is `GROUPED_SIBLING_SATURATION` for a non-matching pad in a matched group, LilyPad `searchSaturation` is `0` for a non-matching pad in an unmatched group.

---

## Tasks / Subtasks

- [ ] **Task 1: Store slice — `matchingGroupIds`** (AC: #1–#3)
  - [ ] In `frontend/src/stores/usePondStore.ts`, add to `PondState`:
    ```ts
    /**
     * Story 5.6 (FR20): set of groupIds that have ≥ 1 member in the current
     * search results. Populated by usePondSearchSync alongside searchResults.
     * Empty when search is inactive.
     */
    matchingGroupIds: Set<string>;
    ```
  - [ ] Add action `setMatchingGroupIds: (ids: Set<string>) => void`.
  - [ ] Initialise `matchingGroupIds: new Set()`.
  - [ ] Extend `setSearchResults` action (or the existing store wiring) so clearing the search also clears `matchingGroupIds`. Look at where `searchActive` is set to `false` — clear `matchingGroupIds` at the same point. Current clearing happens via `usePondSearchKeyboard.ts` or the Escape path in `usePondSearchSync` (when `searchActive` goes false, the sync hook flushes `debouncedQuery` to `''` which triggers a `setSearchResults` with empty results). The cleanest point: extend `setSearchResults` so that when `results.size === 0 && !allMatches`, it also clears `matchingGroupIds`. OR add a separate `clearMatchingGroupIds` call inside `applySearchResponse` (Task 2).
  - [ ] Tests in `usePondStore.test.ts`: `setMatchingGroupIds` populates the Set; calling with `new Set()` clears it.

- [ ] **Task 2: `usePondSearchSync` — populate `matchingGroupIds`** (AC: #1–#3)
  - [ ] In `frontend/src/hooks/usePondSearchSync.ts`, extend `applySearchResponse` to extract group IDs from the response:
    ```ts
    function applySearchResponse(data: SearchResponse): void {
      if (!usePondStore.getState().searchActive) return;
      const { setSearchResults, setMatchingGroupIds } = usePondStore.getState();

      if (data.ftsSupported === false) {
        setSearchResults({ results: new Map(), allMatches: true, vectorUnavailable: data.vectorSearchUnavailable });
        setMatchingGroupIds(new Set());  // irrelevant in all-match mode, but keep clean
        return;
      }

      const results = new Map<string, SearchHit>();
      const matchingGroupIds = new Set<string>();
      for (const r of data.results) {
        results.set(r.todo.id, { score: r.score, matchType: r.matchType });
        if (r.todo.groupId) matchingGroupIds.add(r.todo.groupId);
      }
      setSearchResults({ results, allMatches: false, vectorUnavailable: data.vectorSearchUnavailable });
      setMatchingGroupIds(matchingGroupIds);
    }
    ```
  - [ ] `SearchResult.todo` carries `groupId` (type `string | null`) after Story 4.6. The `SearchResult` type and `SearchResponse` types are in `frontend/src/types/index.ts`. Verify `SearchResult.todo` is typed as `Todo` (it is — see [types/index.ts:43-47](frontend/src/types/index.ts#L43-L47)) and that `Todo.groupId` is present after Story 4.6 lands.
  - [ ] Tests in `usePondSearchSync.test.ts` (real timers suite):
    - New test: `populates matchingGroupIds when results include todos with groupId` — mock a response where one result has `groupId: 'g1'`, assert `usePondStore.getState().matchingGroupIds` contains `'g1'`.
    - New test: `matchingGroupIds is empty when results have no grouped todos` — all results have `groupId: null`.
    - New test: `matchingGroupIds is cleared on ftsSupported=false path` — assert it's `new Set()`.

- [ ] **Task 3: LilyPad — grouped-sibling saturation** (AC: #4–#11)
  - [ ] In `frontend/src/components/pond/LilyPad.tsx`, add a module-scope constant near the other search-related constants:
    ```ts
    // Story 5.6 (FR20): saturation for non-matching pads in a matched cluster.
    // 0.35 is below the minimum match score's sqrt (sqrt(0.3)≈0.55) so siblings
    // always read visually dimmer than the weakest real match.
    const GROUPED_SIBLING_SATURATION = 0.35;
    ```
  - [ ] Extend the `searchSaturation` block in `useFrame` (around line 1106–1122):
    ```ts
    let searchSaturation = 1;
    if (searchState.searchActive) {
      if (searchState.searchAllMatches) {
        searchSaturation = 1;
      } else if (searchHit !== undefined) {
        // Direct match — unchanged
        const rawScore = Number.isFinite(searchHit.score) ? searchHit.score : 0;
        searchSaturation = Math.sqrt(Math.max(0, rawScore));
      } else if (todo.groupId && searchState.matchingGroupIds.has(todo.groupId)) {
        // Story 5.6: grouped sibling — cluster surfaces as unit, this pad dimmed
        searchSaturation = GROUPED_SIBLING_SATURATION;
      } else {
        searchSaturation = 0;
      }
    }
    ```
  - [ ] The `todo.groupId` reference here reads from the `todo` prop (already available at the top of the component). No new subscription needed — it's a prop read, not a store subscription.
  - [ ] `searchState.matchingGroupIds` is read imperatively from `usePondStore.getState()` (same as `searchState.searchActive` and `searchState.searchAllMatches` already are on line 1105). No React re-render path.
  - [ ] Tests in `frontend/src/components/pond/LilyPad.test.tsx`: add a test that seeds `matchingGroupIds` with a group ID, renders LilyPad with a todo whose `groupId` matches, and asserts the search saturation logic path is entered correctly (the test environment stubs Three.js so we're testing the logic branch, not the visual output).

- [ ] **Task 4: Tests & quality gate** (AC: #12)
  - [ ] `npx vitest run` — all existing 259+ tests plus new tests green.
  - [ ] `npx tsc --noEmit` — no type errors.
  - [ ] Backend unchanged — no backend tests to run for this story specifically, but confirm `DATABASE_URL=...todo_pond_test python -m pytest tests/ -q` still passes.

---

## Dev Notes

### Why `matchingGroupIds` is computed from the response, not a join

The search response already includes full `Todo` objects for each result (`SearchResult.todo: Todo`). After Story 4.6, each `Todo` has `groupId`. So we can extract all matching group IDs directly from `data.results` — no need to cross-reference the todo cache. This keeps `applySearchResponse` self-contained and testable in isolation.

### Why `GROUPED_SIBLING_SATURATION = 0.35`

The minimum realistic match score from the hybrid search is around `0.3` (FTS weight 0.3 × a low-quality FTS match). `sqrt(0.3) ≈ 0.55`. Setting the sibling saturation to `0.35` ensures it is always visually below the weakest real match — the user can always distinguish "this pad matched" from "this pad is a sibling of something that matched".

### The `todo.groupId` access pattern in `useFrame`

`todo` is the component prop — it's captured in the closure at render time and does NOT update inside `useFrame` (React props don't change in a running `useFrame` callback). However, `todo.groupId` changes only when the todo's group membership changes, which requires a backend call + React Query invalidation + re-render. A re-render re-captures the new `todo` in the closure, so the `useFrame` callback picks up the updated `groupId` on the next render. This is identical to how `todo.color`, `todo.completed`, etc. are used in the same `useFrame` — the pattern is established and safe.

### Sequencing constraint

This story **must** be implemented after Story 4.6 has landed. Specifically:
- `Todo.groupId: string | null` must exist in `frontend/src/types/index.ts`
- The backend `TodoResponse` must include `group_id` in search results (the search endpoint returns `TodoResponse` objects inside `SearchResult`)
- `setMatchingGroupIds` must be added to the store

If 4.6 is still in progress, this story can be drafted but not implemented. The `GROUPED_SIBLING_SATURATION` constant and the store slice can be added as forward-compatible stubs if needed.

### Interaction with `searchAllMatches`

When `ftsSupported=false`, `searchAllMatches=true` and LilyPad takes the `searchSaturation = 1` path unconditionally. The `matchingGroupIds` check is inside the `else-if` chain and is never reached in this case. This is intentional: if every todo is a "match" (FTS unsupported), there are no non-matching siblings to consider.

### Deferred

- **Cluster surfaces/submerges as a unit in the elevation sense** — the UX spec (story 5.3) mentions clusters surfacing and submerging at the same elevation. Currently, the surface/submerge is driven by `searchSaturation` which affects glow scaling, not Y elevation directly. If the product wants clusters to physically rise and fall as a unit (not just glow), that would require a store slice tracking per-group target elevation and a cluster-elevation lerp — a follow-on polish story.
- **Cluster highlighted vs. sibling differentiation in the label** — the floating label above a cluster (from Story 4.6) does not change during search. If the label should highlight when the cluster is a match, that's a future polish pass.

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
- [ ] Committed at task checkpoints per CLAUDE.md
