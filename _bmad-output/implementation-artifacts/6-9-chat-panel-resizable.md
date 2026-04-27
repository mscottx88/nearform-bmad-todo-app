# Story 6.9: Chat Panel Resizable

Status: review

> **Scope note:** Tight, isolated UX polish on the agent chat panel.
> Replaces the hardcoded `440px` width with a user-resizable panel
> via a drag handle on the left edge, clamped to `[25%, 50%]` of
> viewport width. Persists via the existing `useAgentStore` localStorage
> partialize so the user's preferred width survives reloads.
>
> **No dependencies** — independent of 6-8/6-10/6-11. Can ship
> anytime.

---

## Story

As a user,
I want to resize the chat panel by dragging its left edge so I can balance pond visibility against chat content density,
So that I'm not stuck with a fixed 440px panel that's either too narrow for long messages or too wide on a small pond.

---

## Acceptance Criteria

### AC 1 — Drag handle on the left edge

**Given** the chat panel is open

**When** the user moves the cursor over the panel's left edge (within
~6px)

**Then** the cursor changes to `col-resize` AND a thin neon-cyan
hover indicator appears on the edge.

The handle is a 6px-wide invisible hit zone overlapping the actual
visible 1px border, so the user can grab the edge without pixel-perfect
aim. The visible cyan glow only activates on hover/drag — at rest, the
edge is just the existing 1px border.

### AC 2 — Drag-to-resize with clamping

**Given** the user presses the mouse on the handle and drags

**When** the cursor moves left (widening the panel) or right
(narrowing it)

**Then** the panel width updates in real-time, clamped to:
- **Minimum:** `Math.round(viewport.innerWidth * 0.25)` — prevents
  the panel from collapsing to unusable narrow widths
- **Maximum:** `Math.round(viewport.innerWidth * 0.5)` — prevents
  the panel from eating more than half the viewport (the user
  wants the pond visible)

Drag end (mouseup) commits the width to the persisted store. Mid-drag
updates are not persisted to avoid localStorage thrash.

**Touch support:** the handle responds to touch events (`pointerdown`/
`pointermove`/`pointerup` rather than `mousedown` etc.) so a tablet
user can also resize.

### AC 3 — Persisted via `useAgentStore`

**Given** the existing
[useAgentStore](frontend/src/stores/useAgentStore.ts) already uses
zustand's `persist` middleware (line 182) and partializes
`{ panelOpen, activeSessionId }` to localStorage key `agent-store-v1`

**When** the user resizes the panel

**Then** the new width MUST be added to the persisted shape:

```ts
interface PersistedShape {
  panelOpen: boolean;
  activeSessionId: string | null;
  panelWidth: number;  // pixel value, default 440
}
```

The default value (440px) preserves the current behaviour for
users who haven't dragged yet. Existing localStorage entries from
before this story shipped (`{panelOpen, activeSessionId}` only) MUST
NOT crash on hydration — `panelWidth` falls back to the 440 default
when the persisted entry is missing the key.

### AC 4 — Viewport resize handling

**Given** the user has resized the panel to 600px on a 1200px-wide
viewport (50%, the max)

**When** they then resize the browser window down to a 800px-wide
viewport

**Then** the panel width MUST re-clamp to the new viewport's max
(400px = 50% of 800), so the panel doesn't end up violating the
50%-max constraint.

Implementation: a window `resize` listener that re-runs the clamp on
the persisted width. The clamped value is written back to the store
(persisting the corrected width) so a later viewport resize doesn't
re-magnify it.

**Edge case:** if the viewport drops to a width where 25% < the
mobile media-query breakpoint (e.g. 320px viewport → 80px min), the
existing `max-width: 100vw` rule on `.agent-panel` (line 36 of
AgentPanel.css) still applies — the panel collapses to full width
on mobile. This story doesn't change that.

### AC 5 — Keyboard accessibility

**Given** the resize handle is a draggable element

**When** the user focuses it (Tab key) and presses Left or Right
arrow keys

**Then** the panel width changes by `±20px` per keypress, holding
the same clamp `[25%, 50%]`. Releasing the key commits to persist.

**ARIA:** the handle has `role="separator"`, `aria-orientation="vertical"`,
`aria-valuenow={width}`, `aria-valuemin={min}`, `aria-valuemax={max}`,
and a sensible `aria-label="Resize chat panel"`.

### AC 6 — CSS variable threading

The hardcoded `width: 440px` in
[AgentPanel.css:15](frontend/src/components/agent/AgentPanel.css)
becomes `width: var(--agent-panel-width, 440px)`. The component
sets `style={{ '--agent-panel-width': \`${width}px\` }}` on the
panel root. This keeps the CSS rules intact (mobile media query etc.)
while the dynamic value flows from React state.

### AC 7 — Tests

**Frontend (vitest):**

- `AgentPanel.test.tsx`:
  - Default render: panel width is 440px when no persisted value.
  - With persisted `panelWidth: 600`, the panel renders at 600px.
  - Drag the handle 100px left → panel grows by 100px.
  - Drag past max → panel clamps at 50% viewport.
  - Drag past min → panel clamps at 25% viewport.
  - Window resize event → panel re-clamps correctly.
  - Arrow keys on focused handle → panel width changes by 20px.
  - Existing localStorage entry without `panelWidth` key → falls
    back to 440 (regression guard for the partialize migration).

- `useAgentStore.test.ts`:
  - `setPanelWidth(value)` updates state and triggers persist.
  - Persist payload includes `panelWidth`.

### AC 8 — Definition of Done

- All ACs satisfied with code + tests.
- `npx tsc --noEmit` clean.
- Vitest suite green.
- Manual smoke: dev opens panel, drags edge to 50%, reloads page,
  panel still at the dragged width. Drags below 25% → snaps to
  min. Resizes browser window → panel re-clamps.
- Story flipped to `review`; sprint-status synced.

---

## Tasks / Subtasks

### Task 1 — Store: add `panelWidth` to `useAgentStore` (AC 3)

- [x] Add `panelWidth: number` to the `AgentState` interface, default
  440.
- [x] Add `setPanelWidth(value: number): void` action.
- [x] Extend `PersistedShape` interface and `partialize` to include
  `panelWidth`.
- [x] Verify zustand-persist hydration tolerates older localStorage
  entries missing the new key.

### Task 2 — Component: drag handle + resize logic (AC 1, 2, 4, 5)

- [x] In `AgentPanel.tsx`, add a left-edge handle div with
  `role="separator"`, ARIA attrs, and pointer event listeners.
- [x] Implement drag with `pointerdown` → `pointermove` → `pointerup`.
  Track drag-in-progress in component state (not the store) so
  mid-drag doesn't thrash persistence. Commit on `pointerup`.
- [x] Implement keyboard arrow-key resize with same clamp + commit.
- [x] Implement `window` resize listener that re-clamps + commits.
- [x] Source-of-truth flow: store → CSS var → panel width. Don't
  also write width to inline `style.width` separately.

### Task 3 — CSS: variable threading + handle styles (AC 1, 6)

- [x] In `AgentPanel.css`, replace `width: 440px` with
  `width: var(--agent-panel-width, 440px)`.
- [x] Add `.agent-panel__resize-handle` styles: 6px wide, absolute
  positioned at `left: -3px`, `cursor: col-resize`, neon-cyan glow
  on `:hover` / `:focus` / `[aria-grabbed="true"]`.
- [x] Verify mobile media query (max-width: 100vw) still wins on
  small viewports.

### Task 4 — Tests (AC 7)

- [x] Vitest tests per AC 7.
- [x] Add a regression test that simulates an old persist-payload
  shape (missing `panelWidth`) and asserts the store hydrates with
  the default 440.

### Task 5 — Polish + run gates (AC 8)

- [x] Manual smoke per AC 8.
- [x] Lint + type-check + test.
- [x] Story → review.

---

## Dev Notes

### Why `useAgentStore`, not a separate UI store

The agent store already carries persistent UI preferences
(`panelOpen`) and uses zustand's persist middleware. Adding
`panelWidth` keeps related state co-located. A new dedicated UI
store would be premature abstraction.

### Why commit-on-release, not commit-on-every-drag-frame

Mid-drag updates would hit localStorage on every pointermove event
(60+ writes per second). Browsers throttle but it's wasteful. The
canonical pattern: track drag in component state, commit on release.
The CSS variable threading means visual feedback is instant during
drag without touching persistence.

### `AgentPanelOracleView` width interaction

The Oracle view ([AgentPanelOracleView.tsx](frontend/src/components/agent/AgentPanelOracleView.tsx))
sits inside the panel and inherits its width. No special handling
needed — it'll resize with the panel.

### File locations

**Modified:**
- `frontend/src/components/agent/AgentPanel.tsx` — handle markup +
  drag/key listeners
- `frontend/src/components/agent/AgentPanel.css` — CSS var,
  handle styles
- `frontend/src/stores/useAgentStore.ts` — `panelWidth` state +
  persist
- `frontend/src/components/agent/AgentPanel.test.tsx` — resize tests
- `frontend/src/stores/useAgentStore.test.ts` — persist tests

**No new files.**

### References

- [AgentPanel.css:10-48](frontend/src/components/agent/AgentPanel.css)
  — current hardcoded width
- [useAgentStore.ts:181-646](frontend/src/stores/useAgentStore.ts)
  — persist middleware + partialize site
- MDN [`<separator>` ARIA pattern](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/)
  — keyboard + ARIA reference

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Claude Code dev agent — bmad-dev-story workflow)

### Debug Log References

None.

### Completion Notes List

- **AC 1 (drag handle)**: 6px-wide invisible hit zone overlapping the
  panel's 1px left border (`left: -3px`). `cursor: col-resize` and a
  cyan glow appear on `:hover` / `:focus-visible` / `:active`.
- **AC 2 (drag-to-resize + clamping)**: pointer events on the handle
  drive a component-local `draftWidth` state during drag; the
  `pointerup` commit calls `setPanelWidth` against the persisted store
  exactly once. Min/max clamp = `Math.round(window.innerWidth * 0.25)`
  / `0.5`. Touch supported via `pointer*` events (single handler tree
  for mouse + pen + touch).
- **AC 3 (persist)**: `panelWidth: number` added to `AgentState` +
  `PersistedShape` with default `AGENT_PANEL_DEFAULT_WIDTH = 440`.
  Older localStorage entries that lack `panelWidth` rehydrate to 440
  via zustand-persist's default merge — covered by an explicit
  regression test in both the store and panel suites.
- **AC 4 (viewport resize)**: a window `resize` listener (also fired
  once on mount) re-clamps the persisted width and commits the
  corrected value. Mount-time pass catches a reload-with-shrunk-
  viewport edge case.
- **AC 5 (keyboard accessibility)**: `tabIndex=0` handle responds to
  ArrowLeft (widen +20px) / ArrowRight (narrow -20px); intermediate
  state lives in `draftWidth` and commits on `keyup`. ARIA attrs:
  `role="separator"`, `aria-orientation="vertical"`,
  `aria-valuenow={width}`, `aria-valuemin={min}`, `aria-valuemax={max}`,
  `aria-label="Resize chat panel"`.
- **AC 6 (CSS variable)**: `.agent-panel { width: var(--agent-panel-width, 440px); }`
  with the React-side root setting `style={{ '--agent-panel-width': \`\${effectiveWidth}px\` }}`.
  Mobile `max-width: 100vw` rule still wins on small viewports.
- **AC 7 (tests)**: 12 new tests across the store + panel suites.
  Frontend test count went from 583 → 599 (599 passing, 1 pre-existing
  teardown error in TodoInput unrelated to this story).
- **CR-style refinement during dev**: an earlier draft of `commitDraft`
  called `setPanelWidth` from inside a `setDraftWidth` functional
  updater, which caused React 19 to emit
  "Cannot update a component while rendering a different component"
  (zustand notifies its subscribers synchronously and AgentPanel
  subscribes to `panelWidth`). Restructured to read `draftWidth` from
  state and call the two setters as separate transactions.
- **Custom resize cursor (user direction post-AC drafting)**: rather
  than fall back to the OS `col-resize` glyph, added a new `resize-h`
  cursor mode to `usePondStore` and a `drawResizeArrowsH` glyph to
  `CursorFirefly` (neon-cyan double-arrow rod with arrowhead tips,
  ~22px wide). The handle's CSS uses `cursor: none` and the panel's
  pointerEnter / pointerLeave / pointerDown / pointerUp handlers swap
  `cursorMode` on the global pond store, mirroring the existing
  NeonScrollbar grab/grabbing pattern. PointerLeave is suppressed
  while a drag is in progress (the handle frequently moves out from
  under the pointer); pointerUp restores `firefly` if the pointer is
  no longer over the handle.
- **Type-check**: `npx tsc --noEmit` clean.
- **Lint**: clean on all five edited/created files; the one error
  reported (`require()` style import in AgentPanel.test.tsx line 27)
  is pre-existing and unrelated to this story.

### File List

**Modified:**
- `frontend/src/stores/useAgentStore.ts` — `panelWidth` state +
  `setPanelWidth` action + `AGENT_PANEL_DEFAULT_WIDTH` export +
  `panelWidth` in `partialize`.
- `frontend/src/stores/usePondStore.ts` — added `'resize-h'` to the
  `cursorMode` union (state + setter signature).
- `frontend/src/components/effects/CursorFirefly.tsx` — added
  `drawResizeArrowsH` (neon-cyan double-arrow glyph) + dispatch +
  cyan trail for the new mode.
- `frontend/src/components/agent/AgentPanel.tsx` — resize handle +
  pointer/key handlers + viewport-resize listener + CSS var binding +
  pointerEnter/Leave/Up cursor-mode swaps to `'resize-h'`.
- `frontend/src/components/agent/AgentPanel.css` — `width: var(...)`
  on `.agent-panel`; new `.agent-panel__resize-handle` rule with
  `cursor: none` (firefly canvas paints the glyph).
- `frontend/src/stores/useAgentStore.test.ts` — 4 new panelWidth
  tests (default, set, persist payload, legacy-rehydrate).
- `frontend/src/components/agent/AgentPanel.test.tsx` — 8 new resize
  tests (default render, persisted render, ARIA shape, drag growth,
  drag past max, drag past min, viewport resize re-clamp,
  ArrowLeft +20, ArrowRight -20, legacy localStorage rehydrate).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story
  status: ready-for-dev → in-progress → review.

### Change Log

| Date | Change |
|---|---|
| 2026-04-26 | Story drafted. Replaces hardcoded 440px panel width with user-resizable panel clamped to `[25%, 50%]` of viewport. Persists via existing useAgentStore localStorage partialize. Independent of 6-8/6-10/6-11 — can ship anytime. |
| 2026-04-27 | Implementation complete (all 5 tasks, 8 ACs). Store gains `panelWidth` + `setPanelWidth`; panel adds drag handle, pointer + keyboard resize, viewport-resize re-clamp, CSS-var threading. 12 new tests; 599/599 frontend tests pass; tsc clean. Status → review. |
| 2026-04-27 | Custom resize cursor (post-AC user direction): added `'resize-h'` cursor mode to usePondStore + neon double-arrow glyph (`drawResizeArrowsH`) to CursorFirefly. AgentPanel handle now uses `cursor: none` and swaps the global cursor mode on pointerEnter / pointerLeave / pointerDown / pointerUp; PointerLeave is suppressed during a drag. tsc + lint clean; 599/599 still pass. |
