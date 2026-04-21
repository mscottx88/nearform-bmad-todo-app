# Story 5.3: Type-Anywhere Search with Surface/Submerge

Status: review

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

4. **Given** a LilyPad is a **match**, **When** `useFrame` runs, **Then** the pad's body colour lerps between `SEARCH_NEUTRAL_GRAY` (a dark-neutral `vec3(0.25, 0.25, 0.25)` used as the "no-match" baseline) and its committed pad colour, with the interpolation value equal to the match's `score` from the API response. A strong hit (score ~0.95) renders at ~95% toward its true colour; a borderline hit (score ~0.30) stays mostly grey. Glow strength scales by the same saturation factor — a weak match glows faintly, a strong match glows fully. Y position and opacity are **unchanged** from the no-search baseline.

5. **Given** a LilyPad is a **non-match**, **When** `useFrame` runs, **Then** the pad lerps fully to `SEARCH_NEUTRAL_GRAY` (saturation = 0) and its glow drops to 0. The pad stays at its normal resting Y and full opacity — it reads as "dormant / uncoloured" rather than "gone below the surface". Pads mid-completion/deletion phases are untouched by the saturation logic (automatic via the `resting`-phase scope) — their existing colour/dissolve choreography is authoritative.

6. **Given** a **match** cluster exists (any todos that are members of the same Group — forward-compat with Story 4.2; for 5.3 treat every todo as its own singleton cluster since groups aren't implemented yet), **When** results render, **Then** all matches rise as described in AC #4 regardless of their cluster context. The "clusters surface as units with matching members highlighted" FR20 semantics are **partially deferred** until Story 4.2 lands groups; for 5.3, the per-pad rise IS the cluster-surfacing behaviour (singleton clusters). Document this in Dev Notes.

7. **Given** `searchResults` is non-empty AND contains at least one match with a known `todo.positionX` / `todo.positionY` (not null), **When** results arrive, **Then** the store dispatches `focusCamera(cx, cz, zoom)` where `(cx, cz)` is the **centroid** of match positions and `zoom` is chosen to frame the bounding box of matches. Camera auto-frame uses the existing `PondCamera` lerp logic (`LERP_SPEED = 0.05`, `ARRIVE_THRESHOLD = 0.1`). If no match has a resolved position (all match positions are null), the camera does NOT move — leaving it in whatever state the user had it.

8. **Given** an **empty-result response** (results array is `[]`) AND `ftsSupported === true`, **When** the UI processes it, **Then** ALL live todos submerge (treat them all as non-matches per AC #5). Per the UX spec: *"Pond goes still. Water calms. No 'no results found' text — the stillness communicates it."* The search text stays visible on the water.

9. **Given** `ftsSupported === false` in the response (query was stop-words-only, emoji-only, punctuation-only, or a non-English language), **When** the UI processes it, **Then** ALL live todos are treated as **matches** (i.e., the pond renders normally with no search influence on the pads). The search text stays visible on the water surface so the user sees what they typed. No error UI — the silent render is the signal that the query isn't searchable.

10. **Given** `vectorSearchUnavailable === true` in the response (Google embedding API down), **When** the UI processes it, **Then** the response is used AS-IS — match-type "keyword" results still drive surface/submerge exactly the same way. A small, unobtrusive indicator appears near the search text: `"semantic search offline"` at 50% opacity in the same monospace font. No error modal, no retry button.

11. **Given** the user is typing, **When** each new keystroke lands, **Then** the search text appears on the water surface as an **HTML overlay** positioned just above the water-plane centre (pinned to the camera-facing top of the pond in screen space). Font: `monospace` system stack (matches the existing retro aesthetic — pick the stack from TodoInput's current CSS). Colour: `#00eeff` (same neon cyan as the default pad glow, per architecture doc's accent palette). The text has a subtle glow (CSS `text-shadow`) and is non-interactive (`pointer-events: none`). No `<input>` element is rendered — we capture keystrokes at the window level, NOT via a hidden text input.

12. **Given** the user presses **Escape**, **When** the handler runs, **Then** (a) `searchQuery` clears to `""`, (b) `searchResults` clears to an empty Map, (c) `cameraFocus` is cleared so `PondCamera`'s lerp returns to default, (d) all LilyPads lerp back to their resting Y and glow within the existing lerp speed. The full restore animation completes within **~400 ms** per the UX timeline. The search text dissolves from the water via CSS opacity transition (not an abrupt unmount) — use `transition: opacity 200ms ease-out` on the overlay.

13. **Given** the existing vitest suite + this story's new tests, **When** the suite runs, **Then** (a) all existing tests still pass (no regressions in `PondScene.test.tsx`, `TodoInput.test.tsx`, `useClosePopupOnEscape.test.ts`, `usePopupComplete.test.ts`, `usePopupDelete.test.ts`, popup-color-swatch tests, etc.), AND (b) new tests cover: debounce behaviour (type 3 chars rapidly → only the last triggers a query after 300 ms), Escape-clears-on-searchActive, ignore-keydown-when-input-focused, match-vs-non-match classification in the store, camera auto-frame centroid computation, empty-result-all-submerge behaviour, `vectorSearchUnavailable` badge render, `ftsSupported=false` treats-all-as-match behaviour.

14. **Given** the existing pond is rendering and a search is active, **When** the user clicks a surfaced pad (match), **Then** the existing click → popup → Complete/Delete/color flows all still work unchanged. Search is a **read-only overlay** on top of the pond — it does not interfere with any write path. Specifically: `POST /api/todos` (new-pad drop), popup actions, drag, camera scroll/pan all continue to function. The typing-to-search global handler must NOT fire when the popup is open (check `activePopupTodoId` inside the keydown guard — same pattern as the existing input-focus guard).

15. **Given** the pre-existing [`useKeyboardShortcuts`](frontend/src/hooks/useKeyboardShortcuts.ts) hook listens for bare **`n`**, **`N`**, and **`/`** at the window level to open the new-todo input, **When** this story ships, **Then** those three bindings are **REMOVED** and replaced with a single non-collision shortcut for "open new-todo input": **`Enter`** when no element is focused AND no popup is open AND no search is active. Rationale: type-anywhere search consumes every printable character — including `n`/`N`/`/` — so the existing shortcut would fire a second window handler and double-dispatch. `Enter` is unambiguous (no printable-char meaning), discoverable (matches the existing Enter-to-submit semantics inside `TodoInput`), and guardable by the same focus/popup/search checks already required by AC #1. The `EmptyPondHint` copy is updated from its current wording to reference `Enter` — or stays generic if the current copy doesn't name the shortcut. Existing callers of `useKeyboardShortcuts` (currently `EmptyPondHint` / similar) are updated to the new key.

## Tasks / Subtasks

- [x] Task 1: Extend types + API hook (AC: #2, #3)
  - [x] Add `SearchHit`, `SearchResponse` types to [frontend/src/types/index.ts](frontend/src/types/index.ts):
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
  - [x] New file `frontend/src/api/searchApi.ts` with `useSearch(query: string, enabled: boolean)`:
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

- [x] Task 2: Extend `usePondStore` with search slices (AC: #1, #3, #12)
  - [x] New state: `searchQuery: string`, `searchResults: Map<string, SearchHit>`, `searchActive: boolean`. `searchActive` derives from `searchQuery.length > 0`; include it as an explicit flag so LilyPads don't subscribe to the whole query string.
  - [x] New actions:
    - `appendSearchChar(ch: string)` — appends one character to `searchQuery`; sets `searchActive=true` if transitioning from empty.
    - `backspaceSearch()` — drops the last character; sets `searchActive=false` if the result is empty.
    - `setSearchResults(results: Map<string, SearchHit>)` — replaces the results Map; called by the `useSearch` subscriber hook.
    - `clearSearch()` — resets `searchQuery=""`, `searchResults=new Map()`, `searchActive=false`, and `cameraFocus=null`.
  - [x] Constants co-located with the existing `GLOW_INTENSITY` block: `SURFACE_RISE_Y = 0.3`, `SUBMERGE_DROP_Y = -0.8`, `SEARCH_MATCH_GLOW = 0.35`, `SEARCH_NONMATCH_OPACITY = 0.28`, `SEARCH_DEBOUNCE_MS = 300`.

- [x] Task 2b: Rebind the existing new-todo keyboard shortcut (AC: #15)
  - [x] Edit [frontend/src/hooks/useKeyboardShortcuts.ts](frontend/src/hooks/useKeyboardShortcuts.ts) — remove the `e.key === 'n' || e.key === 'N' || e.key === '/'` condition and replace with `e.key === 'Enter'`.
  - [x] Extend the guard to ALSO return early when `usePondStore.getState().searchActive` is true OR `activePopupTodoId !== null`. Without those guards, pressing Enter mid-search or mid-popup would spawn a new-todo input on top of the existing UI.
  - [x] Update the existing test `useKeyboardShortcuts.test.ts` (if it exists; grep first) — assert `Enter` triggers `onOpenInput`, assert `n`/`N`/`/` do NOT, assert Enter during searchActive does NOT, assert Enter with activePopupTodoId set does NOT.
  - [x] If `EmptyPondHint` (or any other UI) references the old shortcut keys in visible copy, update the text. Most likely the hint says something like "press N or / to add" — change to "press Enter to add" or keep generic ("type something to get started").

- [x] Task 3: Global type-anywhere keyboard hook `frontend/src/hooks/usePondSearchKeyboard.ts` (AC: #1, #12, #14)
  - [x] Installs a `window` `keydown` listener inside a `useEffect([])`.
  - [x] Guards:
    - Event target is `<input>`, `<textarea>`, or contenteditable → return (same check as `useClosePopupOnEscape`).
    - `activePopupTodoId !== null` (popup is open) → return. The popup captures its own keystrokes.
    - Modifier keys pressed (`e.ctrlKey || e.metaKey || e.altKey`) → return. Leaves OS shortcuts alone.
  - [x] Dispatch table:
    - `e.key === 'Escape'` → `clearSearch()` + stop propagation.
    - `e.key === 'Backspace'` → `backspaceSearch()` + `e.preventDefault()` so the browser's "back" shortcut doesn't fire.
    - `e.key.length === 1` (printable character — letters, digits, punctuation, space) → `appendSearchChar(e.key)` + `e.preventDefault()`.
    - Anything else (arrows, F-keys, Tab, Enter) → return without consuming.
  - [x] Mount this hook once in [PondScene.tsx](frontend/src/components/pond/PondScene.tsx) at top level.

- [x] Task 4: Debounced-search subscriber `frontend/src/hooks/usePondSearchSync.ts` (AC: #2, #3, #7, #8, #9, #10)
  - [x] Reads `searchQuery` from the store. Applies a 300 ms debounce (plain `useEffect` + `setTimeout` + cleanup; no external debounce lib needed).
  - [x] Calls `useSearch(debouncedQuery, enabled=searchActive)`.
  - [x] When `data` arrives, builds a `Map<string, SearchHit>` from `data.results` and calls `setSearchResults(map)`. Also:
    - If `data.ftsSupported === false`: set results to an "everything is a match" sentinel (use a special marker; LilyPad distinguishes via a second store flag `searchAllMatches: boolean` rather than faking `results.size === totalTodos`).
    - If `results.length === 0` and `ftsSupported === true`: set empty Map — LilyPads treat all as non-matches.
  - [x] After results settle, compute centroid + zoom of matched pads with non-null positions and dispatch `focusCamera(cx, cz, zoom)`. If no matches or all positions are null, leave camera alone. Zoom heuristic: `zoom = max(8, bbox_diagonal * 1.2)`; document the choice in Dev Notes.

- [x] Task 5: LilyPad submerge/rise behaviour (AC: #4, #5, #6, #13, #14)
  - [x] Read from store: `searchActive`, this pad's hit via `searchResults.get(todo.id)`, and the `searchAllMatches` flag. Subscribe precisely — only this todo's hit, not the whole Map, to avoid re-renders on unrelated result changes (use a selector that returns `useShallow` or manual equality).
  - [x] Compute `searchMode: 'none' | 'match' | 'nonmatch'`:
    - `!searchActive` → `'none'` (no influence).
    - `searchAllMatches` → `'match'` (AC #9 path).
    - `searchResults.has(todo.id)` → `'match'`.
    - else → `'nonmatch'`.
  - [x] In the existing `useFrame` loop, compute target `extraY` and `extraOpacityDelta` based on `searchMode`. Lerp towards them with the existing frame-damping factor (reuse the same `smoothing` constant that phase/tilt already use for consistency).
  - [x] `searchMode === 'nonmatch'` target: `extraY = SUBMERGE_DROP_Y`, body opacity `= SEARCH_NONMATCH_OPACITY`, glow strength `= 0`.
  - [x] `searchMode === 'match'` target: `extraY = SURFACE_RISE_Y`, body opacity `= 1.0`, glow strength `= SEARCH_MATCH_GLOW`.
  - [x] `searchMode === 'none'` target: `extraY = 0`, body opacity `= 1.0`, glow strength reverts to the existing focused/ambient logic.
  - [x] **Hard guard**: if `phase` is `'completing'` or `'deleting'`, skip the search adjustments entirely — the existing dissolve animation is authoritative (AC #5's "dissolve wins" clause).

- [x] Task 6: Search-text water overlay `frontend/src/components/pond/PondSearchOverlay.tsx` (AC: #11, #10, #12)
  - [x] HTML div absolutely-positioned, pointer-events-none, anchored top-center relative to the viewport (`position: fixed; top: 15vh; left: 50%; transform: translateX(-50%);`). Matches the "water surface" visual region.
  - [x] Renders `searchQuery` text in monospace with `text-shadow: 0 0 8px #00eeff`, color `#00eeff`, `font-size: 2rem`, `letter-spacing: 0.1em`. Pick the existing `font-family` from TodoInput.tsx for consistency.
  - [x] Renders a small secondary line below (smaller font, 50% opacity) with `"semantic search offline"` when `vectorSearchUnavailable === true`. Rendered only while `searchActive`. Blank otherwise.
  - [x] Root element has `opacity` bound to `searchActive ? 1 : 0` with `transition: opacity 200ms ease-out` — the dissolve on clear (AC #12).
  - [x] Renders NOTHING (returns null) when `searchQuery === ""` AND the transition has completed (use `transitionend` or a simple timer; don't bother animating mount itself — only unmount fade).
  - [x] Mounted once in [PondScene.tsx](frontend/src/components/pond/PondScene.tsx) outside the R3F `<Canvas>` (it's an HTML overlay, not a 3D element).

- [x] Task 7: PondScene wire-up (AC: #1, #11, #14)
  - [x] Call `usePondSearchKeyboard()` at top level.
  - [x] Call `usePondSearchSync()` at top level (so React Query runs on debounced query).
  - [x] Render `<PondSearchOverlay />` outside `<Canvas>`.
  - [x] NO other JSX changes. LilyPad's internal `useFrame` reads the store directly; it doesn't need new props.

- [x] Task 8: Unit tests — `frontend/src/hooks/usePondSearchKeyboard.test.ts` (AC: #1, #14)
  - [x] `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))` → store's `searchQuery === 'a'`.
  - [x] Sequence `['r', 'e', 'v']` → `searchQuery === 'rev'`.
  - [x] `Backspace` after `'rev'` → `'re'`.
  - [x] `Escape` at any time → `searchQuery === ''`, `searchResults.size === 0`, `cameraFocus === null`.
  - [x] `'a'` with `document.activeElement` set to a fake `<input>` → `searchQuery` unchanged.
  - [x] `'a'` with `activePopupTodoId` set in the store → `searchQuery` unchanged.
  - [x] `Ctrl+a` → `searchQuery` unchanged.

- [x] Task 9: Unit tests — `frontend/src/hooks/usePondSearchSync.test.ts` (AC: #2, #3, #7, #8, #9, #10)
  - [x] Mock `apiClient.get` (MSW or vi.mock). Type a query → wait 300 ms → assert exactly one GET with `params: { q: 'review' }`.
  - [x] Type 3 chars rapidly inside the debounce window → assert exactly ONE GET (not three).
  - [x] Response with `results: [{todo, score, matchType}]` → `searchResults.get(todo.id)` returns `{score, matchType}`.
  - [x] Response with `ftsSupported: false` → `searchAllMatches === true` in the store.
  - [x] Response with `results: [], ftsSupported: true` → `searchResults.size === 0` and `searchAllMatches === false`.
  - [x] Response with matches having positions → `cameraFocus` is set with centroid + positive zoom.
  - [x] Response with all match positions null → `cameraFocus` unchanged.

- [x] Task 10: Unit tests — store slice tests extension, `frontend/src/stores/usePondStore.test.ts` (AC: #1, #12)
  - [x] `appendSearchChar('a')` → `searchQuery === 'a'`, `searchActive === true`.
  - [x] `backspaceSearch()` empties → `searchActive === false`.
  - [x] `clearSearch()` → all four search slices reset + `cameraFocus === null`.

- [x] Task 11: Integration test — `frontend/src/components/pond/PondSearchOverlay.test.tsx` (AC: #11, #10, #12)
  - [x] Render the overlay with `searchActive=true, searchQuery='hello', vectorSearchUnavailable=false` → text "hello" visible, no offline badge.
  - [x] Flip `vectorSearchUnavailable` to true → "semantic search offline" text rendered.
  - [x] `searchActive=false` → element has `opacity: 0` style (use `getComputedStyle` or inline-style assertion).
  - [x] `searchQuery=''` → after transition ends, element is removed from DOM (optional — if simpler, assert `opacity: 0` only).

- [x] Task 12: Full gates — `cd frontend && npx tsc --noEmit` clean, `npx vitest run` all green, `npm run build` clean. Manual smoke (optional, live backend): type in the live app, observe pads rise/fall and camera auto-frame.

## Dev Notes

### Keyboard-handler audit (all window/element listeners in the frontend)

Comprehensive scan of every `addEventListener('keydown')`, `onKeyDown`, `onKeyPress`, `onKeyUp` in `frontend/src` plus third-party libraries that install window listeners:

| # | Location | Scope | Keys it claims | Collision with type-anywhere search? |
|---|---|---|---|---|
| 1 | [useKeyboardShortcuts.ts:15,20](frontend/src/hooks/useKeyboardShortcuts.ts#L15) | window | bare `n`, `N`, `/` | **YES** — printable keys collide. Resolution: Task 2b rebinds to `Enter` with guards. |
| 2 | [useClosePopupOnEscape.ts:23](frontend/src/hooks/useClosePopupOnEscape.ts#L23) | window | Escape | No collision. Both handlers fire; ours returns early when popup is open (AC #1 popup-open guard) so Escape cleanly closes the popup first, then on a second press clears search. When no popup, ours clears search + the popup hook no-ops on null `activePopupTodoId`. |
| 3 | [PopupColorSwatch.tsx:65-73](frontend/src/components/ui/PopupColorSwatch.tsx#L65-L73) | window, **capture phase** | Escape | No collision. Mounted only while the color swatch sub-panel is expanded, which requires the popup to be open, which means our search hook's popup-open guard is active. The capture-phase + `stopImmediatePropagation()` means this handler wins the Escape race with `useClosePopupOnEscape` (documented intent — collapses the sub-panel without closing the whole popup). |
| 4 | [TodoInput.tsx:61](frontend/src/components/ui/TodoInput.tsx#L61) | local element `onKeyDown` | handled on the input, not window | No collision. Fires only when TodoInput has DOM focus, which our hook's input-focus guard catches before any keystroke is consumed. |
| 5 | drei `OrbitControls` (via `PondCamera.tsx:141`) | window (when `enableKeys=true`, default) | Arrow keys for camera pan | No collision. `ArrowLeft`/`ArrowRight`/`ArrowUp`/`ArrowDown` are NOT printable-char keys (`e.key.length > 1`), so our hook's printable-char filter excludes them. Arrow keys pan the camera; bare letters drive search. |

**Verdict**: once Task 2b rebinds the `useKeyboardShortcuts` shortcut, the frontend has zero remaining bare-printable-key collisions. Escape sharing is intentional and produces the correct cascade semantics.

### The `useKeyboardShortcuts` collision — why rebind new-todo to `Enter`

The app today has a window-level shortcut: pressing bare `n`/`N`/`/` opens the new-todo input ([useKeyboardShortcuts.ts:15](frontend/src/hooks/useKeyboardShortcuts.ts#L15)). That collides head-on with type-anywhere search: both the existing shortcut AND the new search-keydown handler would fire on `N`, and the user would see the new-todo input open AND `N` appended to their search query. Undefined winner depending on listener registration order.

Resolution paths considered:

1. **Keep N/N/ — route by `searchActive` flag.** Fragile: users can't consistently use `N` to add todos mid-search; muscle memory breaks.
2. **Remove N/N/ entirely, rely on the existing `TodoInput` UI for new-todo creation.** Works but drops a power-user shortcut with no replacement.
3. **Rebind to `Enter` with guards** (chosen). `Enter` is not a printable character in the type-anywhere sense (it doesn't produce a glyph you'd search for), it's discoverable (matches the established "Enter to submit" convention inside `TodoInput`), and the existing focus-target guard already ignores keys in inputs. Adding `searchActive` and `activePopupTodoId` guards makes the shortcut safe in every UI state.
4. **Rebind to `Ctrl+N` / `Cmd+N`.** Rejected: `Ctrl+N` is browser-reserved for "new window" in most browsers and gets eaten before reaching the app.

The rebind in Task 2b is a one-file, ~8-line change with a straightforward test update. No new UX affordance needed — `Enter` is a conventional "go" key across the web.

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
- `frontend/src/hooks/useKeyboardShortcuts.ts` — rebind from `n`/`N`/`/` to `Enter`; add `searchActive` + `activePopupTodoId` guards (Task 2b). Update or add `useKeyboardShortcuts.test.ts` alongside.
- `frontend/src/components/pond/PondScene.tsx` — mount the two hooks + the overlay (Task 7).
- `frontend/src/components/pond/LilyPad.tsx` — submerge/rise `useFrame` branch (Task 5).
- `frontend/src/components/pond/EmptyPondHint.tsx` (if it references the old shortcut keys in visible copy) — update wording (Task 2b).

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
- **DO NOT** leave the old bare-key bindings (`n`/`N`/`/`) in `useKeyboardShortcuts.ts` alongside the new search handler. Two window listeners on the same bare key produce nondeterministic behaviour — pressing `N` in search would open a new-todo input on top of the search UI.

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

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`.

### Debug Log References

- `npx tsc --noEmit` — clean after all changes.
- `npx vitest run` — 142 passed / 142 total (was 102 at session start; +40 new across 5 test files).
- `npm run build` — successful; bundle 1,319 kB (gzip 372 kB). No new deps; the size note is pre-existing.
- Regression: the existing `src/components/pond/LilyPad.test.tsx` mocked `usePondStore` via `vi.mock` and had to gain four extra keys for the new imports (`selectSearchHit`, `SEARCH_MATCH_GLOW`, `SEARCH_NONMATCH_OPACITY`, `SUBMERGE_DROP_Y`, `SURFACE_RISE_Y`) plus `searchActive` / `searchAllMatches` in `getState()`. One-file, ~15-line mock expansion.

### Completion Notes List

**Implementation summary:**

- **Types** ([frontend/src/types/index.ts](frontend/src/types/index.ts)) — `SearchMatchType`, `SearchHit`, `SearchResult`, `SearchResponse` mirror the backend schema; casing matches what `apiClient`'s camelcase-keys interceptor produces.
- **API hook** ([frontend/src/api/searchApi.ts](frontend/src/api/searchApi.ts)) — `useSearch(query, enabled)` with `queryKey=['search', query] as const` and a 30 s `staleTime` so back-and-forth typing returns from cache without a network round-trip.
- **Store slices** ([frontend/src/stores/usePondStore.ts](frontend/src/stores/usePondStore.ts)) — 5 state fields (`searchQuery`, `searchActive`, `searchResults`, `searchAllMatches`, `vectorSearchUnavailable`) + 4 actions (`appendSearchChar`, `backspaceSearch`, `setSearchResults`, `clearSearch`) + 5 exported constants (`SURFACE_RISE_Y`, `SUBMERGE_DROP_Y`, `SEARCH_MATCH_GLOW`, `SEARCH_NONMATCH_OPACITY`, `SEARCH_DEBOUNCE_MS`) + `selectSearchHit` selector factory. `clearSearch` also resets `cameraFocus` per AC #12.
- **Keyboard hook** ([frontend/src/hooks/usePondSearchKeyboard.ts](frontend/src/hooks/usePondSearchKeyboard.ts)) — window keydown with the four-guard stack (input focus, popup open, modifier, non-printable). `Backspace` + printable chars are preventDefault'd; `Escape` clears.
- **Sync hook** ([frontend/src/hooks/usePondSearchSync.ts](frontend/src/hooks/usePondSearchSync.ts)) — plain `useEffect`/`setTimeout` debounce into `useSearch`, then applies response to the store. Centroid heuristic: `zoom = max(8, bboxDiagonal * 1.2)` per the Dev Notes.
- **LilyPad animation** ([frontend/src/components/pond/LilyPad.tsx](frontend/src/components/pond/LilyPad.tsx)) — three new refs (`searchYOffsetRef`, `searchOpacityRef`, `searchOpacityStateRef`) + a search-mode computation inside the `resting` phase. Y offset rides on top of the existing water-elevation lerp; body opacity fades via `fadePadMaterials` when non-match and restores via `restorePadMaterials` once the lerp returns close to 1.0 (so `LineBasicMaterial` doesn't stay stuck with `transparent=true`). Glow strength is overridden at the final `uStrength` write. Search-mode logic is INSIDE the `resting` phase block, so `completing`/`deleting` phases never see search influence (AC #5 hard guard, automatic via scope).
- **Overlay** ([frontend/src/components/pond/PondSearchOverlay.tsx](frontend/src/components/pond/PondSearchOverlay.tsx)) — HTML sibling of `<Canvas>`, `position: fixed; top: 15vh`, uses the existing `--neon-cyan` + `--font-mono` CSS tokens, 200 ms opacity transition via class toggle. `aria-hidden` flips with `searchActive` so screen readers don't announce the idle overlay.
- **PondScene wire-up** ([frontend/src/components/pond/PondScene.tsx](frontend/src/components/pond/PondScene.tsx)) — two new hook calls at the top of the component + the overlay rendered as a sibling of `<Canvas>` inside a fragment. Zero other JSX changes; LilyPad reads the store directly.
- **Shortcut rebind** ([frontend/src/hooks/useKeyboardShortcuts.ts](frontend/src/hooks/useKeyboardShortcuts.ts)) — Task 2b: `n`/`N`/`/` removed, replaced with `Enter` gated by `!activePopupTodoId && !searchActive`. `EmptyPondHint` already has generic copy ("just start typing...") and didn't need an update.

**Design decisions / deviations from the spec:**

1. **Overlay unmount**: spec suggested `transitionend`-based unmount after the dissolve. Actually-implemented: always-rendered with opacity CSS class toggle. Simpler, no timer, and `aria-hidden` gives the right accessibility semantics. Not visible when opacity=0 (no pointer events either).
2. **Task 10 spec gap**: spec listed this as a separate task but there was no pre-existing `usePondStore.test.ts` section to extend — I added a full new `describe('search slices', ...)` block with 8 tests at the end of the existing file.
3. **Opacity-restore discipline**: spec said "lerps to SEARCH_NONMATCH_OPACITY." The actual implementation uses `fadePadMaterials` every frame while in non-match, AND calls `restorePadMaterials` once when lerping back to 1.0 is "done" (≤ 0.005 from target). Without the restore, `LineBasicMaterial`s stay flagged `transparent=true` which the file's own comment calls out as depth-sort-flicker bait. Matches the existing completion-dissolve restore pattern.
4. **Extra `useKeyboardShortcuts` test suite**: spec's Task 2b said "update the existing test if it exists." None did — created from scratch so the rebind has positive coverage.
5. **Regression mock update**: the pre-existing `LilyPad.test.tsx` mocks `usePondStore` via `vi.mock` and doesn't use the real module. I added the new store exports (`selectSearchHit`, four search constants, and `searchActive`/`searchAllMatches` in `getState()`) as inert defaults so those tests continue to pass without asserting anything new.

**Backend fix discovered during 5.3 testing (out-of-spec but blocking):**

The user smoke-tested the live UI and reported "matches every lily pad regardless of todo text." Root cause was in Story 5.2's `_run_vector`: pgvector's `ORDER BY embedding <=> :query_vec LIMIT 50` returns the 50 NEAREST rows unconditionally, including weakly-related ones. On a small pond (<50 embedded todos) every todo came back with some weak cosine similarity and surfaced as a match. Patched as part of this story because 5.3's UX depends on it:

- Added `MIN_VECTOR_SIMILARITY = 0.45` constant in `backend/src/services/search_service.py`.
- Post-filter in Python after the SQL `ORDER BY` (not in the WHERE clause) so the HNSW planner path stays intact.
- Two regression tests in `backend/tests/services/test_search_service.py` (`..._drops_vector_hits_below_similarity_floor`, `..._keeps_vector_hits_at_or_above_floor`).
- Full backend suite: 83/83. Ruff + mypy clean.

**What was NOT changed:**

- `/api/search` endpoint shape — no API contract change.
- [`frontend/src/api/client.ts`](frontend/src/api/client.ts) — reused as-is.
- [`EmptyPondHint.tsx`](frontend/src/components/ui/EmptyPondHint.tsx) — its copy is already generic, didn't name the old shortcuts.
- [`PondCamera.tsx`](frontend/src/components/pond/PondCamera.tsx) — reuses the existing `cameraFocus`-driven lerp path.
- No new dependencies. Debounce is a plain `setTimeout`.

### File List

**New:**

- `frontend/src/api/searchApi.ts`
- `frontend/src/hooks/usePondSearchKeyboard.ts`
- `frontend/src/hooks/usePondSearchSync.ts`
- `frontend/src/components/pond/PondSearchOverlay.tsx`
- `frontend/src/components/pond/PondSearchOverlay.css`
- `frontend/src/hooks/usePondSearchKeyboard.test.ts`
- `frontend/src/hooks/usePondSearchSync.test.ts`
- `frontend/src/hooks/useKeyboardShortcuts.test.ts`
- `frontend/src/components/pond/PondSearchOverlay.test.tsx`

**Modified:**

- `frontend/src/types/index.ts` — added 4 search types.
- `frontend/src/stores/usePondStore.ts` — 5 state fields, 4 actions, 5 constants, 1 selector.
- `frontend/src/stores/usePondStore.test.ts` — 10 new assertions for the search slices.
- `frontend/src/hooks/useKeyboardShortcuts.ts` — Task 2b rebind.
- `frontend/src/components/pond/PondScene.tsx` — 2 new hook mounts + overlay sibling.
- `frontend/src/components/pond/LilyPad.tsx` — 3 refs + search-mode useFrame branch + glow override.
- `frontend/src/components/pond/LilyPad.test.tsx` — mock extended with new store exports (regression fix, no new behaviour).
- `backend/src/services/search_service.py` — `MIN_VECTOR_SIMILARITY = 0.45` floor + post-filter (5.2 bug discovered in 5.3 smoke test; see Completion Notes).
- `backend/tests/services/test_search_service.py` — 2 regression tests for the similarity floor.

### Change Log

| Date | Change |
|------|--------|
| 2026-04-20 | Story created as Epic 5.3 (third story of Epic 5 "Intelligent Search"). Scope: frontend-only type-anywhere search UI consuming Story 5.2's `/api/search` endpoint. Window-level keydown capture (no `<input>` element), 300 ms debounce, match-rise/non-match-submerge in LilyPad `useFrame`, camera auto-frame on match centroid, HTML overlay for typed text, Escape-clear with 400 ms restore. Forward-compat with Story 4.2's cluster work. Partial-deferral note on FR20 (cluster-surfacing reduces to per-pad-rise until 4.2 lands). |
| 2026-04-21 | AC #15 added + Task 2b + Dev Notes section § "The `useKeyboardShortcuts` collision — why rebind new-todo to `Enter`". Pre-existing bare-key shortcut (`n`/`N`/`/` → open new-todo input) would collide with type-anywhere search. Resolution: rebind to `Enter` with searchActive + activePopupTodoId guards. Surfaced by user question "What about when you press 'N'?" during story review. |
| 2026-04-21 | Dev Notes § "Keyboard-handler audit" added — full scan of 5 keydown listeners in the frontend (useKeyboardShortcuts, useClosePopupOnEscape, PopupColorSwatch, TodoInput, OrbitControls). Only useKeyboardShortcuts collides (already fixed by AC #15); the other four are non-collisions with reasons documented. Surfaced by user question "Are there other bare key bindings to consider?" |
| 2026-04-21 | Story 5.3 implemented. 9 new files (searchApi.ts, 2 hooks, overlay + CSS, 4 test files) + 7 modified (store + types + keyboard rebind + PondScene + LilyPad + LilyPad test mock + store tests). 40 new tests (10 store + 12 keyboard hook + 9 sync hook + 5 overlay + 4 useKeyboardShortcuts rebind). 142/142 vitest, tsc clean, production build clean. Also: BACKEND fix discovered in smoke test — pgvector k-NN returned every embedded row regardless of similarity, making every pad match; added MIN_VECTOR_SIMILARITY=0.45 floor in `backend/src/services/search_service.py` + 2 regression tests (`test_hybrid_search_drops_vector_hits_below_similarity_floor`, `..._keeps_vector_hits_at_or_above_floor`). Backend 83/83 green. Status → review. |
| 2026-04-21 | Similarity floor bumped 0.45 → 0.60 based on live data: observed `create` vs. `buy groceries today` at 0.54 cosine similarity on gemini-embedding-001 (the model packs short English phrases into a tight cone). New threshold-boundary + realistic-noise regression tests added in `test_search_service.py` so the same bug can't recur silently. |
| 2026-04-21 | User-directed UX redesign on AC #4/#5: replaced submerge-Y + opacity-fade non-match visual with a body-colour desaturation. Pads now LERP between `SEARCH_NEUTRAL_GRAY` (`vec3(0.25, 0.25, 0.25)`) and their committed colour, with the interpolation value = match score (1.0 = full colour, 0.0 = gray). Glow strength scales by the same saturation. Y position + opacity unchanged from baseline. Deprecated constants `SURFACE_RISE_Y`, `SUBMERGE_DROP_Y`, `SEARCH_MATCH_GLOW`, `SEARCH_NONMATCH_OPACITY` removed from the store. LilyPad refs collapsed to a single `searchSaturationRef`. 142/142 vitest, tsc clean. |
| 2026-04-21 | Added test-database safeguard: `_clean_db` fixture would silently wipe the dev DB if DATABASE_URL wasn't overridden. Extracted `require_test_database()` in `tests/_safeguard.py` + session-scoped autouse fixture. Pre-commit hook, CI, and new `make test` target all set `DATABASE_URL` to `todo_pond_test`; `make test-db-setup` creates + migrates the test DB idempotently. |
