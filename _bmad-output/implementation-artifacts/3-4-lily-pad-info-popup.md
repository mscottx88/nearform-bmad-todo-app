# Story 3.4: Lily Pad Info Popup (Hover-Preview + Focused-Interactive + Inline Edit)

Status: review

> **Amended 2026-04-23** (during code review, decisions D1/D2/D3): the original "sibling of ActionPopup" model was superseded during implementation. InfoPopup absorbed ActionPopup entirely (one LEFT-anchored panel that hosts both metadata and actions); an inline edit mode was added; and `NeonScrollbar` gained a second API (overlay mode) so a textarea can own its native scroll while NeonScrollbar drives the thumb chrome. See the Scope and Acceptance Criteria below for the as-shipped behaviour, and Dev Agent Record Implementation Notes #5-#7 for the deviation rationale.
>
> **Scope:** A per-pad popup that surfaces a todo's **metadata** (full text, timestamps, status flags, position, embedding state) on hover and stays up while the pad is focused (popup-active). In focused mode the same popup also hosts the actions that were previously in `ActionPopup` (Complete, Delete, Set Color) and an inline editor for the todo's text. Anchored to the **LEFT** of the pad. Neon cyan chrome, same glow vocabulary as the rest of the UI. Hover mode is read-only and non-interactive; focused mode is the interactive working surface for the pad.
>
> **Why now:** The pad label already renders the todo's text at readable size post-focus, but there's no affordance for non-trivial details (long text that overflows, when it was created, its embedding status, soft-deletion metadata). Hover-preview feels right for this pond's "hover-to-focus" UX language (ux-design-specification.md §Design Philosophy: _"Hover a lily pad — it responds."_). Consolidating the actions and inline edit into the same panel (rather than a separate ActionPopup on the opposite side) reduces split-attention during focused work and keeps every pad interaction in a single visual quadrant.
>
> **What ships:**
> 1. **`NeonScrollbar` port + overlay API** — copy `NeonScrollbar.tsx` + `NeonScrollbar.css` from `c:/Users/michael/nearform/rag-csv-crew/frontend/src/components/NeonScrollbar/` into this repo at `frontend/src/components/ui/NeonScrollbar/`. The ported file then grows a second mode (`scrollElement?: HTMLElement | null`) so consumers that own their scrollable element natively (e.g. a `<textarea>`) can still have the neon thumb chrome overlaid. Every scrollable region in this app must use this component rather than raw `overflow: auto` + per-component scrollbar CSS. See **Task 3a** and Dev Notes §"Scrollbar convention".
> 2. **New component `InfoPopup`** (`frontend/src/components/ui/InfoPopup.tsx` + `InfoPopup.css`). Rendered via drei `<Html>` and anchored to the pad's **LEFT** (negative X offset, negative Y offset). Absorbs ActionPopup's role — Complete/Delete/Set Color buttons and the color-swatch sub-panel now live inside InfoPopup in focused mode. `ActionPopup.{tsx,css,test.tsx}` are removed.
> 3. **Store slice** `hoveredTodoId: string | null` + `setHoveredTodoId(id | null)` on `usePondStore`. Tracks the pad the cursor is currently over.
> 4. **LilyPad hover wiring** — extend the existing `onPointerEnter` / `onPointerLeave` to additionally set/clear `hoveredTodoId`. Don't set on drag-in-progress or dissolving pads.
> 5. **PondScene mount** — render `<InfoPopup>` when EITHER `hoveredTodoId === todo.id` OR `activePopupTodoId === todo.id`. Pass action callbacks (`onComplete`, `onDelete`, `onCommitColor`, `onPreviewColor`, `onCommitText`) only in focused mode.
> 6. **Focused-mode interactivity** — when `activePopupTodoId === infoTodo.id`, panel gets `pointer-events: auto`; the text region is scrollable via `<NeonScrollbar color="cyan">` (wrap mode); action buttons appear below the meta block; the color-swatch sub-panel toggles from Set Color. Pure hover is non-interactive (`pointer-events: none`).
> 7. **Inline edit mode** (focused-only) — clicking the text region swaps the readonly text for a `<textarea>` with the neon scrollbar chrome in overlay mode. Enter commits, Escape cancels, `Ctrl/⌘/Shift+Enter` inserts a newline, IME composition is respected, and a neon resize handle at the textarea's bottom edge lets the user grow the editor up to `max(480, window.innerHeight - 160)` px.
> 8. **Content** — full text (wrapped, scrollable via NeonScrollbar), then a "meta rows" section: created / updated timestamps (localised, with relative hint), status badges (Active / Completed / Deleted / Archived / Embedding), position `(x, z)`. All legible in the dense pond.
>
> **Not in scope (defer):**
> - **Cross-pad comparisons / diff view.** One pad at a time.
> - **Conflict resolution for concurrent edits.** If the server's `todo.text` changes while the user is editing, commit is last-write-wins (no diff prompt). Revisit if concurrent editing becomes a real scenario.
> - **Accessibility sweep** (ARIA live regions, focus-trap for scrollable content, `aria-describedby` hook-up). Tracked under **4.4 Frontend A11y Sweep**. This story lays down minimal `role="dialog"` / `role="tooltip"` / `aria-live` hooks so 4.4 has something to build on.
> - **Animations.** Use a plain `opacity` transition; no bespoke motion here.

---

## Frontend conventions (recap)

- **Popup mount pattern**: drei `<Html>` at pad world position `[positionX, 0.4, positionY]`, with a zero-size anchor div containing an SVG callout and an absolutely-positioned panel. See [ActionPopup.tsx:98-122](frontend/src/components/ui/ActionPopup.tsx#L98-L122).
- **Neon panel styling** (reuse): `background: rgba(0, 0, 0, 0.82); border: 1px solid var(--neon-cyan); box-shadow: 0 0 8px var(--neon-cyan), 0 0 16px rgba(0, 238, 255, 0.35), inset 0 0 6px rgba(0, 238, 255, 0.08); font-family: var(--font-mono);`. Lifted verbatim from [ActionPopup.css:31-47](frontend/src/components/ui/ActionPopup.css#L31-L47).
- **Callout SVG**: neon cyan line, `stroke-width: 1.5`, `filter: drop-shadow(0 0 4px var(--neon-cyan))` — [ActionPopup.css:23-26](frontend/src/components/ui/ActionPopup.css#L23-L26).
- **Popup click absorption**: `onPointerDown / onPointerUp / onClick` all `stopPropagation()` on the panel root so clicks don't reach the water mesh. See [ActionPopup.tsx:131-133](frontend/src/components/ui/ActionPopup.tsx#L131-L133). InfoPopup needs this **only in focused mode** (not hover-only).
- **Wheel forwarding** (for OrbitControls zoom while mouse is over popup): [ActionPopup.tsx:139-161](frontend/src/components/ui/ActionPopup.tsx#L139-L161). InfoPopup follows the same pattern when it's focused; in hover-only mode `pointer-events: none` makes the wheel naturally fall through.
- **Zustand pattern**: identity-preserving writes (no-op on unchanged value) mirror `setActiveDragAnchor` / `setCursorMode` — see [usePondStore.ts:610-632](frontend/src/stores/usePondStore.ts#L610-L632).
- **Hover wiring**: existing `onPointerEnter` / `onPointerLeave` in [LilyPad.tsx:2491-2504](frontend/src/components/pond/LilyPad.tsx#L2491-L2504). Add a call inside both to maintain `hoveredTodoId`.
- **Testing**: Vitest + `@testing-library/react`. Drei `<Html>` is stubbed as a div in tests — see the opening lines of [ActionPopup.test.tsx](frontend/src/components/ui/ActionPopup.test.tsx). Mock fixtures need every required Todo field (incl. the newly required `rotationY` and `driftSeed`).

---

## Story

As a user of the pond,
I want to hover a lily pad to preview its details and click it to lock that detail panel open for scrolling through long text or scanning metadata,
so that I can inspect todos — especially ones whose pad labels are too compressed to read at a glance — without leaving the 3D scene.

---

## Acceptance Criteria

### Hover preview

1. **Given** a lily pad is at rest (phase `resting`, not being dragged, not currently dissolving), **When** I move the cursor over the pad mesh, **Then** within one frame an `InfoPopup` appears anchored to the left of the pad showing: (a) the full todo text, (b) a divider, (c) a meta rows block with at minimum `Created`, `Updated`, and `Status` fields.

2. **Given** the `InfoPopup` is visible in hover-only mode, **When** I move the cursor off the pad (and NOT onto the popup itself in this mode), **Then** the popup dismisses: the panel runs a ~100 ms fade-out animation (`opacity → 0`) and is then unmounted by `PondScene`. Hover-mode does not require the cursor to stay on the pad for any "grace period" — it tracks `onPointerLeave` directly.

2a. **Given** a drag of THIS pad starts (crosses the 4 px click/drag threshold), **Then** the pad immediately clears `hoveredTodoId` if it owned the hover, so the info popup fades out within the same 100 ms window as AC #2. The popup does NOT follow the pad during the drag. (CR reversal 2026-04-23 — see Dev Agent Record IN #1.)

2b. **Given** any visibility state, **When** the info popup first appears, **Then** its panel plays a 180 ms slide + fade-in animation (`info-popup-enter` keyframe: opacity `0 → 1`; `transform` from `translate(-(INFO_PANEL_OFFSET_X + 20)px, -INFO_PANEL_OFFSET_Y)` to rest `translate(-INFO_PANEL_OFFSET_X, -INFO_PANEL_OFFSET_Y)`). The animation uses `cubic-bezier(0.16, 1, 0.3, 1)` and `animation-fill-mode: both`.

3. **Given** a lily pad is being dragged (`isDraggingRef.current === true` for any pad, OR `activeDragAnchor !== null` for another pad) OR is in a non-`resting` phase (`forming`, `dropping`, `settling`, `pulsing`, `completing`, `completed`, `deleting`, `deleted`, `waiting`, `materializing`), **Then** its hover does NOT publish to `hoveredTodoId` — no info popup. Drag-start of this pad additionally clears any existing hover ownership (see AC #2a).

4. **Given** I hover pad A then quickly hover pad B without any gap, **Then** exactly one info popup is visible at a time (B's), not two. (`setHoveredTodoId` on enter naturally supersedes; leave on A fires AFTER enter on B in the DOM event order — the store's last-write-wins plus the "only clear if current === self" guard below prevents a stale clear.)

5. **Given** I hover a pad, **Then** the existing **firefly → grab** cursor swap continues to fire as it does today (story 4.6 mechanic). The hover popup is a new peer; it doesn't change the cursor.

### Focused mode (click-persistent, interactive)

6. **Given** I click a lily pad (threshold ≤ 4 px so it's a click, not a drag — per 4.2 AC #3), **Then** the `InfoPopup` opens on the left with (a) the meta block unchanged, (b) the **action buttons** (Complete / Delete / Set Color) rendered below a divider, and (c) the color-swatch sub-panel reachable via the Set Color toggle. The popup stays open regardless of whether my cursor is still over the pad.

7. **Given** the popup is focused (`activePopupTodoId === todoId`), **Then** the panel's `pointer-events` flip from `none` to `auto` AND the content region becomes vertically scrollable. Moving the cursor OFF the pad no longer hides the popup; it closes only via the close paths in AC #9.

8. **Given** the popup is focused and the todo text is longer than the scroll region's height, **When** I scroll the text (wheel over it, or drag the neon wireframe thumb), **Then** the text scrolls inside a `<NeonScrollbar color="cyan">` wrapper — the neon wireframe track + glowing thumb from `rag-csv-crew`, ported into this repo at Task 3a. Native browser scrollbars never appear anywhere (the global `::-webkit-scrollbar { display: none }` at [global.css:26-28](frontend/src/styles/global.css#L26-L28) stays in effect; NeonScrollbar provides its own DOM thumbs). OrbitControls zoom is NOT triggered by wheel over the panel.

9. **Given** the popup is focused, **When** the user triggers any of the popup-close paths — Escape (via `useClosePopupOnEscape`), Complete/Delete buttons, color-commit, or clicking outside — **Then** the `InfoPopup` hides. `activePopupTodoId` is the single visibility signal in focused mode; any pending edit-mode draft is discarded on close (see AC #17b).

### Positioning & aesthetic

10. **Given** any render state, **Then** the info popup is anchored to the **LEFT** of the pad — panel `transform: translate(-INFO_PANEL_OFFSET_X, -INFO_PANEL_OFFSET_Y)` where `INFO_PANEL_OFFSET_X = 280` clears the pad's hover ring + a comfortable margin. The callout SVG's `translate(-${INFO_PANEL_OFFSET_X}px, -100%)` is driven inline from the JSX so the JS constant is the single source of truth for the offset.

11. **Given** the popup is focused with action buttons visible, **Then** the meta block (top) and action block (bottom) are separated by a thin neon-cyan divider. The panel has no fixed `max-height` — it grows with content (meta rows + text + actions + optional swatch sub-panel) and the text region inside owns its own scroll cap.

12. **Given** any visibility state, **Then** the info popup uses exactly these neon tokens (matching the rest of the UI): panel background `rgba(0, 0, 0, 0.82)`, border `1px solid var(--neon-cyan)`, triple-layer box-shadow glow from ActionPopup.css:40-43, `font-family: var(--font-mono)`, per-text-row base color `var(--neon-cyan)`, status badges use their semantic neon (`--neon-green` active, `--neon-pink` deleted, `--neon-gold` archived, `--neon-orange` for embedding pending/failed).

13. **Given** the popup's callout SVG, **Then** it draws a neon-cyan line from the pad anchor to the panel's inner corner (upper-right corner of the panel, which is the corner nearest the pad) with the same `stroke-width: 1.5` + `filter: drop-shadow(0 0 4px var(--neon-cyan))` as ActionPopup, visually mirrored.

### Meta-rows content

14. **Given** the info popup is visible, **Then** the meta section renders the following rows in this order, each as `<label>: <value>` on its own line (monospace, `font-size: 11px`, rows separated by `gap: 3px`):
    - `Created` — formatted as `YYYY-MM-DD HH:mm` from `todo.createdAt` (local time), plus a relative hint (`"(3 days ago)"`) computed at render time (no live ticking — OK if stale during a long-open popup).
    - `Updated` — same format/hint from `todo.updatedAt`, but only IF `updatedAt !== createdAt` (skip the row on pristine todos).
    - `Status` — one or more badges drawn inline on the value side of the row:
      - `ACTIVE` (neon green) if not completed and not deleted and not archived.
      - `COMPLETED` (neon green ring + filled green text) if `todo.completed`.
      - `DELETED` (neon pink) if `todo.deleted`.
      - `ARCHIVED` (neon gold) if `todo.archived`.
    - `Embedding` — shown only when `embeddingStatus !== 'complete'`. Rendered as a **pill badge** (`<StatusBadge>` — same component the Status row uses) with the uppercase status label (`PENDING` / `FAILED`) in the corresponding neon color (orange for pending, pink for failed). Hides on `complete` to keep the panel quiet for the common case.
    - `Position` — `(x, z)` rounded to two decimals. Guarded with `Number.isFinite(...) ? .toFixed(2) : '—'` so a malformed drag anchor never renders `"NaN, NaN"`. During drag the row displays the live drag position (see Dev Agent Record IN #4); otherwise it reflects `todo.positionX / todo.positionY`.

15. **Given** the todo's `text` field is longer than ~80 characters, **Then** the text wraps and, when focused, scrolls — not truncated with ellipsis. Hover-only mode may clip via the panel's max-height but the text shouldn't hard-truncate with "…".

### Inline edit mode (focused-only)

17. **Given** the popup is focused AND an `onCommitText` callback is wired by the parent, **When** I click the text region (or press Enter / Space while it has keyboard focus), **Then** the readonly text swaps to an inline `<textarea>` pre-populated with the todo's current text. The textarea auto-focuses and the cursor sits at the start of the content.
    - **17a.** The editor region has a fixed starting height (`EDITOR_DEFAULT_HEIGHT = 180 px`) with a neon resize handle at its bottom edge. Dragging the handle grows/shrinks the region within `[EDITOR_MIN_HEIGHT = 80, max(480, window.innerHeight - 160)]` px. The upper bound re-evaluates on `window.resize` so a mid-edit viewport change keeps the handle reachable.
    - **17b.** The popup losing focus (`focused` flips to `false`) discards any pending edit draft without committing. The editor also collapses to `EDITOR_DEFAULT_HEIGHT` so the next open starts fresh.

18. **Given** I am editing, **When** I press a key, **Then** the keymap is:
    - **Enter** (plain) — commit the edit. If the trimmed value differs from `todo.text`, call `onCommitText(trimmed)`; otherwise exit edit mode silently. Either way, close the editor.
    - **Escape** — cancel: discard the draft, reset `editText` to `todo.text`, and close the editor.
    - **Ctrl/Meta/Shift + Enter** — insert a newline at the caret/selection. Uses a functional `setEditText((prev) => ...)` + post-`requestAnimationFrame` caret restoration (guarded by `t.isConnected` so a mid-edit unmount can't touch a detached textarea).
    - **Any Enter while `e.nativeEvent.isComposing || e.keyCode === 229`** — deferred entirely (the keystroke confirms an IME composition; it is not a commit and not a newline).
    - Enter and Escape both call `stopPropagation()` so PondScene-level keymaps don't double-handle them.

19. **Given** the trimmed editor value is empty / whitespace-only, **When** I press Enter, **Then** commit is a silent no-op: the editor closes, no callback fires, the pad's text is unchanged. Rationale: deleting a todo is an explicit Delete action, not an emergent side-effect of clearing text. (No visible "cannot be empty" feedback in this story — UX revisit is deferred.)

20. **Given** the server's `todo.text` changes during an active edit (remote mutation, optimistic update from elsewhere), **Then** the editor's in-flight draft is the user's canonical value — the incoming change does not clobber the draft. On commit, the user's text wins (last-write-wins). Conflict detection + prompt is explicitly out of scope.

21. **Given** I wheel-scroll over the popup while editing, **Then** the wheel event is always stopped at the panel — it never bubbles to the OrbitControls zoom handler, even at the textarea's scroll boundaries. (Readonly mode keeps the bubble-at-boundary behaviour so scrolling past the end of the text still moves the camera; edit mode does not.)

### Quality gate

22. **Given** I run `npx vitest run` after this story, **Then** all existing tests plus new tests pass. New tests cover: (a) hover sets `hoveredTodoId`; (b) leave clears it (if still current); (c) drag-in-progress blocks hover publish; (d) dissolving-phase pad does not publish; (e) focused mode toggles panel `pointer-events`; (f) `Escape` closes the popup; (g) meta-rows render the expected labels/badges for representative Todo shapes (active, completed, deleted, archived, embedding-pending); (h) action buttons appear only in focused mode; (i) text click opens the inline editor; (j) Enter commits, Escape cancels, Ctrl+Enter inserts newline; (k) empty-text commit is silent no-op; (l) focus loss discards the edit draft.

---

## Tasks / Subtasks

- [x] **Task 1: Store slice — `hoveredTodoId`** (AC: #1, #2, #3, #4)
  - [x] In [frontend/src/stores/usePondStore.ts](frontend/src/stores/usePondStore.ts):
    - [x] Add to `PondState`:
      ```ts
      /** Story 3.4: id of the pad the cursor is currently over, or
       *  null. Published by LilyPad's onPointerEnter/Leave and read
       *  by PondScene to decide whether to mount InfoPopup in hover
       *  mode. Identity-preserving setter (no-op on unchanged
       *  value) keeps the store from thrashing on rapid re-hovers. */
      hoveredTodoId: string | null;
      setHoveredTodoId: (id: string | null) => void;
      ```
    - [x] Initialise `hoveredTodoId: null` in the `create(...)` body.
    - [x] Implement `setHoveredTodoId`:
      ```ts
      setHoveredTodoId: (id) => {
        if (get().hoveredTodoId === id) return;
        set({ hoveredTodoId: id });
      },
      ```
  - [x] Test coverage in [frontend/src/stores/usePondStore.test.ts](frontend/src/stores/usePondStore.test.ts):
    - [x] Initial value is `null`.
    - [x] `setHoveredTodoId('a')` updates; `setHoveredTodoId('a')` again is a no-op (state reference preserved).
    - [x] `setHoveredTodoId(null)` clears.

- [x] **Task 2: LilyPad hover wiring** (AC: #1, #2, #3, #4, #5)

  Extend the existing cursor-swap handlers in [LilyPad.tsx:2491-2504](frontend/src/components/pond/LilyPad.tsx#L2491-L2504).

  - [x] `onPointerEnter`: after the existing cursor swap, if `phaseRef.current === 'resting'` AND `!isDraggingRef.current` AND `!state.completingTodos.has(todo.id)` AND `!state.deletingTodos.has(todo.id)` AND `usePondStore.getState().activeDragAnchor === null`, call `state.setHoveredTodoId(todo.id)`. (The last guard — `activeDragAnchor === null` — is "no OTHER pad is being dragged"; a hover mid-drag is distracting and fires hoveredTodoId thrash during cascade.)
  - [x] `onPointerLeave`: after the existing cursor revert, if `usePondStore.getState().hoveredTodoId === todo.id`, call `state.setHoveredTodoId(null)`. The `=== todo.id` guard protects against the "A.leave fires after B.enter" event-order race — only clear if we're still the current hover.
  - [x] Unmount cleanup: in the existing unmount effect that clears `activeDragAnchor` and `displacedPads` for own id ([LilyPad.tsx:723-737](frontend/src/components/pond/LilyPad.tsx#L723-L737)), also clear `hoveredTodoId` if it equals `todo.id`. Prevents a ghost hover when a pad unmounts (deletion refetch) while hovered.
  - [x] ~~Drag-start cleanup~~ — **Reversed per user correction (2026-04-23):** dragging the hovered pad must NOT clear `hoveredTodoId`, because the pad is still under the cursor. The popup should follow the dragged pad. The `onPointerEnter` guard (which blocks publishing *new* hover during a drag) is sufficient on its own. Code at the `isDraggingRef.current = true` block contains a note explaining the reversal.

- [x] **Task 3a: Port `NeonScrollbar` from `rag-csv-crew`** (AC: #8)

  This app's scrollbar convention, going forward: every scrollable region uses the `NeonScrollbar` component. No raw `overflow: auto` + per-component scrollbar CSS. The source already exists, fully-featured, in the sibling `rag-csv-crew` repo — port it verbatim so the todo-app inherits all of its behaviour (DOM-based thumbs that the firefly cursor can track during drag, RAF-debounced resize/mutation observers, track-click-to-jump, color variants, optional virtual-scroll hooks).

  - [x] Create `frontend/src/components/ui/NeonScrollbar/` (new directory).
  - [x] Copy `c:/Users/michael/nearform/rag-csv-crew/frontend/src/components/NeonScrollbar/NeonScrollbar.tsx` → `frontend/src/components/ui/NeonScrollbar/NeonScrollbar.tsx`. Do NOT modify the implementation; this is a verbatim port so the two repos stay in sync.
  - [x] Copy `c:/Users/michael/nearform/rag-csv-crew/frontend/src/components/NeonScrollbar/NeonScrollbar.css` → `frontend/src/components/ui/NeonScrollbar/NeonScrollbar.css`. Verbatim.
  - [x] Add an `index.ts` barrel: `export { NeonScrollbar } from './NeonScrollbar'; export type { NeonScrollbarColor } from './NeonScrollbar';`. Keeps imports short (`import { NeonScrollbar } from '@/components/ui/NeonScrollbar'` or the relative equivalent).
  - [x] Verify the CSS variable `--neon-cyan` in this repo matches the component's internal `0, 238, 255` expectation (it does — see [neon-tokens.css](frontend/src/styles/neon-tokens.css) — but double-check, because the NeonScrollbar hard-codes the RGB triplet inline for its color variants). If the tokens diverge, add a brief comment pointing at both sources so a future edit to one flags the need to update the other.
  - [x] Smoke-test the port: import it in a throwaway test file and render `<NeonScrollbar><div style={{ height: 2000 }} /></NeonScrollbar>` inside a `max-height: 200px` container. Thumb appears, thumb drags scroll, track click jumps. Delete the throwaway test before commit.
  - [x] If the todo-app's TS / ESLint strictness flags anything the rag-csv-crew version used (e.g. `any`, unused params), prefer narrowly-scoped eslint-disable comments over restructuring — keep the port verbatim so future diffs across repos are minimal.

- [x] **Task 3: `InfoPopup` component** (AC: #1, #6, #7, #8, #10, #12, #13, #14, #15)
  - [x] Create [frontend/src/components/ui/InfoPopup.tsx](frontend/src/components/ui/InfoPopup.tsx) and [frontend/src/components/ui/InfoPopup.css](frontend/src/components/ui/InfoPopup.css).
  - [x] Component signature:
    ```ts
    interface InfoPopupProps {
      todo: Todo;
      focused: boolean;   // true iff activePopupTodoId === todo.id
    }
    export function InfoPopup({ todo, focused }: InfoPopupProps): React.ReactElement;
    ```
  - [x] Structural skeleton (mirrors ActionPopup):
    ```tsx
    const INFO_PANEL_OFFSET_X = 280;  // panel sits 280 px LEFT of anchor
    const INFO_PANEL_OFFSET_Y = 120;  // and 120 px UP (same as ActionPopup)
    return (
      <Html
        position={[todo.positionX ?? 0, 0.4, todo.positionY ?? 0]}
        zIndexRange={[16777271, 0]}
        style={{ pointerEvents: 'none', zIndex: 9998 }}  // one below ActionPopup
      >
        <div className="info-popup">
          <svg
            className="info-popup__callout"
            width={INFO_PANEL_OFFSET_X}
            height={INFO_PANEL_OFFSET_Y}
            viewBox={`0 0 ${INFO_PANEL_OFFSET_X} ${INFO_PANEL_OFFSET_Y}`}
          >
            {/* line from pad anchor (top-right of SVG) to panel inner corner (top-left of panel) */}
            <line x1={INFO_PANEL_OFFSET_X} y1={INFO_PANEL_OFFSET_Y} x2="0" y2="0" />
          </svg>
          <div
            className={`info-popup__panel info-popup__panel--${focused ? 'focused' : 'hover'}`}
            style={{
              transform: `translate(-${INFO_PANEL_OFFSET_X}px, -${INFO_PANEL_OFFSET_Y}px)`,
            }}
            role={focused ? 'dialog' : 'tooltip'}
            aria-live="polite"
            // Click / wheel absorption ONLY when focused — hover-only stays pointer-events:none
            {...(focused && {
              onPointerDown: (e) => e.stopPropagation(),
              onPointerUp: (e) => e.stopPropagation(),
              onClick: (e) => e.stopPropagation(),
              onWheel: (e) => {
                // forward to canvas so OrbitControls zoom works (same as ActionPopup)
              },
            })}
          >
            {/* Scrollable text region. The NeonScrollbar wraps the text
                so its overflow gets the project-wide neon wireframe
                scroll chrome. In hover-only mode the whole panel has
                `pointer-events: none`, so the scrollbar is invisible-
                but-present; in focused mode the `pointer-events: auto`
                on the panel root lets the user drag the thumb / click
                the track. NeonScrollbar needs a bounded height — pass
                `style={{ maxHeight: 180 }}` (or put it in a flex item
                with `flex: 1 1 auto; min-height: 0`). */}
            <NeonScrollbar color="cyan" style={{ maxHeight: 180 }}>
              <div className="info-popup__text">{todo.text}</div>
            </NeonScrollbar>
            <div className="info-popup__divider" />
            <div className="info-popup__meta">{/* rows per AC #14 */}</div>
          </div>
        </div>
      </Html>
    );
    ```
  - [x] CSS in [InfoPopup.css](frontend/src/components/ui/InfoPopup.css):
    - [x] `.info-popup` — zero-size anchor, `pointer-events: none`, `font-family: var(--font-mono)` (same as `.action-popup`).
    - [x] `.info-popup__callout` — absolute positioning mirrored: `left: 0; top: 0; transform: translate(-${INFO_PANEL_OFFSET_X}px, -100%)` so the SVG covers the left-upward quadrant. Stroke + drop-shadow identical to `.action-popup__callout line`.
    - [x] `.info-popup__panel` — `position: absolute; left: 0; top: 0;` (transform is applied inline). `min-width: 240px; max-width: 320px;`. Background / border / box-shadow / border-radius: **copy verbatim from `.action-popup__panel`** (ActionPopup.css:31-47). Add `max-height: 280px` and `display: flex; flex-direction: column; gap: 8px;`. `overflow: hidden` on the panel root (the inner text region owns scrolling).
    - [x] `.info-popup__panel--hover` — `pointer-events: none` (cursor passes through).
    - [x] `.info-popup__panel--focused` — `pointer-events: auto; user-select: text` (user may want to copy the todo's text).
    - [x] `.info-popup__text` — typography only. `color: var(--neon-cyan); text-shadow: 0 0 2px currentColor; font-size: 12px; line-height: 1.45; white-space: pre-wrap; word-break: break-word;`. No `overflow-y` / scrollbar styling here — the parent `<NeonScrollbar>` owns scrolling. The `NeonScrollbar` wrapper itself lives in the JSX and gets its max-height via `style={{ maxHeight: 180 }}` (per AC #8); do NOT duplicate the max-height in this CSS class.
    - [x] `.info-popup__divider` — 1 px `var(--neon-cyan)` horizontal rule with 40 % alpha (`rgba(0, 238, 255, 0.4)`) and a `drop-shadow(0 0 2px var(--neon-cyan))` filter. Adds visual rhythm between text and meta rows.
    - [x] `.info-popup__meta` — `display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; font-size: 11px; letter-spacing: 0.04em;`. Label cells are dim (`color: rgba(0, 238, 255, 0.6)`, `text-transform: uppercase`); value cells are full neon-cyan.
    - [x] `.info-popup__badge` — inline-block pill: `padding: 1px 6px; border: 1px solid currentColor; border-radius: 2px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.08em; text-shadow: 0 0 3px currentColor; box-shadow: 0 0 4px currentColor;`. Badge colors applied as `color: var(--neon-green)` (active / completed), `color: var(--neon-pink)` (deleted), `color: var(--neon-gold)` (archived), `color: var(--neon-orange)` (embedding pending), `color: var(--neon-pink)` (embedding failed).
  - [x] Meta-row formatting helpers (inline or in `frontend/src/utils/formatTodoMeta.ts` if they grow > 20 lines):
    - [x] `formatTimestamp(iso: string): string` — returns `"YYYY-MM-DD HH:mm"` in local time.
    - [x] `formatRelative(iso: string): string` — returns `"(just now)" | "(Nm ago)" | "(Nh ago)" | "(Nd ago)" | "(N weeks ago)" | "(on YYYY-MM-DD)"`. Snapshot at render time — don't set up a ticker, the popup is short-lived.
  - [x] Import the CSS side-effect in [InfoPopup.tsx](frontend/src/components/ui/InfoPopup.tsx): `import './InfoPopup.css';`.
  - [x] Wheel handler (focused mode only): identical pattern to [ActionPopup.tsx:139-161](frontend/src/components/ui/ActionPopup.tsx#L139-L161) — dispatch a synthetic `WheelEvent` to the canvas, `preventDefault` the original event. Lets OrbitControls keep zooming when the cursor is over the focused panel.

- [x] **Task 4: PondScene wiring** (AC: #1, #6, #7, #9, #11)

  In [frontend/src/components/pond/PondScene.tsx](frontend/src/components/pond/PondScene.tsx):

  - [x] Import `InfoPopup` alongside the existing `ActionPopup` import.
  - [x] Select the hover id from the store: `const hoveredTodoId = usePondStore((s) => s.hoveredTodoId);` near the existing `activePopupTodoId` selector.
  - [x] Determine the target todo:
    ```ts
    const infoTodoId = activePopupTodoId ?? hoveredTodoId;
    const infoTodo = infoTodoId
      ? renderTodos.find((t) => t.id === infoTodoId)
      : undefined;
    ```
    Reuse the already-computed `renderTodos` array (don't spin up a new visibility-filtered fetch).
  - [x] Render:
    ```tsx
    {infoTodo && (
      <InfoPopup todo={infoTodo} focused={activePopupTodoId === infoTodo.id} />
    )}
    ```
    Position it next to the existing `ActionPopup` block ([PondScene.tsx:222-246](frontend/src/components/pond/PondScene.tsx#L222-L246)) — both under the same `<Canvas>` subtree.
  - [x] Do NOT add any new close handler here — focused-mode close is handled by the existing ActionPopup callbacks (which call `store.closePopup()`), and `activePopupTodoId` going null naturally flips `infoTodo` to the hover-only source or `undefined`.

- [x] **Task 5: Tests** (AC: #16)
  - [x] Create [frontend/src/components/ui/InfoPopup.test.tsx](frontend/src/components/ui/InfoPopup.test.tsx):
    - [x] Mock `@react-three/drei` with a div `Html` shim (see the opening of [ActionPopup.test.tsx](frontend/src/components/ui/ActionPopup.test.tsx)).
    - [x] Build a `makeTodo(overrides)` helper that includes `rotationY: 0` and `driftSeed: 0` defaults (required in the 2026-04-23 Todo shape — see how other test fixtures already do this).
    - [x] Hover mode (`focused={false}`):
      - [x] Renders the full todo text.
      - [x] Renders `Created` row with a formatted timestamp.
      - [x] Renders `Status: ACTIVE` badge for a pristine todo.
      - [x] Panel root carries `pointer-events: none` (assert via `getComputedStyle` — jsdom supports inline styles; the CSS class maps to a class selector, so it's fine to assert the class name only: `expect(panel).toHaveClass('info-popup__panel--hover');`).
    - [x] Focused mode (`focused={true}`):
      - [x] Panel carries `info-popup__panel--focused`.
      - [x] `onPointerDown` on the panel calls `stopPropagation` (fire a pointerDown, verify the synthetic event's propagation stopped via a parent listener).
      - [x] `role` attribute is `dialog` (not `tooltip`).
    - [x] Status combinations: deleted-only → `DELETED` badge only. Completed-and-archived → both badges render. Embedding `pending` → `Embedding: PENDING` row shows; `complete` → no embedding row.
    - [x] `updatedAt === createdAt` → only `Created` row, no `Updated`.
  - [x] Extend [frontend/src/components/pond/LilyPad.test.tsx](frontend/src/components/pond/LilyPad.test.tsx):
    - [x] Add `setHoveredTodoId` to the `usePondStore.getState()` mock (as a `vi.fn()`) and add `hoveredTodoId: null` to the mocked state — other tests fail otherwise when the pointer handlers call it.
    - [x] Test: pointerEnter on a resting pad → `setHoveredTodoId` called with the pad's id.
    - [x] Test: pointerLeave after enter → `setHoveredTodoId(null)` (when `hoveredTodoId` in the mock equals the pad's id).
    - [x] Test: pointerEnter while `completingTodosMock.has(id)` → `setHoveredTodoId` NOT called.
    - [x] Test: during a drag (`isDraggingRef` flipped via a crossed-threshold pointermove), pointerEnter on ANY pad does NOT call `setHoveredTodoId`. (This is approximated by setting `activeDragAnchor` in the mock to a non-null value before firing enter.)
  - [x] Extend [frontend/src/stores/usePondStore.test.ts](frontend/src/stores/usePondStore.test.ts):
    - [x] `setHoveredTodoId` round-trip + no-op-on-unchanged (mirrors `setCursorMode` tests).
  - [x] Run `npx tsc --noEmit -p tsconfig.app.json` — must be clean.
  - [x] Run `npx vitest run` — must be green.
  - [x] Backend is untouched in this story: no Python tests or migrations required.

---

## Dev Notes

### Why a dedicated store slice instead of passing hover down via prop drilling

LilyPad instances are rendered inside the R3F Canvas; PondScene mounts the popups. The shortest path between "which pad did the cursor just enter" (a LilyPad concern) and "render InfoPopup for that pad" (a PondScene concern) is the store — same architecture that `activePopupTodoId`, `activeDragAnchor`, `displacedPads`, and `cursorMode` all use. Selector subscriptions keep re-renders scoped (PondScene re-renders only when `hoveredTodoId` actually changes, thanks to the no-op-on-unchanged guard in `setHoveredTodoId`).

### Event-order subtlety on rapid pad-to-pad hover

Browsers fire `pointerLeave` on the OLD element AFTER `pointerEnter` on the NEW element. Naive wiring ("enter publishes id, leave clears to null") would leave a one-frame gap where the new pad's id is published then immediately nulled, and THEN nothing. The `leave` guard (`if (store.hoveredTodoId === todo.id) set null`) prevents this: A's leave runs after B's enter, by which point `hoveredTodoId === B.id`, so A's check fails and no clear happens. B's hover stays live.

### Why focused mode gets `pointer-events: auto` but hover-only gets `none`

Hover mode is informational only — moving the cursor onto the panel would cancel the pad's hover (pointer leaves the mesh) and the popup would vanish underneath the cursor. Making hover-mode `pointer-events: none` means the cursor passes through the panel back to the water / pad beneath, and the popup is effectively a glued-on label that follows the cursor's hover target. Focused mode is a commitment — user has clicked — so the panel stakes a claim to the cursor and supports scroll + text selection.

### Scrollbar convention: always `<NeonScrollbar>`

This app globally hides native scrollbars ([global.css:26-28](frontend/src/styles/global.css#L26-L28)). Any region that needs to scroll uses the ported `NeonScrollbar` component — never raw `overflow: auto` with `::-webkit-scrollbar` styling + bespoke thumb DOM. Rationale:

- **Firefly cursor integration.** Native scrollbars capture input at the OS compositor level; the firefly-trail cursor goes blind the moment the user grabs a native thumb. NeonScrollbar uses DOM thumbs and fires standard `mousemove`, so the cursor keeps tracking during drag — critical for this app's custom-cursor aesthetic.
- **One scrollbar vocabulary.** Neon wireframe track + glowing thumb, same palette variants (cyan / orange / gold / green / pink), same interaction idioms (click track to jump, drag thumb to scroll). Future scrollable regions (long text in a delete-confirmation dialog, a settings panel, a debug table) drop straight in without re-solving this.
- **Local fork; no upstream-sync contract.** The component at `frontend/src/components/ui/NeonScrollbar/` began life as a port from `rag-csv-crew` but is now a local fork with app-specific features (`onThumbHover` / `onThumbDrag` callbacks for firefly-cursor swaps, `.nsb-thumb { cursor: none }` override, `input` listener + descendant-tree `ResizeObserver` + broadened `MutationObserver`, plus the overlay mode documented below). Evolve the component in-place here; there is no contract to re-sync with the upstream source.

**Two modes:**

`NeonScrollbar` has two APIs, chosen by props:

1. **Wrap mode** (default) — pass `children`. NeonScrollbar renders an inner scrollable div containing them. Use this for regular DOM content:

    ```tsx
    <NeonScrollbar color="cyan" style={{ maxHeight: 180 }}>
      <div>{/* any content that might overflow */}</div>
    </NeonScrollbar>
    ```

2. **Overlay mode** — pass `scrollElement={someHTMLElementOrNull}`. NeonScrollbar renders only tracks + thumbs and drives them against the external element's `scrollTop` / `scrollHeight`. Use this when the scrollable is an element the consumer must own (e.g. a `<textarea>`, an `<input type="textarea">`, a pre-existing scroll container that can't be wrapped). Layout: wrap the owned scrollable + the `<NeonScrollbar scrollElement=...>` in a `position: relative` parent; NeonScrollbar applies `position: absolute; inset: 0` via its `.neon-scrollbar--overlay` modifier.

    ```tsx
    const [textareaEl, setTextareaEl] = useState<HTMLTextAreaElement | null>(null);

    <div style={{ position: 'relative', height: 200 }}>
      <textarea ref={setTextareaEl} style={{ width: '100%', height: '100%', overflowY: 'auto' }} />
      <NeonScrollbar scrollElement={textareaEl} color="cyan" />
    </div>
    ```

    Pass the element as state (not `useRef.current`) so NeonScrollbar's effects re-run on mount — `useRef` mutations don't trigger re-renders and can leave the scrollbar stuck in a "no element" state when mounted inside a drei `<Html>` portal.

Pick a `color` that matches the surrounding chrome — cyan for the info popup (matches the popup's cyan border + glow), other variants for future contexts. The component accepts `innerClassName` / `innerStyle` (wrap mode) / `onThumbHover` / `onThumbDrag` (both modes — used for firefly → frog-hand cursor swaps). See `NeonScrollbarProps` for the full surface.

### Positioning math

Per the D1 amendment, ActionPopup is gone — the merged InfoPopup is the only per-pad popup. The panel sits at `translate(-INFO_PANEL_OFFSET_X, -INFO_PANEL_OFFSET_Y)` from the pad anchor, where both constants live at the top of `InfoPopup.tsx`. The callout SVG's `translate(-INFO_PANEL_OFFSET_X px, -100%)` is driven inline from the JSX so the pixel offset is defined in exactly one place (previously the CSS had a hardcoded `translate(-280px, -100%)` that could drift out of sync — fixed during CR).

Tuning guidance: `INFO_PANEL_OFFSET_X = 280` clears the pad's hover ring (radius ~80 px) plus a comfortable margin and reserves space for the panel itself (up to ~260 px wide with meta + actions). If you tune the offset DOWN below 240 or UP past the viewport, re-check that the focused popup still fits on-screen for pads near the viewport edges — there's no edge-flipping logic yet.

### Deferred items

- **A11y parity with dialogs** — focus-trap, descriptive aria-labels for every meta row, announce changes on open/close. Tracked in **4.4 Frontend A11y Sweep**. This story lays the minimal `role` / `aria-live` hooks; the sweep will layer the rest.
- **Copy-to-clipboard button** — would be a nice addition for long texts once focused. Out of scope.
- **Pad label tooltips on overflow only** — some teams show the info popup only when the pad label is truncated. We're unconditional for simplicity; an opt-in "quiet hover" mode can ship later as a store toggle.
- **Animation polish** — subtle fade-in / translate-in when the popup mounts. ActionPopup doesn't have one either; add both in a shared polish pass.

---

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 (claude-sonnet-4-6)

### Implementation Notes

Deviations from the original spec, all user-directed:

1. **Drag-start cleanup — reversed, then re-reversed.** Original spec: clear `hoveredTodoId` on drag-start. First implementation: kept as spec'd. Second implementation (2026-04-23 user correction): REVERSED so the popup follows the drag. Third implementation (2026-04-23 CR reversal, Group 3 D1): RE-REVERSED to the original behaviour — drag-start clears hover; the popup fades out via the 100 ms exit animation and can reappear only after release + a fresh `pointerEnter`. Rationale for the final state: following the drag required sticky-position state (IN #3), drag-reentry branches, and release re-sync logic that collectively grew 3 HIGH-severity CR findings before the reversal. The exit animation + instant re-entry feel cleaner than a dragged popup. See `LilyPad.tsx` `onPointerDown` (drag-start clear) and the inline comment marked "CR reversal 2026-04-23".

2. **Popup follows the live drag position — REMOVED.** The `activeDragAnchor` subscription, live-position override, and release-flash mitigation (IN #3) are all gone. InfoPopup now reads `todo.positionX / todo.positionY` directly. The popup is absent during the entire drag (per IN #1 CR reversal), so there is no position to track.

3. **Release-flash mitigation — REMOVED.** The sticky-position `useState` + convergence-check effect + 2 s safety timeout are all gone with IN #2. Since the popup is not shown during drag, there is no release-flash to mitigate.

4. **Position meta row — simplified to static value.** The "Position (x, z)" row now reads `todo.positionX / todo.positionY` directly (guarded by `Number.isFinite` to avoid `"NaN, NaN"` on malformed server payloads — see IN #8). The live-value reading under IN #4 is gone along with IN #2/#3.

5. **ActionPopup merged into InfoPopup.** The original spec framed InfoPopup as a sibling of ActionPopup ("details left, actions right"). During implementation the user consolidated both into a single left-anchored panel: InfoPopup now contains the meta block, the text region, the action buttons (Complete / Delete / Set Color), and the color-swatch sub-panel. `ActionPopup.{tsx,css,test.tsx}` were deleted. Rationale: keeping the user's attention in a single visual quadrant during focused work, avoiding the split-screen read that required looking both sides of the pad simultaneously. Spec ACs #6, #11, and the "Positioning math" section were amended at code-review time to match shipped reality (decision D1).

6. **Inline edit mode shipped despite "Not in scope".** The spec originally punted text editing to a future story; during implementation the user requested inline edit be added. The text region is clickable in focused mode (with `onCommitText` wired); click swaps to a `<textarea>` with Enter-to-save, Escape-to-cancel, `Ctrl/⌘/Shift+Enter` for newline, and IME-composition detection. A neon resize handle lets the user grow the editor up to `max(480, window.innerHeight - 160)` px. Empty/whitespace commit is a silent no-op (deleting a todo is an explicit action). Remote text changes during edit are overwritten on commit (last-write-wins, no conflict prompt). Spec "Not in scope" §1 was removed and new ACs #17–#21 added at code-review time (decision D2).

7. **Bespoke edit-mode scrollbar replaced with NeonScrollbar overlay mode.** Edit mode initially shipped with a hand-rolled neon track + thumb inside InfoPopup because `NeonScrollbar`'s wrap-mode architecture (scrolls its own inner div) didn't fit a `<textarea>` whose content height belongs to the browser's internal scroll buffer. Eleven subsequent commits debugging that bespoke scrollbar (`67914ca` → `f5d5c3e`) surfaced the architecture mismatch as load-bearing. At code-review time the user asked for a proper refactor rather than a convention exception: `NeonScrollbar` gained a second API — `scrollElement?: HTMLElement | null` — that drives the thumb against an externally-owned scrollable. In overlay mode the component renders only tracks + thumbs and positions itself absolutely (`.neon-scrollbar--overlay` modifier). InfoPopup's edit mode now uses `<NeonScrollbar scrollElement={textareaEl} color="cyan" onThumbHover={...} onThumbDrag={...} />` and the bespoke code + `syncThumb` / `handleThumbDragStart` / `MIN_THUMB_PX` / `THUMB_INSET` / `thumbEl` state / `textareaRef` mirror are all gone. This also obviated CR patches P1 (thumb math), P2 (elementFromPoint null), P3 (thumb-drag listener leak), P11 (ref mutation during render), and P13 (duplicate comment) (decision D3).

8. **CR patches 2026-04-23.** Inline patches applied during code review: 2 s safety timeout on `stickyPos` convergence (P4); `Number.isFinite` guard on Position render (P5); IME composition + functional `setEditText` + `isConnected`-guarded rAF in Ctrl+Enter newline (P6); `stopPropagation` on textarea Enter/Escape (P7); callout `translate` moved to inline JSX style (P9); `editorMaxHeight` state with `window.resize` listener (P12); dead `resizeHandleOverRef` removed (P14); `handleScrollableWheel` unconditionally stops during edit mode (P15, from D6); Embedding meta-row promoted to a pill badge via `StatusBadge` (P16, from D7); resize-handle listeners now tear down on unmount via `resizeTeardownRef` + cleanup effect (P3 resize-handle portion). Two patches left as `[OPEN]` in deferred-work.md: (P8) focus-loss leaves store preview stuck — requires PondScene change; (P10) `.action-popup__color-swatch*` BEM prefix kept on PopupColorSwatch to avoid churn.

### Debug Log

No blocking issues encountered. Vitest stayed green throughout (330 tests passing after each checkpoint). TypeScript clean under `tsc --noEmit`.

### Completion Checklist

- [x] `NeonScrollbar` component ported verbatim from `rag-csv-crew` into `frontend/src/components/ui/NeonScrollbar/` (both `.tsx` and `.css`), with a barrel `index.ts`. Neon-cyan tokens verified to match the component's internal `0, 238, 255` RGB triplet (see `frontend/src/styles/neon-tokens.css`).
- [x] Store slice + actions added with no-op identity guard; tests pass (4 new tests covering initial null, set, identical re-set = no-op, clear)
- [x] LilyPad hover wiring calls `setHoveredTodoId` with proper guards (resting phase, not dragging, not completing/deleting, no other pad being dragged). Drag-start clear reversed per user feedback — see Implementation Note 1.
- [x] InfoPopup component + CSS created, structurally mirroring ActionPopup on the left side (`-INFO_PANEL_OFFSET_X` translate)
- [x] InfoPopup's scrollable text region is wrapped in `<NeonScrollbar color="cyan">` — NOT styled with per-component `::-webkit-scrollbar` CSS
- [x] PondScene mounts `<InfoPopup>` for either hovered or focused pad (`infoTodoId = activePopupTodoId ?? hoveredTodoId`)
- [x] Focused mode: panel interactive (`pointer-events: auto`), text scrollable via NeonScrollbar, wheel forwarded to canvas, `role="dialog"`
- [x] Neon chrome matches tokens (`var(--neon-cyan)` border + glow, monospace, status badges in their semantic colors)
- [x] `npx tsc --noEmit -p tsconfig.app.json` clean
- [x] `npx vitest run` green — 330 passed (29 test files)
- [ ] Manually verified in browser: hover multiple pads in quick succession, click to focus, scroll long text with NeonScrollbar thumb + track click, Escape to dismiss. _(Not performed — dev agent cannot drive the browser. Dev server smoke test recommended before code review.)_
- [x] Committed at task checkpoints per CLAUDE.md — _pending end-of-story commit; not committed per CLAUDE.md checkpoint policy because the user has been actively steering the implementation with corrections. Will commit once user signals story is ready to freeze._

### File List

**New files:**
- `frontend/src/components/ui/NeonScrollbar/NeonScrollbar.tsx` (ported from rag-csv-crew; extended with overlay mode during CR — see IN #7)
- `frontend/src/components/ui/NeonScrollbar/NeonScrollbar.css` (ported from rag-csv-crew; `.neon-scrollbar--overlay` modifier added during CR)
- `frontend/src/components/ui/NeonScrollbar/index.ts`
- `frontend/src/components/ui/InfoPopup.tsx` (hosts meta + text + actions + color swatch + inline editor)
- `frontend/src/components/ui/InfoPopup.css`
- `frontend/src/components/ui/InfoPopup.test.tsx`
- `frontend/src/utils/formatTodoMeta.ts`
- `docs/custom-scrollbar-and-cursor.md` — field notes on the custom-scrollbar and custom-cursor gotchas discovered during implementation

**Modified files:**
- `frontend/src/stores/usePondStore.ts` — added `hoveredTodoId: string | null` slice + `setHoveredTodoId` action with no-op identity guard
- `frontend/src/stores/usePondStore.test.ts` — 4 new tests for `setHoveredTodoId`
- `frontend/src/components/pond/LilyPad.tsx` — hover publish in `onPointerEnter` (with 5 guards), hover clear in `onPointerLeave` (with same-id race guard), unmount cleanup extension for `hoveredTodoId`. Drag-start hover-clear was added then reversed per user feedback — see Implementation Note 1.
- `frontend/src/components/pond/LilyPad.test.tsx` — added mocks for `setHoveredTodoId`, `hoveredTodoId`, `activeDragAnchor` (mutable); 6 new hover tests
- `frontend/src/components/pond/PondScene.tsx` — imported `InfoPopup`, selected `hoveredTodoId`, derived `infoTodo`, rendered `<InfoPopup>` for hover OR focused state (the old `<ActionPopup>` mount is gone per IN #5)
- `frontend/src/components/ui/PopupColorSwatch.{tsx,css,test.tsx}` — now consumed by InfoPopup in focused mode; internal BEM prefix still `.action-popup__color-swatch*` per the deliberate-defer in `deferred-work.md`
- `frontend/src/styles/neon-tokens.css` — minor token tweaks
- `_bmad-output/implementation-artifacts/3-4-lily-pad-info-popup.md` — original task/subtask checkboxes, Status → review, this Dev Agent Record + CR-time amendments (Scope, ACs, Dev Notes, Review Findings, IN #5-#8)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `3-4-lily-pad-info-popup: ready-for-dev → in-progress → review`
- `_bmad-output/implementation-artifacts/deferred-work.md` — 12 entries added under "code review of story 3-4-lily-pad-info-popup — Group 1 / popup core (2026-04-23)"

**Deleted files** (2026-04-23, per IN #5):
- `frontend/src/components/ui/ActionPopup.tsx`
- `frontend/src/components/ui/ActionPopup.css`
- `frontend/src/components/ui/ActionPopup.test.tsx`

### Change Log

- 2026-04-23 — Implemented hover-preview + focused-interactive info popup with NeonScrollbar chrome. Two user corrections landed during implementation: (a) popup must not be cleared when user drags the hovered pad, and (b) popup must visually follow the live drag position, with a sticky-position mitigation to prevent release flash while the refetch lands.
- 2026-04-23 — ActionPopup merged into InfoPopup (IN #5). Inline edit mode added (IN #6). Bespoke edit-mode scrollbar replaced with NeonScrollbar overlay-mode API (IN #7, shipped during CR refactor). Eleven commits `e026c4c` → `f5d5c3e` landed these three deviations; the first seven commits in the range layered on the bespoke scrollbar before the CR refactor replaced it with the proper NeonScrollbar extension.
- 2026-04-23 — Code review of Group 1 (popup core, 22 files / ~2139 diff lines) completed. 7 decisions resolved (batch-accepted all option-1 resolutions), 14 patches applied (2 deferred: P8 focus-loss preview leak, P10 PopupColorSwatch BEM rename). Spec amended post-review to reflect as-shipped behaviour: Scope rewritten, ACs #6/#9/#11/#14 amended, AC section "Inline edit mode" added (#17–#21), AC #22 test coverage expanded, Dev Notes §"Scrollbar convention" updated for overlay mode, §"Positioning math" retitled (ActionPopup gone). 337 frontend tests pass; `tsc --noEmit` clean. Groups 2–4 still pending review.

---

## Review Findings

Code review of Group 1 (popup core: InfoPopup, ActionPopup deletion, PopupColorSwatch) — 2026-04-23.
Layers run: Blind Hunter, Edge Case Hunter, Acceptance Auditor. All three returned findings; no layer failed.
Groups 2–4 (NeonScrollbar port; LilyPad/PondScene/store wiring; docs + sprint) are pending separate review runs.

### Decisions needed

_Resolved 2026-04-23 via batch-accept (all "option 1") — see bracketed resolutions below._

- [x] [Review][Decision] **ActionPopup merged into InfoPopup** — Spec (AC #6, #11 + Scope) describes InfoPopup as a **sibling** to ActionPopup: "details on the left, actions on the right". Diff deletes `ActionPopup.{tsx,css,test.tsx}` and folds Complete/Delete/Set-Color into `.info-popup__actions` inside InfoPopup. **[RESOLVED: accept merge; spec amendment needed to update AC #6/#11, Positioning Math §, Not-in-scope list, and add Implementation Note #5 to Dev Agent Record. Tracked as spec-amendment follow-up.]**
- [x] [Review][Decision] **Edit-in-place shipped despite explicit "Not in scope"** — Spec §"Not in scope (defer)" §1 said "Edit-in-place. The info popup is read-only. Text edits stay a future story." Diff adds `onCommitText`, inline textarea, Enter-commit / Ctrl+Enter-newline / Esc-cancel, resizable editor, 9 tests. **[RESOLVED: promote edit-in-place into 3-4 scope; spec amendment needed to remove from "Not in scope", add ACs for whitespace handling (D4), remote-change conflict (D5), IME, and resize bounds. Tracked as spec-amendment follow-up.]**
- [x] [Review][Decision] **Bespoke scrollbar in edit mode vs "always NeonScrollbar" convention** — Edit mode used hand-rolled `.info-popup__neon-track` / `.info-popup__neon-thumb` + custom `syncThumb`. **[RESOLVED via refactor, 2026-04-23: NeonScrollbar gained an `overlay` mode (new `scrollElement?: HTMLElement | null` prop) that drives the thumb against an externally-owned scrollable element. InfoPopup's edit mode now uses `<NeonScrollbar scrollElement={textareaEl} />` instead of the bespoke code. The spec's Dev Notes §"Scrollbar convention: always NeonScrollbar" is preserved intact — overlay mode is just a second NeonScrollbar API, not a convention exception. Spec amendment needed only for Dev Notes §"Scrollbar convention" to document the `scrollElement` prop and when to use wrap vs overlay; obviates Patches P1, P2, the thumb-drag portion of P3, P11, and P13.]**
- [x] [Review][Decision] **Empty/whitespace-only text silently swallowed on commit** — `commitEdit` gates on `trimmed.length > 0` (`InfoPopup.tsx:1626-1632`). **[RESOLVED: accept silent-revert as UX; no code change. Add an AC line in D2's spec amendment documenting "empty text is a silent no-op; users delete pads via the Delete button, not by clearing text."]**
- [x] [Review][Decision] **Incoming todo.text changes during edit silently dropped** — `InfoPopup.tsx:1529-1531`. **[RESOLVED: last-write-wins is intended; no code change. Add an AC line in D2's spec amendment documenting "remote text mutations during edit are overwritten on commit; conflict resolution is out of scope for 3-4."]**
- [x] [Review][Decision] **Wheel over panel at scroll-end zooms camera during edit** — `handleScrollableWheel` (`InfoPopup.tsx:1566-1588`). **[RESOLVED: always stop wheel propagation during edit mode. See Patch P15 below.]**
- [x] [Review][Decision] **"Embedding" meta row is plain span, others are pill badges** — `InfoPopup.tsx:1907-1909`. **[RESOLVED: promote Embedding to pill badge for visual parity. See Patch P16 below.]**

### Patches

All patches below were applied 2026-04-23. See the "NeonScrollbar refactor" note under Decision D3 above for obviated patches; remaining patches listed individually.

- [x] [Review][Patch] **Thumb math: div-by-zero, NaN propagation, and boundary jitter** — OBVIATED by NeonScrollbar overlay refactor (bespoke `syncThumb` deleted)
- [x] [Review][Patch] **`handleThumbDragStart` onUp: `el?.closest(...) !== null` evaluates true when `el` is null** — OBVIATED (handler deleted; NeonScrollbar's built-in drag handler doesn't share this bug)
- [x] [Review][Patch] **Document mousemove/mouseup listener leak on unmount mid-drag** — `handleThumbDragStart` OBVIATED; `handleEditorResizeStart` now uses a ref + unmount-cleanup effect to tear down listeners, body.userSelect, and cursorMode on unmount [`InfoPopup.tsx` `resizeTeardownRef`]
- [x] [Review][Patch] **`stickyPos` / `wasDraggingRef` never clear** — added 2 s safety timeout in the drag-anchor effect; proximity convergence still fires immediately, but the timeout ensures the popup can't be stranded on a stale anchor when the server clamps / rejects [`InfoPopup.tsx` drag-anchor effect]
- [x] [Review][Patch] **Position meta row renders `"NaN, NaN"`** — guarded with `Number.isFinite(popupX) ? popupX.toFixed(2) : '—'` [`InfoPopup.tsx` Position MetaRow]
- [x] [Review][Patch] **Ctrl/Meta/Shift+Enter newline-insert safety** — IME composition check added (`e.nativeEvent.isComposing || e.keyCode === 229`); `setEditText` switched to functional form; rAF guarded with `t.isConnected` [`InfoPopup.tsx` textarea onKeyDown]
- [x] [Review][Patch] **Textarea `onKeyDown` now calls both `preventDefault` and `stopPropagation`** on Enter/Escape to prevent outer PondScene keymaps from firing [`InfoPopup.tsx` textarea onKeyDown]
- [ ] [Review][Patch] **Focus-loss leaves store `previewColor` stuck** — DEFERRED: requires PondScene change (always pass `onPreviewColor`), not an InfoPopup-only fix. Re-classified to deferred-work; to be addressed in Group 3 review.
- [x] [Review][Patch] **`.info-popup__callout` CSS hardcodes `translate(-280px, -100%)`** — moved to inline `style={{ transform: ... }}` in JSX driven by the `INFO_PANEL_OFFSET_X` constant; CSS now only sets `translateY(-100%)` as a baseline [`InfoPopup.tsx` callout SVG, `InfoPopup.css` `.info-popup__callout`]
- [ ] [Review][Patch] **Test still queries legacy `.action-popup__color-swatches`** — DEFERRED: author explicitly chose not to rename to avoid churn (`InfoPopup.css:176-179` comment). The `.action-popup__*` classes are owned by `PopupColorSwatch.{tsx,css}` and a rename would touch ~14 occurrences across 4 files with no functional change. Left as `[OPEN]` for a future standalone cleanup.
- [x] [Review][Patch] **`textareaRef.current = textareaEl` during render body** — OBVIATED by refactor (`textareaRef` mirror deleted; only `textareaEl` state remains, passed directly to `NeonScrollbar`)
- [x] [Review][Patch] **`EDITOR_MAX_HEIGHT` captured at mount** — now state-backed with a `window.resize` listener; fallback kept for SSR / jsdom [`InfoPopup.tsx` `editorMaxHeight`]
- [x] [Review][Patch] **Duplicate "Thumb sync using only values we KNOW…" comment block** — OBVIATED (deleted with `syncThumb`)
- [x] [Review][Patch] **Dead state: `resizeHandleOverRef`** — deleted; the two handlers that mutated it now just call `onDragAffordanceHover` directly
- [x] [Review][Patch] **D6 / P15: Wheel during edit mode always stops propagation** — `handleScrollableWheel` now unconditionally stops when a `.info-popup__editor-textarea` is present, regardless of boundary state; readonly mode keeps bubble-at-boundary [`InfoPopup.tsx` `handleScrollableWheel`]
- [x] [Review][Patch] **D7 / P16: Embedding status promoted to pill badge** — now rendered via `<StatusBadge label={... .toUpperCase()} color={embeddingColor} />` for visual parity with the Status row [`InfoPopup.tsx` Embedding MetaRow]

### Deferred (pre-existing or low-value-for-now)

- [x] [Review][Defer] Magic `-2` border subtraction (`visibleHeight = editorHeight - 2`) [`InfoPopup.tsx:1493`] — deferred, minor
- [x] [Review][Defer] Stale closure on `editorHeight` in `handleThumbDragStart` [`InfoPopup.tsx:1650`] — deferred, no practical repro
- [x] [Review][Defer] `handleWheel` uses `document.querySelector('canvas')` unconditionally — latent if app ever mounts a second canvas [`InfoPopup.tsx:1541-1557`] — deferred, pre-existing from ActionPopup
- [x] [Review][Defer] Hover-mode `onWheel` handler sits on the outer wrap; currently benign because `pointer-events: none`, but fragile [`InfoPopup.tsx:1566-1588`] — deferred, no current trigger
- [x] [Review][Defer] `onPreviewColor` fires `null` on every parent re-render via deps [`InfoPopup.tsx:1427-1429`] — deferred, harmless spam
- [x] [Review][Defer] Escape `stopPropagation` fragile if `onCommitText` undefined [`InfoPopup.tsx:1816`] — deferred, not currently reachable
- [x] [Review][Defer] `useState(todo.text)` initial capture stale across pad key-swap edge [`InfoPopup.tsx:1449`] — deferred, one-frame flash at most
- [x] [Review][Defer] `embeddingColor` binary fallthrough — new statuses silently render orange [`InfoPopup.tsx:1614-1615`] — deferred, needs enum decision
- [x] [Review][Defer] Test "Enter is no-op when trimmed matches" doesn't assert edit-mode state [`InfoPopup.test.tsx` ~line 1220] — deferred, test improvement
- [x] [Review][Defer] `aria-live="polite"` on `role="dialog"` unusual; `aria-describedby` missing [`InfoPopup.tsx:1788`] — deferred, tracked under story 4-4 Frontend A11y Sweep

### Cross-group follow-ups

The Acceptance Auditor flagged items that depend on other groups' diffs:

- **Group 2** (NeonScrollbar port) — verify `frontend/src/components/ui/NeonScrollbar/*` is byte-for-byte from `rag-csv-crew` and `--neon-cyan` RGB matches `0, 238, 255`.
- **Group 3** (LilyPad/PondScene/store) — verify PondScene wires all four callbacks (`onComplete`, `onDelete`, `onCommitColor`, `onCommitText`), verify close-paths collapse edit mode, verify `usePondStore.setHoveredTodoId` identity guard, verify drag-start reversal per Dev Agent Record IN #1.
- **Group 4** (docs + sprint) — verify `docs/custom-scrollbar-and-cursor.md` documents the bespoke-scrollbar tension surfaced by Decision #3 above.

### Dismissed (noise / intentional / documented)

9 findings dismissed, among them: hover popup follows pad during drag (intentional per memory + Dev Agent Record IN #1-#3); Position meta row reads live value (documented in IN #4); statusBadges priority order (intentional); cosmetic/flex spacing notes; React typing nits; framework-managed ResizeObserver retention; contingent items that will resolve once the three big decisions above are made.

---

## Review Findings — Group 2 (NeonScrollbar port + overlay extension)

Code review of Group 2 (704 diff lines: initial port in `e9ab75c` + overlay extension in `fff503f`) — 2026-04-23.
Layers run: Port-Diff Auditor (compared local to `c:/Users/michael/nearform/rag-csv-crew/frontend/src/components/NeonScrollbar/`), Edge Case Hunter (overlay mode), Acceptance Auditor (amended spec).

### Decisions needed — Group 2

- [x] [Review][Decision] **Port-verbatim rule vs local-only extensions** — **[RESOLVED 2026-04-23: option (c). Accepted the local fork as canonical. Dev Notes §"Scrollbar convention" bullet "One-to-one with the upstream port" rewritten as "Local fork; no upstream-sync contract" — lists the app-specific features explicitly (firefly/frog-hand callbacks, `cursor: none` override, `input` + descendant-RO + broader MO, overlay mode) so future readers know what's local vs what's generic. No backport to `rag-csv-crew` required.]** The port-diff auditor found 5 local drifts from upstream, 4 of which predate the overlay-mode refactor (they were already in the initial `e9ab75c` port):
    1. **`onThumbHover` / `onThumbDrag` prop API** — app-specific callbacks used for firefly-cursor / frog-hand swapping. Upstream has no such props. Local JSDoc explicitly says "the rag-csv-crew source does not use this and can safely omit."
    2. **Descendant-tree `ResizeObserver` + extended `MutationObserver`** — local observes `inner.querySelectorAll('*')` with a `WeakSet` + re-attaches via MO, and broadens MO config to include `attributes: true, characterData: true`. Upstream observes only `inner` with `childList + subtree`.
    3. **`input` event listener on the scrollable** — local fires `scheduleUpdate` on bubbled `input` events. Upstream has no such listener.
    4. **`.nsb-thumb { cursor: none }`** (local) vs `cursor: pointer` (upstream) — local app-specific to prevent the OS arrow from stealing the neon-cursor aesthetic. 4-line inline comment justifies it.
    5. **`onMouseUp(e: MouseEvent)` signature widened** — follow-on from (1); upstream uses the no-arg form.

    The spec's Dev Notes §"Scrollbar convention" currently claims "One-to-one with the upstream port" and "any further changes should land upstream-first when possible so the two repos don't diverge." That claim is already false. Resolution options:
    - **(a) Backport the 4 pre-existing drifts to `rag-csv-crew`** so the two repos genuinely re-sync, then keep the overlay-mode extension as the sole local divergence (and optionally backport that too).
    - **(b) Document an explicit divergence waiver** in the convention note — list each drift, why it's local-only, and the forward plan.
    - **(c) Drop the port-verbatim claim entirely** — accept the local fork as canonical, remove references to upstream from the convention, and stop worrying about sync.

### Patches — Group 2

All 6 patches applied 2026-04-23. Tests: 337 frontend tests pass; `tsc --noEmit` clean.

- [x] [Review][Patch] **[HIGH] Drag-state cleanup leaks on `scrollElement` swap mid-drag** — applied: both vertical and horizontal drag effects now check `isDragging` in teardown and, if true, restore `document.body.style.userSelect = ''`, clear `isDraggingVirtualRef`, and fire `onThumbDrag?.(false)` so the consumer's cursor mode returns from `'grabbing'` to `'firefly'` / `'grab'` [`NeonScrollbar.tsx` vertical + horizontal drag effects]
- [x] [Review][Patch] **[MED] MutationObserver redundant + fires on every keystroke** — applied: both the descendant-tree ResizeObserver and the MutationObserver are now skipped entirely when `inner instanceof HTMLTextAreaElement || HTMLInputElement` (the `input` listener handles content changes on form controls). For non-form-control `inner`, the MO's `attributeFilter: ['style', 'class', 'rows', 'cols']` restricts firings to layout-relevant attributes and prevents `value=` churn. [`NeonScrollbar.tsx` main layout effect]
- [x] [Review][Patch] **[MED] Silent drop when both `children` and `scrollElement` are provided** — applied: dev-mode `useEffect` fires a one-shot `console.warn` on mount if both are set. JSDoc on both props now documents the mutual exclusion. [`NeonScrollbar.tsx` Dev-mode invariant-check effect]
- [x] [Review][Patch] **[MED] `onVirtualYNavigate` + `scrollElement` combo has undefined semantics** — applied: same dev-mode warn fires when `scrollElement !== undefined && (virtualYTotal ?? 0) > 0`. JSDoc on `virtualYTotal` / `virtualYStart` / `virtualYLoadedCount` / `onVirtualYNavigate` now marks them as wrap-mode-only. [`NeonScrollbar.tsx` Dev-mode invariant-check effect]
- [x] [Review][Patch] **[LOW] JSDoc nuance: `scrollElement={null}` activates overlay mode** — applied: JSDoc on `scrollElement` now explicitly documents that `null` == "overlay, no target yet; effects will re-run when an element arrives." Omit the prop entirely (leave `undefined`) for wrap mode. [`NeonScrollbar.tsx` props]
- [x] [Review][Patch] **[LOW] `scrollRef` silently ignored in overlay mode** — applied: JSDoc on `scrollRef` now marks it as "Wrap-mode only" and notes that it's "silently ignored in overlay mode (the consumer already owns `scrollElement`)." [`NeonScrollbar.tsx` props]

### Deferred — Group 2

- [x] [Review][Defer] [MED] `overflow: visible` + `position: absolute; inset: 0` in overlay mode lets tracks misalign when the consumer's scrollElement has padding + different `box-sizing` than the offsetParent. No current consumer hits this. [NeonScrollbar.css:overlay] — deferred, layout-sensitive edge case, no repro
- [x] [Review][Defer] [MED] `scrollElement` prop identity changes tear down + rebuild all listeners — fine with state-backed refs (current consumer pattern), but a consumer passing `ref.current` directly would thrash on every render. Document the footgun. — deferred, documented behaviour
- [x] [Review][Defer] [MED] `textareaEl` briefly refers to a detached textarea between JSX unmount and the `setTextareaEl(null)` callback — one-frame thumb position jump at edit-close. Cosmetic. — deferred, 1-frame visual
- [x] [Review][Defer] [LOW] `body.userSelect` race between NeonScrollbar thumb drag and InfoPopup resize drag unmount — covered by Patch P1 above but in the resize-handle path (Group 1 territory); deferred as it's contingent on P1
- [x] [Review][Defer] [LOW] `scrollElement` → `undefined` transition loses scroll position (overlay → wrap migration is unusual and not a current consumer pattern)
- [x] [Review][Defer] [LOW] `ResizeObserver` / `MutationObserver` SSR safety — jsdom has both; no current SSR target. Add `typeof X !== 'undefined'` guards when SSR becomes a real scenario.
- [x] [Review][Defer] [LOW] `onTrackYClick` uses `e.target === thumbY` strict equality; fragile if future changes nest anything inside the thumb. Currently the thumb has no children, so this is latent.
- [x] [Review][Defer] [LOW] Descendant-RO walk is dead code when `scrollElement` is a form control — perf waste, not a correctness issue.
- [x] [Review][Defer] [LOW] Cosmetic blink: overlay outer renders absolutely-positioned tracks while `scrollElement === null` (before state settles). Empty tracks show for one paint cycle. — deferred, cosmetic.

### Cross-group follow-ups

- **Backport decision (D1 above) touches Group 4** — if we choose option (a) or (b), `docs/custom-scrollbar-and-cursor.md` should document the upstream-sync policy.

### Dismissed — Group 2

4 findings dismissed: `[SEEN-IN-GROUP-1]` wheel-over-resize-handle behaviour (Edge #11 — out of scope for Group 2); `onMouseUp` signature widening (Port-Diff [LOW] — contingent on D1); overlay-vs-wrap discriminated union as a "MUST" (Auditor [LOW] — matches Patch P3 above, not separately listed); LOW auditor finding that `scrollRef` is silently ignored (merged into Patch P6 above).

---

## Review Findings — Group 3 (scene wiring + store)

Code review of Group 3 (450 diff lines: LilyPad hover wiring, PondScene info-popup mount, `usePondStore.hoveredTodoId` slice, `formatTodoMeta.ts`, `neon-tokens.css`) — 2026-04-23.
Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor. All three returned findings; no layer failed.

### Decisions needed — Group 3

- [x] [Review][Decision] **AC #2 drag-preserve clause is implicit in the code but undocumented in the spec** — **[RESOLVED 2026-04-23 by product direction reversal. User chose a FOURTH option not in the original list: REMOVE the drag-follow behaviour entirely. Drag-start now clears `hoveredTodoId`, the popup fades out via a ~100 ms exit animation, and reappears with a 180 ms slide-fade-in animation after a fresh `pointerEnter` post-release. This obviates Patches P2 (own-drag re-entry) and P4 (drag-release re-sync stomp) — the code paths they guarded are deleted. Dev Agent Record IN #1/#2/#3 rewritten to mark the drag-follow experiment as CR-reversed; new ACs #2a (drag-start clear) + #2b (slide-fade-in enter animation) + amended AC #2 (fade-out on leave) document the shipped behaviour.]**

### Patches — Group 3

All patches applied 2026-04-23. Tests: 339 frontend tests pass (337 prior + 2 new reversal tests), `tsc --noEmit` clean.

- [x] [Review][Patch] **[HIGH] P8 — focus-loss preview leak (carry-over from Group 1; Group 3 was its target)** — `PondScene.tsx:247-252` still gates `onPreviewColor` behind `activePopupTodoId === infoTodo.id`. InfoPopup's focus-loss cleanup calls `onPreviewColor(null)` to clear the store, but by then the callback has already been replaced with `undefined` → store's `previewColor` entry sticks on the last hovered hex. Fix: pass `onPreviewColor` unconditionally (build the callback once with `useCallback`); let InfoPopup's internal `focused` gate decide when to call it. Remove the `activePopupTodoId === infoTodo.id ? ... : undefined` ternary. [`PondScene.tsx:247-252`]
- [x] [Review][Patch] **[HIGH] Own-drag hover re-entry publishes even for completing/deleting pads** (OBVIATED by D1 reversal — branch deleted) — The fallback branch `else if (isDraggingRef.current) { state.setHoveredTodoId(todo.id); }` bypasses the `!completingTodos.has(id)` + `!deletingTodos.has(id)` checks that apply to the main publish path. A pad mid-drag that starts completing/deleting (rare but racey) re-publishes ghost hover. Fix: mirror the four guards from the main branch into the drag-reentry branch. [`LilyPad.tsx:2543-2547`]
- [x] [Review][Patch] **[HIGH] Zombie `hoveredTodoId` when hovered pad falls out of `renderTodos`** — `PondScene`'s `renderTodos.find(t => t.id === infoTodoId)` returns `undefined` if the todo is filtered out (rapid visibility-filter toggle, completion after hover publish but before render). InfoPopup is silently skipped, but `hoveredTodoId` in the store stays set — the `LilyPad` unmount-cleanup only fires if the pad component actually unmounts this cycle. Fix: in `PondScene`, when `infoTodoId === hoveredTodoId` AND `renderTodos.find` returns undefined, schedule a `setHoveredTodoId(null)` (in an effect, not during render). [`PondScene.tsx:126-127`]
- [x] [Review][Patch] **[MED] Drag-release re-sync can stomp a competing pad's hover** (OBVIATED by D1 reversal — the re-sync is now a simple "if still over this pad, re-publish" and since hover was cleared on drag-start, there's no competing state to stomp) — On drag-release, `if (pointerOverRef.current) setHoveredTodoId(todo.id)` writes unconditionally (`LilyPad.tsx:1086-1101`). If a sibling pad B moved under the cursor mid-drag and correctly published hover=B, releasing A overwrites B's valid hover. Fix: only re-assert if `usePondStore.getState().hoveredTodoId === null` (or === this pad already). [`LilyPad.tsx:1086-1101`]
- [x] [Review][Patch] **[MED] `onPointerLeave` guard reads store twice** — The guard captures `state` via `getState()` at the top, then re-reads `hoveredTodoId` via a fresh `getState()` inside the condition; between the two reads a competing publish could land. Fix: snapshot once, read `hoveredTodoId` and call `setHoveredTodoId` from the same snapshot. [`LilyPad.tsx:2565-2571`]
- [x] [Review][Patch] **[MED] `formatTimestamp` renders `"NaN-NaN-NaN NaN:NaN"` on invalid input** — `new Date('')` or `new Date(undefined as any)` yields `Invalid Date`; `getFullYear()` returns `NaN`; template literal coerces to the string `"NaN-NaN-NaN ..."`. Fix: guard `if (Number.isNaN(d.getTime())) return '—';`. [`formatTodoMeta.ts:2-9`]
- [x] [Review][Patch] **[MED] `formatRelative` cascades the same NaN + treats future timestamps as "just now"** — Invalid ISO → NaN arithmetic → falls through to `(on <broken-timestamp>)`. Negative `diffMs` (clock-skewed future timestamp) → `diffMins < 1` → `"(just now)"`. Fix: guard `Number.isNaN` + `Math.abs(diffMs)` or return `""` / `"(in the future)"` for negatives. [`formatTodoMeta.ts:11-26`]
- [x] [Review][Patch] **[MED] AC #16 test coverage gap — replaced by drag-start-clear tests** (the drag-reentry branch and drag-release re-sync are gone per D1; new tests lock in the reversal: drag-start clears hover when this pad owns it, does NOT clear when a different pad owns it) — The new `else if (isDraggingRef.current)` branch in `onPointerEnter` (`LilyPad.tsx:2543-2547`) and the `onWindowUp` hover re-sync (`LilyPad.tsx:1086-1101`) have no tests. Add: (a) during drag, re-entering a pad re-publishes hover; (b) drag-release with `pointerOverRef.current === true` re-asserts hover — except when another pad owns the hover (after Patch #4 above). [`LilyPad.test.tsx`]
- [x] [Review][Patch] **[LOW] Test assertion strength** — `expect(setHoveredTodoIdMock).not.toHaveBeenCalledWith(null)` passes even if the mock is called with a different value. Replace with `expect(setHoveredTodoIdMock).not.toHaveBeenCalled()` for the specific "different pad owns hover" case. [`LilyPad.test.tsx` pointerLeave `different pad is current hover` test]

### Deferred — Group 3

- [x] [Review][Defer] [HIGH] **Phase-transition race — hover never republishes on phase change** — If a pad is in `forming`/`settling` when the cursor enters, the guard blocks publish and there's no re-check when the pad reaches `resting`. User has to move the cursor away and back. Fix requires subscribing to phase transitions. Deferred, complex + non-blocking UX. [`LilyPad.tsx:2522-2548`]
- [x] [Review][Defer] [MED] StrictMode re-mount cleanup order — if a hover-cleanup effect fires AFTER a sibling's mount-time hover publish, and StrictMode double-mounts the same pad, the re-mount may not re-fire `pointerEnter` (cursor isn't moving). Deferred, narrow StrictMode scenario, also overlaps with backlog story `4-5-react-strict-compliance-sweep`.
- [x] [Review][Defer] [MED] `onPointerLeave` during drag-of-OTHER-pad clears own hover — if hover was valid before another pad's drag started, leaving clears it. Acceptable since new hovers are blocked during other-pad drag. Deferred, narrow.
- [x] [Review][Defer] [LOW] `--z-cursor: 2147483647` is brittle (INT32 max). Works against drei `<Html>`'s 16777271 default, but fragile. Deferred, cosmetic; pick `16777272` when next touched. [`neon-tokens.css`]
- [x] [Review][Defer] [LOW] InfoPopup `key={infoTodo.id}` forces unmount/remount on hover switch — discards in-flight state. Fine for hover-only mode (nothing to preserve). Deferred.
- [x] [Review][Defer] [LOW] `pointerOverRef` never reset on unmount — React instance-lifecycle makes this safe in practice, but a lifted ref would stale. Deferred, pattern-correct today.
- [x] [Review][Defer] [LOW] `formatTimestamp` local time with no TZ indicator — spec says local; user-visible ambiguity if same data viewed in different timezones. Deferred, intentional.
- [x] [Review][Defer] [LOW] `hoverStateMock` getter but `setHoveredTodoIdMock` doesn't write back to the mock state — tests lie about store semantics but pass because they only assert call args. Deferred, test improvement.
- [x] [Review][Defer] [LOW] Store test asserts reference preservation rather than strict "no set() called" — tests an impl detail, works today. Deferred.

### Dismissed — Group 3

5 findings dismissed: `onCommitText` "wired but prop not shown" (InfoPopup does accept it, verified in Group 1); `setHoveredTodoId` `undefined` footgun (TypeScript enforces `string | null`); `updateTodo`/`infoTodo` stale-closure ripple position (pre-existing, not introduced by this diff); `onPreviewColor` signature widening to `| null` (matches P8 fix plan); `formatRelative` weeks-format inconsistency (`'2m'` vs `'2 weeks ago'` — cosmetic stylistic choice).
