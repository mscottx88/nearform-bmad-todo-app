# Story 5.3: Type-Anywhere Search with Surface/Submerge

Status: ready-for-dev

> **Scope note:** Third story of Epic 5 "Intelligent Search". Consumes the `GET /api/search?q=...` endpoint built in Story 5.2 and wires it to the pond UI: typing anywhere (outside a focused element) drives a debounced query; matching pads rise + glow, non-matches submerge + fade, the camera auto-frames the result cluster, and Escape restores everything. No backend changes in this story.

## Frontend conventions (recap)

- **State**: UI state + action primitives live in the zustand store [`usePondStore`](frontend/src/stores/usePondStore.ts). Server state lives in React Query (`@tanstack/react-query`) — we do NOT mirror server data into zustand.
- **Casing boundary**: [`frontend/src/api/client.ts`](frontend/src/api/client.ts) already handles snake_case ↔ camelCase via interceptors (`camelcase-keys` on responses, `decamelize-keys` on request bodies). Do NOT hand-convert casing in route/hook code.
- **Base URL**: `/api` (hardcoded — see the client.ts comment on why an env var is a footgun on Git Bash for Windows). Dev uses Vite proxy; prod assumes same-origin reverse proxy.
- **Query keys**: tuple-const pattern, e.g. `['todos', 'list'] as const`. New keys follow: `['search', q] as const` so each distinct query text has its own cache entry.
- **Keyboard**: follow [`useClosePopupOnEscape`](frontend/src/hooks/useClosePopupOnEscape.ts) — `window.addEventListener('keydown', ...)` inside a `useEffect`, with a focus-target guard that ignores events inside `<input>`, `<textarea>`, or `contenteditable`.
- **3D + HTML overlay coexistence**: the existing `ActionPopup` (Story 2.3) renders HTML absolute-positioned over the R3F canvas. Search UI follows the same pattern — the typed text overlay is HTML (easier styling + accessibility), the surface/submerge is R3F (LilyPad reads search state from the store each frame).

## Story

As a user,
I want to start typing anywhere to search — matching pads surface and glow, non-matches sink and fade, and the camera frames what I'm looking for,
So that finding a todo feels like speaking to the pond and watching it respond, without ever hunting for a search bar.

## Acceptance Criteria

1. **Given** the pond is mounted and no element has focus (no `<input>`/`<textarea>`/contenteditable), **When** the user presses a printable character key (letter/digit/punctuation/space), **Then** that character is appended to a `searchQuery` state. **Backspace** removes the last character. **Escape** clears `searchQuery` immediately and resets the pond. Key events are captured at the `window` level; events originating inside a focused input are ignored (same guard as `useClosePopupOnEscape`). **Modifier combos** (`Ctrl+C`, `Cmd+A`, `Alt+Tab`, etc.) are NOT captured — only bare printable characters and `Backspace`/`Escape`.

2. **Given** `searchQuery` is non-empty, **When** its value has been stable for **300 ms** (debounce per FR18), **Then** a React Query fires `GET /api/search?q=<encoded(searchQuery)>`. The query key is `['search', searchQuery] as const` so distinct queries are cached independently and back-and-forth typing returns instantly from cache. The existing `/api/client.ts` interceptors auto-convert response keys to camelCase.

3. **Given** the backend returns `SearchResponse { query, results: [{todo, score, matchType}], vectorSearchUnavailable, ftsSupported }`, **When** results arrive, **Then** the store is populated with a `searchResults: Map<string, SearchHit>` keyed by `todo.id` where `SearchHit = { score: number; matchType: "keyword"|"semantic"|"hybrid" }`. LilyPad instances whose `todo.id` is in the map are **matches**; all other LilyPads (in `useTodos`) are **non-matches**.

4. **Given** a LilyPad is a **match**, **When** `useFrame` runs, **Then** the pad lerps towards an **elevated Y offset** (`SURFACE_RISE_Y = +0.3`) and its ambient/focused glow strength lerps to **full** (`SEARCH_MATCH_GLOW = 0.35`, stronger than `AMBIENT_GLOW_STRENGTH = 0.22`). Opacity stays at 1.0. The match's existing color is preserved — do NOT tint the body or rim.

5. **Given** a LilyPad is a **non-match**, **When** `useFrame` runs, **Then** the pad lerps towards a **submerged Y offset** (`SUBMERGE_DROP_Y = -0.8`, below the water surface), its body opacity lerps to `SEARCH_NONMATCH_OPACITY = 0.28`, and its glow strength lerps to `0.0`. The lily pad mesh must respect the submerge by staying visible through a translucent blend, not culled. Pads that are mid-completion/deletion sequence DO NOT get the submerge treatment — their existing dissolve animation wins (search is read-only UX; it does not interrupt destructive writes).

6. **Given** a **match** cluster exists (any todos that are members of the same Group — forward-compat with Story 4.2; for 5.3 treat every todo as its own singleton cluster since groups aren't implemented yet), **When** results render, **Then** all matches rise as described in AC #4 regardless of their cluster context. The "clusters surface as units with matching members highlighted" FR20 semantics are **partially deferred** until Story 4.2 lands groups; for 5.3, the per-pad rise IS the cluster-surfacing behaviour (singleton clusters). Document this in Dev Notes.

7. **Given** `searchResults` is non-empty AND contains at least one match with a known `todo.positionX` / `todo.positionY` (not null), **When** results arrive, **Then** the store dispatches `focusCamera(cx, cz, zoom)` where `(cx, cz)` is the **centroid** of match positions and `zoom` is chosen to frame the bounding box of matches. Camera auto-frame uses the existing `PondCamera` lerp logic (`LERP_SPEED = 0.05`, `ARRIVE_THRESHOLD = 0.1`). If no match has a resolved position (all match positions are null), the camera does NOT move — leaving it in whatever state the user had it.

8. **Given** an **empty-result response** (results array is `[]`) AND `ftsSupported === true`, **When** the UI processes it, **Then** ALL live todos submerge (treat them all as non-matches per AC #5). Per the UX spec: *"Pond goes still. Water calms. No 'no results found' text — the stillness communicates it."* The search text stays visible on the water.

9. **Given** `ftsSupported === false` in the response (query was stop-words-only, emoji-only, punctuation-only, or a non-English language), **When** the UI processes it, **Then** ALL live todos are treated as **matches** (i.e., the pond renders normally with no search influence on the pads). The search text stays visible on the water surface so the user sees what they typed. No error UI — the silent render is the signal that the query isn't searchable.

10. **Given** `vectorSearchUnavailable === true` in the response (Google embedding API down), **When** the UI processes it, **Then** the response is used AS-IS — match-type "keyword" results still drive surface/submerge exactly the same way. A small, unobtrusive indicator appears near the search text: `"semantic search offline"` at 50% opacity in the same monospace font. No error modal, no retry button.

11. **Given** the user is typing, **When** each new keystroke lands, **Then** the search text appears on the water surface as an **HTML overlay** positioned just above the water-plane centre (pinned to the camera-facing top of the pond in screen space). Font: `monospace` system stack (matches the existing retro aesthetic — pick the stack from TodoInput's current CSS). Colour: `#00eeff` (same neon cyan as the default pad glow, per architecture doc's accent palette). The text has a subtle glow (CSS `text-shadow`) and is non-interactive (`pointer-events: none`). No `<input>` element is rendered — we capture keystrokes at the window level, NOT via a hidden text input.

12. **Given** the user presses **Escape**, **When** the handler runs, **Then** (a) `searchQuery` clears to `""`, (b) `searchResults` clears to an empty Map, (c) `cameraFocus` is cleared so `PondCamera`'s lerp returns to default, (d) all LilyPads lerp back to their resting Y and glow within the existing lerp speed. The full restore animation completes within **~400 ms** per the UX timeline. The search text dissolves from the water via CSS opacity transition (not an abrupt unmount) — use `transition: opacity 200ms ease-out` on the overlay.

13. **Given** the existing vitest suite + this story's new tests, **When** the suite runs, **Then** (a) all existing tests still pass (no regressions in `PondScene.test.tsx`, `TodoInput.test.tsx`, `useClosePopupOnEscape.test.ts`, `usePopupComplete.test.ts`, `usePopupDelete.test.ts`, popup-color-swatch tests, etc.), AND (b) new tests cover: debounce behaviour (type 3 chars rapidly → only the last triggers a query after 300 ms), Escape-clears-on-searchActive, ignore-keydown-when-input-focused, match-vs-non-match classification in the store, camera auto-frame centroid computation, empty-result-all-submerge behaviour, `vectorSearchUnavailable` badge render, `ftsSupported=false` treats-all-as-match behaviour.

14. **Given** the existing pond is rendering and a search is active, **When** the user clicks a surfaced pad (match), **Then** the existing click → popup → Complete/Delete/color flows all still work unchanged. Search is a **read-only overlay** on top of the pond — it does not interfere with any write path. Specifically: `POST /api/todos` (new-pad drop), popup actions, drag, camera scroll/pan all continue to function. The typing-to-search global handler must NOT fire when the popup is open (check `activePopupTodoId` inside the keydown guard — same pattern as the existing input-focus guard).

## Tasks / Subtasks

- [ ] Task 1: Extend types + API hook (AC: #2, #3)
  - [ ] Add `SearchHit`, `SearchResponse` types to [frontend/src/types/index.ts](frontend/src/types/index.ts):
    ```ts
    export type SearchMatchType = 'keyword' | 'semantic' | 'hybrid';
    export interface SearchHit { score: number; matchType: SearchMatchType; }
    export interface SearchResult { todo: Todo; score: number; matchType: SearchMatchType; }
    export interface SearchResponse {
      query: string;
      results: SearchResult[];
      vectorSearchUnavailable: boolean;
      ftsSupported: boolean;
    }
    ```
  - [ ] New file `frontend/src/api/searchApi.ts` with `useSearch(query: string, enabled: boolean)`:
    ```ts
    export function useSearch(query: string, enabled: boolean) {
      return useQuery({
        queryKey: ['search', query] as const,
        queryFn: async () => {
          const { data } = await apiClient.get<SearchResponse>('/search', { params: { q: query } });
          return data;
        },
        enabled: enabled && query.trim().length > 0,
        staleTime: 30_000, // type-back-and-forth returns instantly from cache for 30s
      });
    }
    ```

- [ ] Task 2: Extend `usePondStore` with search slices (AC: #1, #3, #12)
  - [ ] New state: `searchQuery: string`, `searchResults: Map<string, SearchHit>`, `searchActive: boolean`. `searchActive` derives from `searchQuery.length > 0`; include it as an explicit flag so LilyPads don't subscribe to the whole query string.
  - [ ] New actions:
    - `appendSearchChar(ch: string)` — appends one character to `searchQuery`; sets `searchActive=true` if transitioning from empty.
    - `backspaceSearch()` — drops the last character; sets `searchActive=false` if the result is empty.
    - `setSearchResults(results: Map<string, SearchHit>)` — replaces the results Map; called by the `useSearch` subscriber hook.
    - `clearSearch()` — resets `searchQuery=""`, `searchResults=new Map()`, `searchActive=false`, and `cameraFocus=null`.
  - [ ] Constants co-located with the existing `GLOW_INTENSITY` block: `SURFACE_RISE_Y = 0.3`, `SUBMERGE_DROP_Y = -0.8`, `SEARCH_MATCH_GLOW = 0.35`, `SEARCH_NONMATCH_OPACITY = 0.28`, `SEARCH_DEBOUNCE_MS = 300`.

- [ ] Task 3: Global type-anywhere keyboard hook `frontend/src/hooks/usePondSearchKeyboard.ts` (AC: #1, #12, #14)
  - [ ] Installs a `window` `keydown` listener inside a `useEffect([])`.
  - [ ] Guards:
    - Event target is `<input>`, `<textarea>`, or contenteditable → return (same check as `useClosePopupOnEscape`).
    - `activePopupTodoId !== null` (popup is open) → return. The popup captures its own keystrokes.
    - Modifier keys pressed (`e.ctrlKey || e.metaKey || e.altKey`) → return. Leaves OS shortcuts alone.
  - [ ] Dispatch table:
    - `e.key === 'Escape'` → `clearSearch()` + stop propagation.
    - `e.key === 'Backspace'` → `backspaceSearch()` + `e.preventDefault()` so the browser's "back" shortcut doesn't fire.
    - `e.key.length === 1` (printable character — letters, digits, punctuation, space) → `appendSearchChar(e.key)` + `e.preventDefault()`.
    - Anything else (arrows, F-keys, Tab, Enter) → return without consuming.
  - [ ] Mount this hook once in [PondScene.tsx](frontend/src/components/pond/PondScene.tsx) at top level.

- [ ] Task 4: Debounced-search subscriber `frontend/src/hooks/usePondSearchSync.ts` (AC: #2, #3, #7, #8, #9, #10)
  - [ ] Reads `searchQuery` from the store. Applies a 300 ms debounce (plain `useEffect` + `setTimeout` + cleanup; no external debounce lib needed).
  - [ ] Calls `useSearch(debouncedQuery, enabled=searchActive)`.
  - [ ] When `data` arrives, builds a `Map<string, SearchHit>` from `data.results` and calls `setSearchResults(map)`. Also:
    - If `data.ftsSupported === false`: set results to an "everything is a match" sentinel (use a special marker; LilyPad distinguishes via a second store flag `searchAllMatches: boolean` rather than faking `results.size === totalTodos`).
    - If `results.length === 0` and `ftsSupported === true`: set empty Map — LilyPads treat all as non-matches.
  - [ ] After results settle, compute centroid + zoom of matched pads with non-null positions and dispatch `focusCamera(cx, cz, zoom)`. If no matches or all positions are null, leave camera alone. Zoom heuristic: `zoom = max(8, bbox_diagonal * 1.2)`; document the choice in Dev Notes.

- [ ] Task 5: LilyPad submerge/rise behaviour (AC: #4, #5, #6, #13, #14)
  - [ ] Read from store: `searchActive`, this pad's hit via `searchResults.get(todo.id)`, and the `searchAllMatches` flag. Subscribe precisely — only this todo's hit, not the whole Map, to avoid re-renders on unrelated result changes (use a selector that returns `useShallow` or manual equality).
  - [ ] Compute `searchMode: 'none' | 'match' | 'nonmatch'`:
    - `!searchActive` → `'none'` (no influence).
    - `searchAllMatches` → `'match'` (AC #9 path).
    - `searchResults.has(todo.id)` → `'match'`.
    - else → `'nonmatch'`.
  - [ ] In the existing `useFrame` loop, compute target `extraY` and `extraOpacityDelta` based on `searchMode`. Lerp towards them with the existing frame-damping factor (reuse the same `smoothing` constant that phase/tilt already use for consistency).
  - [ ] `searchMode === 'nonmatch'` target: `extraY = SUBMERGE_DROP_Y`, body opacity `= SEARCH_NONMATCH_OPACITY`, glow strength `= 0`.
  - [ ] `searchMode === 'match'` target: `extraY = SURFACE_RISE_Y`, body opacity `= 1.0`, glow strength `= SEARCH_MATCH_GLOW`.
  - [ ] `searchMode === 'none'` target: `extraY = 0`, body opacity `= 1.0`, glow strength reverts to the existing focused/ambient logic.
  - [ ] **Hard guard**: if `phase` is `'completing'` or `'deleting'`, skip the search adjustments entirely — the existing dissolve animation is authoritative (AC #5's "dissolve wins" clause).

- [ ] Task 6: Search-text water overlay `frontend/src/components/pond/PondSearchOverlay.tsx` (AC: #11, #10, #12)
  - [ ] HTML div absolutely-positioned, pointer-events-none, anchored top-center relative to the viewport (`position: fixed; top: 15vh; left: 50%; transform: translateX(-50%);`). Matches the "water surface" visual region.
  - [ ] Renders `searchQuery` text in monospace with `text-shadow: 0 0 8px #00eeff`, color `#00eeff`, `font-size: 2rem`, `letter-spacing: 0.1em`. Pick the existing `font-family` from TodoInput.tsx for consistency.
  - [ ] Renders a small secondary line below (smaller font, 50% opacity) with `"semantic search offline"` when `vectorSearchUnavailable === true`. Rendered only while `searchActive`. Blank otherwise.
  - [ ] Root element has `opacity` bound to `searchActive ? 1 : 0` with `transition: opacity 200ms ease-out` — the dissolve on clear (AC #12).
  - [ ] Renders NOTHING (returns null) when `searchQuery === ""` AND the transition has completed (use `transitionend` or a simple timer; don't bother animating mount itself — only unmount fade).
  - [ ] Mounted once in [PondScene.tsx](frontend/src/components/pond/PondScene.tsx) outside the R3F `<Canvas>` (it's an HTML overlay, not a 3D element).

- [ ] Task 7: PondScene wire-up (AC: #1, #11, #14)
  - [ ] Call `usePondSearchKeyboard()` at top level.
  - [ ] Call `usePondSearchSync()` at top level (so React Query runs on debounced query).
  - [ ] Render `<PondSearchOverlay />` outside `<Canvas>`.
  - [ ] NO other JSX changes. LilyPad's internal `useFrame` reads the store directly; it doesn't need new props.

- [ ] Task 8: Unit tests — `frontend/src/hooks/usePondSearchKeyboard.test.ts` (AC: #1, #14)
  - [ ] `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))` → store's `searchQuery === 'a'`.
  - [ ] Sequence `['r', 'e', 'v']` → `searchQuery === 'rev'`.
  - [ ] `Backspace` after `'rev'` → `'re'`.
  - [ ] `Escape` at any time → `searchQuery === ''`, `searchResults.size === 0`, `cameraFocus === null`.
  - [ ] `'a'` with `document.activeElement` set to a fake `<input>` → `searchQuery` unchanged.
  - [ ] `'a'` with `activePopupTodoId` set in the store → `searchQuery` unchanged.
  - [ ] `Ctrl+a` → `searchQuery` unchanged.

- [ ] Task 9: Unit tests — `frontend/src/hooks/usePondSearchSync.test.ts` (AC: #2, #3, #7, #8, #9, #10)
  - [ ] Mock `apiClient.get` (MSW or vi.mock). Type a query → wait 300 ms → assert exactly one GET with `params: { q: 'review' }`.
  - [ ] Type 3 chars rapidly inside the debounce window → assert exactly ONE GET (not three).
  - [ ] Response with `results: [{todo, score, matchType}]` → `searchResults.get(todo.id)` returns `{score, matchType}`.
  - [ ] Response with `ftsSupported: false` → `searchAllMatches === true` in the store.
  - [ ] Response with `results: [], ftsSupported: true` → `searchResults.size === 0` and `searchAllMatches === false`.
  - [ ] Response with matches having positions → `cameraFocus` is set with centroid + positive zoom.
  - [ ] Response with all match positions null → `cameraFocus` unchanged.

- [ ] Task 10: Unit tests — store slice tests extension, `frontend/src/stores/usePondStore.test.ts` (AC: #1, #12)
  - [ ] `appendSearchChar('a')` → `searchQuery === 'a'`, `searchActive === true`.
  - [ ] `backspaceSearch()` empties → `searchActive === false`.
  - [ ] `clearSearch()` → all four search slices reset + `cameraFocus === null`.

- [ ] Task 11: Integration test — `frontend/src/components/pond/PondSearchOverlay.test.tsx` (AC: #11, #10, #12)
  - [ ] Render the overlay with `searchActive=true, searchQuery='hello', vectorSearchUnavailable=false` → text "hello" visible, no offline badge.
  - [ ] Flip `vectorSearchUnavailable` to true → "semantic search offline" text rendered.
  - [ ] `searchActive=false` → element has `opacity: 0` style (use `getComputedStyle` or inline-style assertion).
  - [ ] `searchQuery=''` → after transition ends, element is removed from DOM (optional — if simpler, assert `opacity: 0` only).

- [ ] Task 12: Full gates — `cd frontend && npx tsc --noEmit` clean, `npx vitest run` all green, `npm run build` clean. Manual smoke (optional, live backend): type in the live app, observe pads rise/fall and camera auto-frame.

## Dev Notes

### Why no search-`<input>` element, just `window` keydown?

The UX spec's core beat is "no search bar." Rendering an `<input>` — even hidden — creates a focusable DOM node that would either need explicit-focus management (fights with other inputs like `TodoInput`) or be auto-focused (but then the page loses "focus" semantics and the ActionPopup's text selection could break). Using window-level `keydown` with an explicit focus-target guard is simpler and matches the existing `useClosePopupOnEscape` pattern. The trade-off: IMEs (Chinese/Japanese composition) don't give us a composition session — we only see committed keystrokes. Acceptable for v1 English UI; noted in Out of scope.

### Cluster behaviour (FR20 partial deferral)

FR20 says "matching clusters surface as units with matching members highlighted and non-matching siblings faded." Clusters/Groups land in Story 4.2 (currently `backlog`). Until then, each todo is its own singleton cluster — the per-pad rise IS the cluster-surface. When 4.2 lands, it will need to:

- Detect the group-id of each match.
- For each matched group: rise ALL members, but only HIGHLIGHT the matched ones (keep non-matching siblings visible but at 60% opacity, distinct from the 28% full-submerge of non-matched isolates).

For now, the implementation reads `searchResults.has(id)` directly. Story 4.2 will extend the logic.

### Camera auto-frame heuristic

Zoom distance `= max(8, bboxDiagonal * 1.2)`:

- `bboxDiagonal` is the diagonal of the axis-aligned bounding box of match positions on the XZ plane.
- `* 1.2` gives ~20% padding so matches aren't flush with the viewport edge.
- `max(8, ...)` prevents zooming IN too close when there's only one tight match — 8 world units gives comfortable working distance (matches the "default zoom" callout in the UX spec).
- If only one match: `bboxDiagonal = 0`, so `zoom = 8`.

**Deferred**: if a cluster of 5+ matches sits on one side of the pond, the current centroid+diagonal heuristic may crop edge pads. A more-correct implementation would use perspective-aware framing (project the bbox to NDC and fit). Not worth it for v1's ≤30-pad scale.

### Progressive results (FR18's "full-text results appear first, vector results refine")

The backend in Story 5.2 returns both sides in one response — it does NOT stream. Progressive refinement in this story is achieved by the **per-keystroke debounced re-query**: each new character sends a refined query and returns a refined ranking. From the user's perspective, the ranking "settles" as they type. True streaming (FTS first, vector second) would require backend changes (SSE or two endpoints). **Out of scope for 5.3.**

### Subscribing to store slices efficiently

LilyPad runs `useFrame` at 60 Hz. If it re-renders on every `searchQuery` change, performance dies. Two mitigations:

1. **Shallow-select** only this pad's `SearchHit` from the Map, not the whole Map — use zustand's `subscribeWithSelector` middleware or a manual `useRef` + `useEffect` subscription pattern. See [usePondStore.ts](frontend/src/stores/usePondStore.ts) for existing selector patterns (the `activePopupTodoId === todo.id` check at PondScene:160 is one).
2. **Read inside `useFrame` via `usePondStore.getState()`** — bypasses the subscription entirely for per-frame reads. This is the established pattern in LilyPad for `glowIntensity` and `cameraFocus`. Use it for the search slices too.

Task 5 should prefer pattern (2) — subscribe to the React-tree only for the top-level "am I a match?" boolean if needed for a single initial re-render on state change; read `SearchHit` details inside `useFrame` via `getState()`.

### Why no "no results found" UI?

UX spec § Timeline: *"Pond goes still. Water calms. No 'no results found' text — the stillness communicates it."* Empty results => every pad submerges => the user sees a quiet, submerged pond. That IS the feedback. Adding a modal would break the "environmental animation over spinners/skeletons" rule (UX spec § Loading states).

### vectorSearchUnavailable and ftsSupported — user-visible difference

| Flag | User-visible effect |
|---|---|
| `vectorSearchUnavailable: true` | Pond responds normally but only keyword matches come back. Small "semantic search offline" badge near the search text. User is informed; search still works. |
| `ftsSupported: false` | Pond renders normally (no submerge; AC #9). Nothing in the results would be meaningful anyway — searched a stop-word or emoji. User's input still shows on the water. Subsequent characters that produce a supported tsquery snap the pond into search mode. |
| Both true | Full hybrid UX. Most queries hit this path. |
| Both false | Very rare: empty-tsquery + embedding-API-down. AC #9 wins (treat all as matches) but the badge is also shown. |

### Phase-interaction guard (AC #5 tail clause)

A pad mid-`completing` or mid-`deleting` MUST NOT submerge during a search. Reason: the dissolve animation needs the pad to stay fully visible through its 1.6 s choreography; submerging it mid-flight would make the green/red flash look half-swallowed and the ripple fire from under-water.

Implementation: the `searchMode` computation in LilyPad's `useFrame` early-returns `'none'` if `phase === 'completing' || phase === 'deleting'`. No lerp against search targets in those frames.

### Files to Create / Modify / Delete

**New:**

- `frontend/src/api/searchApi.ts` — `useSearch` hook (Task 1).
- `frontend/src/hooks/usePondSearchKeyboard.ts` — global keydown handler (Task 3).
- `frontend/src/hooks/usePondSearchSync.ts` — debounced-search subscriber + camera centroid (Task 4).
- `frontend/src/components/pond/PondSearchOverlay.tsx` — HTML overlay for the typed text + offline badge (Task 6).
- `frontend/src/hooks/usePondSearchKeyboard.test.ts` (Task 8).
- `frontend/src/hooks/usePondSearchSync.test.ts` (Task 9).
- `frontend/src/components/pond/PondSearchOverlay.test.tsx` (Task 11).

**Modified:**

- `frontend/src/types/index.ts` — add `SearchHit`, `SearchResult`, `SearchResponse`, `SearchMatchType` (Task 1).
- `frontend/src/stores/usePondStore.ts` — add search slices + actions + constants (Task 2).
- `frontend/src/stores/usePondStore.test.ts` — new assertions for the search slices (Task 10).
- `frontend/src/components/pond/PondScene.tsx` — mount the two hooks + the overlay (Task 7).
- `frontend/src/components/pond/LilyPad.tsx` — submerge/rise `useFrame` branch (Task 5).

**Untouched (keep):**

- Backend — zero changes. `/api/search` is already built and tested in Story 5.2.
- [`frontend/src/api/client.ts`](frontend/src/api/client.ts) — reused as-is.
- [`ActionPopup.tsx`](frontend/src/components/pond/ActionPopup.tsx) — unchanged; it already coexists with R3F as an HTML overlay, same pattern the new overlay follows.
- `PondCamera.tsx` — unchanged; the search story uses its existing `cameraFocus` → lerp loop.
- Existing keyboard hooks (`useClosePopupOnEscape`, `useKeyboardShortcuts`) — unchanged. The new `usePondSearchKeyboard` runs alongside them.

## Anti-Patterns to Avoid

- **DO NOT** add a hidden `<input>` element to capture keystrokes. Window-level `keydown` with a focus-target guard is the established pattern (see `useClosePopupOnEscape`).
- **DO NOT** subscribe LilyPad to the full `searchResults` Map — one pad re-rendering on every other pad's search-hit change is an O(N²) trap. Use `getState()` inside `useFrame` or a precise selector.
- **DO NOT** mirror the search response into zustand as server-state. The query result lives in React Query; only the **derived** `Map<id, SearchHit>` and the `searchAllMatches` flag belong in zustand (they're UI state).
- **DO NOT** fire a search on every keystroke without debouncing. 300 ms is the spec (FR18) and matches the UX perception budget.
- **DO NOT** cull non-match pads (`visible={false}`). They need to be **visibly submerged + faded**, not gone — the submerge motion is the UX feedback.
- **DO NOT** tint match pads. Match glow gets brighter; the base colour stays the user's chosen colour. Tinting would fight with Story 4.1's color-swatch personalisation.
- **DO NOT** use `setTimeout` from class-like handlers without cleanup — every `setTimeout` that survives unmount is a memory leak. Use `useEffect` return-function cleanup.
- **DO NOT** block write paths while searching. A user should be able to drop a new pad, complete a pad, delete a pad, or change a colour during an active search. Search is overlay-only.
- **DO NOT** capture keystrokes inside the ActionPopup (text-editing a todo, color-swatch nav). The `activePopupTodoId` check in the keydown guard must be the FIRST condition checked.
- **DO NOT** use `e.key.length === 1` as the sole printable-char filter. It's a good first filter (excludes 'Enter', 'ArrowLeft', etc.) BUT doesn't exclude `Shift`/`Control`/`Alt`/`Meta` keypresses. Pair it with the modifier-check in the guard.
- **DO NOT** render the overlay INSIDE the `<Canvas>`. R3F canvas does not accept HTML children; the overlay is HTML, mounted as a sibling of `<Canvas>`.
- **DO NOT** invalidate `['todos', 'list']` on search — it's a read, not a write. No cache invalidation anywhere in 5.3.
- **DO NOT** convert snake_case to camelCase manually in `searchApi.ts`. The client.ts interceptors do it; double-conversion produces `camelCasecamelCase` nonsense.

## Previous Story Intelligence

### From Story 5.2 (backend API, just shipped)

- **Response shape (locked)**: `SearchResponse { query, results: [{todo, score, matchType}], vectorSearchUnavailable, ftsSupported }`. See [backend/src/schemas/search.py](backend/src/schemas/search.py). Client types in this story's Task 1 mirror this exactly.
- **Endpoint**: `GET /api/search?q=<str>`; `q` required, `min_length=1, max_length=500`, whitespace-only rejected at 422 via `PydanticCustomError("query_blank", ...)`. The frontend only fires when `query.trim().length > 0`, so whitespace-only never hits the network.
- **Hybrid weights**: FTS 0.3 + vector 0.7. Score range `[0, 1]`. Pure-keyword tops at ~0.3; pure-semantic ~0.7; hybrid ~0.95+. The frontend doesn't need to know these weights — `matchType` is the discriminator for any UI that needs it.
- **Tight timeout**: the search path uses a 1.5 s embedding timeout (per-call HttpOptions override, distinct from the 15 s worker timeout). The client should see responses within ~2 s even when Google is slow.
- **Graceful fallback**: `vectorSearchUnavailable: true` means "we got FTS results but no semantic ones." Response is HTTP 200; no retry needed.

### From Story 2.3 (ActionPopup — the existing HTML-over-R3F precedent)

- HTML overlay positioned via absolute/fixed CSS can live next to `<Canvas>` — z-index layers naturally handle "above canvas" because canvas is painted at its natural place in the DOM.
- The popup reads zustand state to drive open/close; the search overlay follows the exact pattern but reads `searchActive` and `searchQuery`.

### From Story 4.1 (popup color swatch)

- `committedColor` and `previewColor` patterns show how zustand per-id Maps work in practice. The new `searchResults: Map<string, SearchHit>` follows the same shape — Map-by-id, actions set/clear the whole Map at once, selectors read `map.get(id)` for a single pad.
- The `useEffect([committedColor])` in LilyPad that writes `mat.uniforms.uColor.value` is a reference for how to wire a store-driven value into a shader uniform per-pad. The search story does NOT touch uniforms (glow is the existing `uStrength` path) but the subscription + frame-read split is the same.

### From Story 2.6 (loading + error states)

- `stampedAt` / `TodoErrorEntry` patterns show how to keep per-id ephemeral UI state in a Map. The same idea applies to `searchResults`.
- `renderTodos` merges live todos with in-progress completion/deletion maps. Search does NOT need to merge — it reads over the existing `todos` from `useTodos` and decorates via the store lookup.

### From Story 2.10 (lily pads float)

- The `useFrame` damping / smoothing constant used for water-elevation riding is the reference for all lerps in LilyPad. The search submerge/rise uses the same constant so motion feels coherent.

## Git Intelligence (recent commits)

- `834b1ef` — defer drain: promoted 14 items to backlog stories (including this one's follow-ups 2.11/2.12/4.4/4.5).
- `bb05011` — CI: alembic upgrade + path triggers.
- `8e5a910` — backend schema hardening + config validators + search UX polish (fts_supported, raw-query echo).
- `4b5b4e8` — story 5.2 CR batch 1 (search-path timeout, duplicate-q, whitespace-todo text, embedding_model startup).
- `c7984a6` — story 5.2 CR patches (defence-in-depth filter, rollback split, tertiary sort, NaN guard, epsilon test).
- `f61dee1` — story 5.2 implementation.

Net: the backend search API is fully baked and stable. Frontend has been quiet since story 4.1's CR follow-ups (`0477990`); the ground is clean.

## Testing Standards

- **Framework**: Vitest + React Testing Library (existing setup in `frontend/vitest.config.ts`). See existing `*.test.ts(x)` files.
- **Mocking**: use `vi.mock` for `apiClient` or MSW if there's an existing MSW setup — check `frontend/src/test/` for handlers; if none, fall back to `vi.mock('../api/client')`.
- **Keyboard events**: synthesise via `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))`.
- **React Query tests**: wrap hooks in a `QueryClientProvider` (see existing test setup patterns for `useCreateTodo`/`useDeleteTodo` tests).
- **Store tests**: use `usePondStore.setState(...)` to seed state and `usePondStore.getState()` to assert — same pattern as existing store tests.
- **Visual/3D tests**: LilyPad's `useFrame` search logic — assert via exposed helper functions if possible, OR snapshot the computed target Y/opacity given a search-mode input. **DO NOT** try to render the full canvas in jsdom — R3F needs a real WebGL context which jsdom doesn't provide.
- **Type check**: `npx tsc --noEmit` must be clean. All new types strict.

## References

- [Source: `_bmad-output/planning-artifacts/epics.md:560-587`] — Story 5.3 acceptance criteria and BDD scenarios.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:415-424, 539-548, 582-604, 679-690, 999-1010`] — search UX timeline, z-layering, camera auto-frame, flow diagram, behavior rules.
- [Source: `_bmad-output/planning-artifacts/prd.md:307-322`] — FR14-FR22 + FR25 functional requirements.
- [Source: `backend/src/schemas/search.py`] — `SearchResponse` shape (source of truth for this story's types).
- [Source: `backend/src/api/search.py`] — endpoint contract, 422 conditions.
- [Source: `backend/src/services/search_service.py`] — hybrid weights, result ordering, limit behaviour.
- [Source: `frontend/src/api/client.ts`] — `/api` base + casing interceptors.
- [Source: `frontend/src/api/todoApi.ts`] — React Query hook pattern.
- [Source: `frontend/src/hooks/useClosePopupOnEscape.ts`] — keyboard-hook template with focus-target guard.
- [Source: `frontend/src/components/pond/PondScene.tsx`] — mounting point for the overlay + hooks.
- [Source: `frontend/src/components/pond/LilyPad.tsx`] — `useFrame` structure; glow uniform pattern.
- [Source: `frontend/src/components/pond/PondCamera.tsx`] — `cameraFocus` + lerp contract; `LERP_SPEED = 0.05`, `ARRIVE_THRESHOLD = 0.1`.
- [Source: `frontend/src/stores/usePondStore.ts`] — zustand shape and selector idioms.
- [Source: `frontend/src/types/index.ts`] — `Todo` type + where to add new search types.
- [Source: `_bmad-output/implementation-artifacts/5-2-hybrid-search-api.md`] — prior story; its Dev Notes document the FTS normalisation and cosine clamp reasoning if the UI ever needs to display raw scores.

## Dev Agent Record

### Agent Model Used

_(to be filled on dev-story run)_

### Debug Log References

_(to be filled on dev-story run)_

### Completion Notes List

_(to be filled on dev-story run)_

### File List

_(to be filled on dev-story run)_

### Change Log

| Date | Change |
|------|--------|
| 2026-04-20 | Story created as Epic 5.3 (third story of Epic 5 "Intelligent Search"). Scope: frontend-only type-anywhere search UI consuming Story 5.2's `/api/search` endpoint. Window-level keydown capture (no `<input>` element), 300 ms debounce, match-rise/non-match-submerge in LilyPad `useFrame`, camera auto-frame on match centroid, HTML overlay for typed text, Escape-clear with 400 ms restore. Forward-compat with Story 4.2's cluster work. Partial-deferral note on FR20 (cluster-surfacing reduces to per-pad-rise until 4.2 lands). |
