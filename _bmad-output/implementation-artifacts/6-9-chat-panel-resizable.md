# Story 6.9: Chat Panel Resizable

Status: ready-for-dev

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

- [ ] Add `panelWidth: number` to the `AgentState` interface, default
  440.
- [ ] Add `setPanelWidth(value: number): void` action.
- [ ] Extend `PersistedShape` interface and `partialize` to include
  `panelWidth`.
- [ ] Verify zustand-persist hydration tolerates older localStorage
  entries missing the new key.

### Task 2 — Component: drag handle + resize logic (AC 1, 2, 4, 5)

- [ ] In `AgentPanel.tsx`, add a left-edge handle div with
  `role="separator"`, ARIA attrs, and pointer event listeners.
- [ ] Implement drag with `pointerdown` → `pointermove` → `pointerup`.
  Track drag-in-progress in component state (not the store) so
  mid-drag doesn't thrash persistence. Commit on `pointerup`.
- [ ] Implement keyboard arrow-key resize with same clamp + commit.
- [ ] Implement `window` resize listener that re-clamps + commits.
- [ ] Source-of-truth flow: store → CSS var → panel width. Don't
  also write width to inline `style.width` separately.

### Task 3 — CSS: variable threading + handle styles (AC 1, 6)

- [ ] In `AgentPanel.css`, replace `width: 440px` with
  `width: var(--agent-panel-width, 440px)`.
- [ ] Add `.agent-panel__resize-handle` styles: 6px wide, absolute
  positioned at `left: -3px`, `cursor: col-resize`, neon-cyan glow
  on `:hover` / `:focus` / `[aria-grabbed="true"]`.
- [ ] Verify mobile media query (max-width: 100vw) still wins on
  small viewports.

### Task 4 — Tests (AC 7)

- [ ] Vitest tests per AC 7.
- [ ] Add a regression test that simulates an old persist-payload
  shape (missing `panelWidth`) and asserts the store hydrates with
  the default 440.

### Task 5 — Polish + run gates (AC 8)

- [ ] Manual smoke per AC 8.
- [ ] Lint + type-check + test.
- [ ] Story → review.

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

(populated by Dev agent)

### Debug Log References

(populated by Dev agent)

### Completion Notes List

(populated by Dev agent)

### File List

(populated by Dev agent)

### Change Log

| Date | Change |
|---|---|
| 2026-04-26 | Story drafted. Replaces hardcoded 440px panel width with user-resizable panel clamped to `[25%, 50%]` of viewport. Persists via existing useAgentStore localStorage partialize. Independent of 6-8/6-10/6-11 — can ship anytime. |
