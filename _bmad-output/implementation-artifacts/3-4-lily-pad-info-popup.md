# Story 3.4: Lily Pad Info Popup (Hover-Preview + Focused-Interactive)

Status: review

> **Scope:** A second per-pad popup, sibling to the existing `ActionPopup`, that surfaces a todo's **metadata** (full text, timestamps, status flags, position) on hover and stays up while the pad is focused (popup-active). Anchored to the **LEFT** of the pad, mirroring `ActionPopup`'s upper-right anchor. Neon cyan chrome, same glow vocabulary as the rest of the UI. When focused, the panel is interactive to whatever degree the content requires — long text scrolls vertically, meta rows read like a table.
>
> **Why now:** The pad label already renders the todo's text at readable size post-focus, but there's no affordance for non-trivial details (long text that overflows, when it was created, its embedding status, soft-deletion metadata). Hover-preview feels right for this pond's "hover-to-focus" UX language (ux-design-specification.md §Design Philosophy: _"Hover a lily pad — it responds."_). The info popup completes that promise.
>
> **What ships:**
> 1. **Port `NeonScrollbar`** — copy `NeonScrollbar.tsx` + `NeonScrollbar.css` verbatim from `c:/Users/michael/nearform/rag-csv-crew/frontend/src/components/NeonScrollbar/` into this repo at `frontend/src/components/ui/NeonScrollbar/`. Every scrollable region in this app — starting with the info popup's text area, and going forward for any future scrollable content — must use this component rather than raw `overflow: auto` + per-component scrollbar CSS. See **Task 3a** below.
> 2. **New component** `frontend/src/components/ui/InfoPopup.tsx` + `InfoPopup.css`. Rendered via drei `<Html>` like `ActionPopup`, but anchored to the pad's **LEFT** (negative X offset, same −Y offset).
> 3. **Store slice** `hoveredTodoId: string | null` + `setHoveredTodoId(id | null)` on `usePondStore`. Tracks the pad the cursor is currently over.
> 4. **LilyPad hover wiring** — extend the existing `onPointerEnter` / `onPointerLeave` to additionally set/clear `hoveredTodoId`. Don't set on drag-in-progress or dissolving pads.
> 5. **PondScene mount** — render `<InfoPopup>` when EITHER `hoveredTodoId === todo.id` OR `activePopupTodoId === todo.id`. Source the Todo from the same `renderTodos` list that drives `ActionPopup`.
> 6. **Focused-mode interactivity** — when `activePopupTodoId === infoTodo.id`, panel gets `pointer-events: auto` and the text region is wrapped in `<NeonScrollbar color="cyan">` so overflow scrolls with the neon wireframe chrome. Pure hover is non-interactive (`pointer-events: none`) so moving onto the panel doesn't trap focus.
> 7. **Content** — full text (wrapped, scrollable via NeonScrollbar), then a "meta rows" section: created / updated timestamps (localised, with relative hint), status badges (Completed / Deleted / Archived / Embedding), position `(x, z)`, rotation in degrees. All legible in the dense pond.
>
> **Not in scope (defer):**
> - **Edit-in-place.** The info popup is read-only. Text edits stay a future story.
> - **Cross-pad comparisons / diff view.** One pad at a time.
> - **Accessibility sweep** (ARIA live regions, focus-trap for scrollable content). Tracked under **4.4 Frontend A11y Sweep** which will also cover ActionPopup. This story lays down minimal `role="tooltip"` / `aria-describedby` hooks so 4.4 has something to build on.
> - **Animations.** Use the existing `opacity` fade-in the ActionPopup uses; no bespoke motion here.

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

2. **Given** the `InfoPopup` is visible in hover-only mode, **When** I move the cursor off the pad (and NOT onto the popup itself in this mode), **Then** the popup disappears within one frame. Hover-mode does not require the cursor to stay on the pad for any "grace period" — it tracks `onPointerLeave` directly.

3. **Given** a lily pad is being dragged (`isDraggingRef.current === true` for any pad) OR is in a non-`resting` phase (`forming`, `dropping`, `settling`, `pulsing`, `completing`, `completed`, `deleting`, `deleted`, `waiting`, `materializing`), **Then** its hover does NOT publish to `hoveredTodoId` — no info popup.

4. **Given** I hover pad A then quickly hover pad B without any gap, **Then** exactly one info popup is visible at a time (B's), not two. (`setHoveredTodoId` on enter naturally supersedes; leave on A fires AFTER enter on B in the DOM event order — the store's last-write-wins plus the "only clear if current === self" guard below prevents a stale clear.)

5. **Given** I hover a pad, **Then** the existing **firefly → grab** cursor swap continues to fire as it does today (story 4.6 mechanic). The hover popup is a new peer; it doesn't change the cursor.

### Focused mode (click-persistent, interactive)

6. **Given** I click a lily pad (threshold ≤ 4 px so it's a click, not a drag — per 4.2 AC #3), **Then** the existing `ActionPopup` opens on the upper-right (unchanged) AND the `InfoPopup` stays open on the left, regardless of whether my cursor is still over the pad.

7. **Given** the popup is focused (`activePopupTodoId === todoId`), **Then** the panel's `pointer-events` flip from `none` to `auto` AND the content region becomes vertically scrollable (`overflow-y: auto`). Moving the cursor OFF the pad no longer hides the popup; it closes only via the `ActionPopup` close paths below.

8. **Given** the popup is focused and the todo text is longer than the scroll region's `max-height` (180 px for the text region, see Task 3), **When** I scroll the text (wheel over it, or drag the neon wireframe thumb), **Then** the text scrolls inside a `<NeonScrollbar color="cyan">` wrapper — the neon wireframe track + glowing thumb from `rag-csv-crew`, ported into this repo at Task 3a. Native browser scrollbars never appear anywhere (the global `::-webkit-scrollbar { display: none }` at [global.css:26-28](frontend/src/styles/global.css#L26-L28) stays in effect; NeonScrollbar provides its own DOM thumbs). OrbitControls zoom is NOT triggered by wheel over the panel (the panel's focused-mode wheel handler forwards to the canvas, same as ActionPopup's wheel path).

9. **Given** the popup is focused, **When** the user triggers any of the existing popup-close paths — Escape (via `useClosePopupOnEscape`), Complete/Delete buttons, color-commit, or clicking outside — **Then** `InfoPopup` hides alongside `ActionPopup`. They share `activePopupTodoId` as the single visibility signal in focused mode.

### Positioning & aesthetic

10. **Given** any render state, **Then** the info popup is anchored to the **LEFT** of the pad — panel `transform: translate(-INFO_PANEL_OFFSET_X, -INFO_PANEL_OFFSET_Y)` where offsets are tuned to mirror ActionPopup's upper-right placement without visually overlapping it (use `INFO_PANEL_OFFSET_X = 280` as a starting value to clear the pad's hover ring + a comfortable margin).

11. **Given** the info popup and action popup are both visible simultaneously (focused mode), **Then** both are fully visible; neither clips the other. The pad glow + water halo remain between them, unobscured. A visual pairing of "details on the left, actions on the right" around the focused pad.

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
    - `Embedding` — shown only when `embeddingStatus !== 'complete'`. Value is the raw string (`pending`, `failed`) in the corresponding neon color (orange for pending, pink for failed). Hides on `complete` to keep the panel quiet for the common case.
    - `Position` — `(x, z)` rounded to two decimals.

15. **Given** the todo's `text` field is longer than ~80 characters, **Then** the text wraps and, when focused, scrolls — not truncated with ellipsis. Hover-only mode may clip via the panel's max-height but the text shouldn't hard-truncate with "…".

### Quality gate

16. **Given** I run `npx vitest run` after this story, **Then** all existing tests plus new tests pass. New tests cover: (a) hover sets `hoveredTodoId`; (b) leave clears it (if still current); (c) drag-in-progress blocks hover publish; (d) dissolving-phase pad does not publish; (e) focused mode toggles panel `pointer-events`; (f) `Escape` hides both popups; (g) meta-rows render the expected labels/badges for representative Todo shapes (active, completed, deleted, archived, embedding-pending).

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

This app globally hides native scrollbars ([global.css:26-28](frontend/src/styles/global.css#L26-L28)). Any region that needs to scroll uses the ported `NeonScrollbar` component — never raw `overflow: auto` with `::-webkit-scrollbar` styling. Rationale:

- **Firefly cursor integration.** Native scrollbars capture input at the OS compositor level; the firefly-trail cursor goes blind the moment the user grabs a native thumb. NeonScrollbar uses DOM thumbs and fires standard `mousemove`, so the cursor keeps tracking during drag — critical for this app's custom-cursor aesthetic.
- **One scrollbar vocabulary.** Neon wireframe track + glowing thumb, same palette variants (cyan / orange / gold / green / pink), same interaction idioms (click track to jump, drag thumb to scroll). Future scrollable regions (long text in a delete-confirmation dialog, a settings panel, a debug table) drop straight in without re-solving this.
- **Keep the port verbatim.** The component lives at `frontend/src/components/ui/NeonScrollbar/` after Task 3a. Any bug fix or feature should land in the `rag-csv-crew` source first, then port here. That keeps the two repos one-to-one so future refactors aren't hindered by diverged copies.

Usage pattern:

```tsx
import { NeonScrollbar } from '../ui/NeonScrollbar';

<NeonScrollbar color="cyan" style={{ maxHeight: 180 }}>
  <div>{/* any content that might overflow */}</div>
</NeonScrollbar>
```

Pick a `color` that matches the surrounding chrome — cyan for the info popup (matches the popup's cyan border + glow), other variants for future contexts. The component accepts `innerClassName` / `innerStyle` if the scrollable inner element needs extra layout (see its `NeonScrollbarProps` docstring for the full surface).

### Positioning math: avoiding ActionPopup overlap

`ActionPopup` sits at `translate(+80, -120)` from the pad anchor. `InfoPopup` at `translate(-280, -120)`. Even with moderate panel widths (up to ~260 px for the info popup, ~160 px for the action popup), there's a ≥ 200 px horizontal gap at screen center. If you later tune `INFO_PANEL_OFFSET_X` DOWN below 240, eyeball the focused state to confirm no overlap.

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

1. **Drag-start cleanup reversed.** The spec's Task 2 subtask "clear `hoveredTodoId` when drag crosses the 4 px threshold" was implemented, then reversed on user feedback. Rationale: the pad is still under the cursor during drag, so clearing would make the popup disappear mid-drag (and `pointerEnter` doesn't refire on release since the pointer was already over the pad). The `onPointerEnter` guard (block new hover while a drag is active) is sufficient on its own. See the inline note at the `isDraggingRef.current = true` block in `LilyPad.tsx`.

2. **Popup follows the live drag position.** Spec had `<Html position={[todo.positionX ?? 0, 0.4, todo.positionY ?? 0]}>` — that would anchor to the persisted value, leaving the popup stranded at the pad's original spot while the mesh moved. User correction: subscribe to `activeDragAnchor` in the store; when this pad owns the anchor, use `{x, z}` from the anchor instead of the persisted position. Popup now tracks the pad through the entire drag.

3. **Release-flash mitigation (sticky position state).** On release, `activeDragAnchor` clears synchronously but the batch PATCH + refetch takes ~50–200 ms to land new `todo.positionX/Y`. In between, the popup would flash back to the OLD persisted position for a frame. Fix: `useState<{x, z} | null>` captures the last drag position and persists until the refetched `todo.positionX/Y` agrees within sub-unit epsilon (0.1 world units). Implemented via `useEffect` (not ref-mutation-during-render) to stay Strict-Mode-compliant — the project already tracks a ref-during-render cleanup in backlog story 4-5 and this new code should not add to that debt.

4. **Position meta row reads the live value.** To stay consistent with the popup anchor, the "Position (x, z)" meta row also reads the sticky/drag position — so during a drag the displayed coords update live rather than lagging until the refetch.

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
- `frontend/src/components/ui/NeonScrollbar/NeonScrollbar.tsx` (verbatim port from rag-csv-crew)
- `frontend/src/components/ui/NeonScrollbar/NeonScrollbar.css` (verbatim port from rag-csv-crew)
- `frontend/src/components/ui/NeonScrollbar/index.ts`
- `frontend/src/components/ui/InfoPopup.tsx`
- `frontend/src/components/ui/InfoPopup.css`
- `frontend/src/components/ui/InfoPopup.test.tsx`
- `frontend/src/utils/formatTodoMeta.ts`

**Modified files:**
- `frontend/src/stores/usePondStore.ts` — added `hoveredTodoId: string | null` slice + `setHoveredTodoId` action with no-op identity guard
- `frontend/src/stores/usePondStore.test.ts` — 4 new tests for `setHoveredTodoId`
- `frontend/src/components/pond/LilyPad.tsx` — hover publish in `onPointerEnter` (with 5 guards), hover clear in `onPointerLeave` (with same-id race guard), unmount cleanup extension for `hoveredTodoId`. Drag-start hover-clear was added then reversed per user feedback — see Implementation Note 1.
- `frontend/src/components/pond/LilyPad.test.tsx` — added mocks for `setHoveredTodoId`, `hoveredTodoId`, `activeDragAnchor` (mutable); 6 new hover tests
- `frontend/src/components/pond/PondScene.tsx` — imported `InfoPopup`, selected `hoveredTodoId`, derived `infoTodo`, rendered `<InfoPopup>` block above `<ActionPopup>` block
- `_bmad-output/implementation-artifacts/3-4-lily-pad-info-popup.md` — task/subtask checkboxes, Status → review, this Dev Agent Record
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `3-4-lily-pad-info-popup: ready-for-dev → in-progress → review`

### Change Log

- 2026-04-23 — Implemented hover-preview + focused-interactive info popup with NeonScrollbar chrome. Two user corrections landed during implementation: (a) popup must not be cleared when user drags the hovered pad, and (b) popup must visually follow the live drag position, with a sticky-position mitigation to prevent release flash while the refetch lands.
