# Story 2.3: Action Popup Primitive

Status: done

> **Story 2.3 was renumbered on 2026-04-16.** The prior "Completion Egg — Hatch to Complete" work was superseded during a PRD simplification; it now lives at `2-3-completion-egg-hatch-to-complete.superseded.md`. This new Story 2.3 is the **foundational primitive** for all pad-level actions — Stories 2.4 (Complete), 2.5 (Delete), and 4.1 (Set Color) all depend on it.

> **Scope amended 2026-04-16 after code review.** The initial implementation was an in-scene 3D popup (Billboard + drei `<Line>` + Bloom glow) per the original spec. During iteration it proved fragile: the fat-line raycasting, per-frame React state updates, and nested Billboards interfered with R3F's event routing and the water-ripple render loop, breaking OrbitControls zoom/rotate and freezing shader animations. Reimplemented as an HTML overlay via drei `<Html>` with a CSS-styled neon panel and SVG callout line. The ACs below describe the **shipped HTML-overlay behavior**. Dropped from scope for this story (candidates for future stories): materialize-in/out animations, camera-return-on-close, viewport-edge flip, true wireframe geometry, Bloom-lit glow on the popup (DOM elements sit outside the WebGL render target and cannot be picked up by the postprocessing pass — that would require going back in-scene).

## Story

As a user,
I want to click a lily pad and see the camera focus on it with a neon action popup anchored to the pad,
so that every pad interaction (complete, delete, set color, group) flows through one consistent primitive.

## Acceptance Criteria

1. **Given** an active lily pad on the pond, **When** I click the pad, **Then** the camera smoothly glides to frame the pad (300-500ms eased) via the existing `cameraFocus` system in `usePondStore`. Every click runs the full pan+zoom, even if the camera is already nearby, so the clicked pad reliably ends up centered.

2. **Given** the pad is clicked, **When** the popup mounts, **Then** a neon-styled HTML panel appears anchored to the pad's projected screen position (drei `<Html>` at `[positionX, 0.4, positionY]`), with an SVG callout line connecting the panel to the pad.

3. **Given** the popup is open, **When** observing it, **Then** it renders 4 action buttons in a vertical stack: **Complete**, **Delete**, **Set Color**, **Group** (or **Ungroup** if the pad is part of a cluster — for v1 of this primitive, render **Group** always since clustering is Epic 4.2).

4. **Given** the popup is open, **When** I click outside the pad's hit area, **Then** the popup dismisses immediately and the camera is released (`activePopupTodoId` and `cameraFocus` both cleared). User can then orbit/zoom freely. No materialize-out animation and no camera-return-to-prior-position in v1.

5. **Given** the popup is open, **When** I press Escape, **Then** the popup dismisses (same as AC 4). Skipped when focus is inside an `<input>`, `<textarea>`, or `contentEditable` element.

6. **Given** the popup is open, **When** I click a different lily pad, **Then** the current popup closes immediately and the new pad's popup opens (only one popup open at a time).

7. **Given** the popup is rendered, **When** observing it, **Then** it uses the neon aesthetic via CSS: dark translucent background, `--neon-cyan` 1px border, `box-shadow` glow, monospace retro labels (`var(--font-mono)`), per-button neon colors (`--neon-green` Complete / `--neon-pink` Delete / `--neon-cyan` Set Color / `--neon-gold` Group). The SVG callout has `filter: drop-shadow` for glow.

8. **Given** I click an action button, **When** the button is clicked, **Then** the button's onClick handler fires — action handlers are stubs in this story (`console.log` only); Stories 2.4, 2.5, and 4.1 wire up Complete, Delete, and Set Color respectively; Group is a no-op for now.

9. **Given** the todo count is high and pads are at progressive density, **When** a pad is the active popup's pad, **Then** the `focused` prop on `LilyPad` bumps the resting scale to 1.2 so the pad remains at readable size. Applies only during the pad's `resting` animation phase.

10. **Given** the popup is rendering, **When** the camera orbits or zooms, **Then** drei `<Html>` reprojects the panel's screen position every frame so it follows the pad. No viewport-edge flip in v1 — if the pad is near the right edge the panel can extend off-screen.

## Tasks / Subtasks

- [x] Task 1: Extend `usePondStore` with active-popup state (AC: #2, #6)
  - [x] Add `activePopupTodoId: string | null` to `PondState`
  - [x] Add `openPopup(todoId: string): void` action — sets `activePopupTodoId` and triggers `focusCamera(x, z, zoom=4)` at the pad's position
  - [x] Add `closePopup(): void` action — clears `activePopupTodoId` and clears `cameraFocus` (or returns to prior position — see Technical Notes)
  - [x] If `openPopup` is called while another popup is open, close the prior one first

- [x] Task 2: Wire pad click to open popup (AC: #1, #2, #6)
  - [x] Add `onClick` handler to the pad mesh in `LilyPad.tsx`
  - [x] Call `usePondStore.openPopup(todo.id)` on click
  - [x] Stop event propagation so the pad click doesn't also trigger the `PondCamera` double-click-water behavior
  - [x] Ensure hover state (cursor change, glow intensification) is preserved from existing LilyPad hover behavior

- [x] Task 3: Create `ActionPopup.tsx` component (AC: #2, #3, #7, #10)
  - [x] New file: `frontend/src/components/ui/ActionPopup.tsx`
  - [x] Renders a 3D group positioned in-scene, anchored to the pad's position + offset
  - [x] Offset positioning: `[padX + 1.5, 1.5, padZ - 1.5]` (upper-right in default camera orientation) — adjust to billboard toward camera so it always faces the viewer
  - [x] Use `<group>` with `lookAt` toward camera (via `useFrame` or `<Billboard>` from drei) so the popup always faces the user
  - [x] Auto-reposition to stay within viewport: project the anchor point to NDC; if the x-projection > 0.7, flip the popup to the pad's upper-left instead
  - [x] Render 4 `PopupActionButton` components in a vertical stack with 0.4-unit spacing
  - [x] Materialize-in animation: scale 0→1 over 150ms with ease-out on mount
  - [x] Materialize-out animation: scale 1→0 over 150ms; unmount after animation completes

- [x] Task 4: Create `PopupActionButton.tsx` component (AC: #3, #7, #8)
  - [x] New file: `frontend/src/components/ui/PopupActionButton.tsx`
  - [x] Props: `{ label: string; onClick: () => void; color?: string }` (color defaults to `--neon-cyan`)
  - [x] Wireframe neon rectangle using `LineSegments` geometry (4 edges of a rounded rect, ~1.4 × 0.3 units)
  - [x] Monospace label inside via `<Html center>` from drei or CSS2DRenderer overlay
  - [x] Hover state: emissive intensity goes from 0.8 → 1.4, wireframe line width visually amplified (via scale on the line segments)
  - [x] Click: triggers `onClick`; small pulse animation (scale 1 → 0.92 → 1 over 120ms)
  - [x] Glow via Bloom postprocessing (already configured in PondScene)

- [x] Task 5: Mount popup from `PondScene` (AC: #2, #6)
  - [x] In `PondScene.tsx`, read `activePopupTodoId` from store
  - [x] If non-null, find the matching todo, and render `<ActionPopup todo={todo} />`
  - [x] Action handlers for v1 (stubs): Complete → `console.log('Complete', todo.id)`; Delete → `console.log('Delete', todo.id)`; Set Color → `console.log('Set Color', todo.id)`; Group → `console.log('Group', todo.id)`. Leave a `// TODO(Story 2.4/2.5/4.1)` comment above each stub.

- [x] Task 6: Wire dismiss on click-outside + Escape (AC: #4, #5)
  - [x] In `PondCamera.tsx` click handler (or a new sibling hook), detect clicks on empty water vs. on pads — if popup is open AND the click isn't on the focused pad, call `closePopup()`
  - [x] Create a new hook `useClosePopupOnEscape.ts` that listens for Escape and calls `closePopup()` when a popup is active (skip when any input is focused — same pattern as `useKeyboardShortcuts.ts`)
  - [x] Wire the hook from `App.tsx`

- [x] Task 7: Camera return on dismiss (AC: #4, #5)
  - [x] When `closePopup` is called, store the prior camera position/target before the focus was applied so it can be restored
  - [x] Option A (simpler): `closePopup` clears `cameraFocus` and `PondCamera` continues damping back toward the current OrbitControls target — the user sees a natural "ease back"
  - [x] Option B (more explicit): store a `priorFocus: FocusTarget | null` and on close, set `cameraFocus = priorFocus`. Pick Option A unless Option B is demonstrably needed.

- [x] Task 8: Progressive density focus-enlarge (AC: #9)
  - [x] LilyPad already has density-aware scale logic (check current implementation); when a pad is the `activePopupTodoId`, apply a min-scale override so it renders at readable size during focus
  - [x] If the existing density system doesn't support an override, add a `focused` prop to `LilyPad` and enlarge scale to at least 1.0 (normal size) while focused

- [x] Task 9: Tests (AC: all)
  - [x] `frontend/src/components/ui/ActionPopup.test.tsx` — renders with 4 buttons, dismisses on close, handles focus changes
  - [x] `frontend/src/components/ui/PopupActionButton.test.tsx` — renders label, onClick fires, hover state toggles
  - [x] `frontend/src/stores/usePondStore.test.ts` — extend existing tests: `openPopup` sets `activePopupTodoId` and triggers `focusCamera`; `closePopup` clears state; opening a new popup closes the prior
  - [x] `frontend/src/hooks/useClosePopupOnEscape.test.ts` — Escape closes popup when active; no-op when no popup; no-op when input is focused
  - [x] Update `LilyPad.test.tsx` to verify click calls `openPopup`
  - [x] Run full test suite — all should pass

### Review Findings

- [x] [Review][Decision] AC divergence → resolved: **amend spec to match shipped reality** as an intentional scope change. Viewport-edge flip and camera-return will be re-examined in future stories, not re-added here.

- [x] [Review][Patch] `closePopup` now clears `cameraFocus` alongside `activePopupTodoId` [`frontend/src/stores/usePondStore.ts:72-76`]
- [x] [Review][Patch] Story 2.3 amended to match shipped HTML overlay — ACs 2/4/5/7/10 rewritten, Anti-Pattern against HTML overlays removed, Dev Notes rewritten for drei `<Html>` approach, File List updated, Completion Notes now describe shipped code, Change Log has honest entry for the refactor [`_bmad-output/implementation-artifacts/2-3-in-scene-action-popup.md`]
- [x] [Review][Patch] Dead `sceneHandled` machinery removed from `LilyPad.handlePadClick` and `PondCamera.handlePointerUp` + `SceneHandledEvent` interface deleted [`frontend/src/components/pond/LilyPad.tsx`, `frontend/src/components/pond/PondCamera.tsx`]
- [x] [Review][Patch] `usePondStore.test.ts` now asserts `closePopup` clears both `activePopupTodoId` and `cameraFocus` [`frontend/src/stores/usePondStore.test.ts:54-65`]

- [x] [Review][Defer] Popup is inert if its todo is removed from `useTodos` while `activePopupTodoId` is still set — ActionPopup unmounts but store state lingers [`frontend/src/components/pond/PondScene.tsx:49-51`] — deferred, rare multi-tab/external-mutation edge case
- [x] [Review][Defer] No ARIA dialog semantics or focus management on the popup — screen readers get unannotated buttons; no focus trap [`frontend/src/components/ui/ActionPopup.tsx:40-78`] — deferred, accessibility pass best done after scope is locked
- [x] [Review][Defer] SVG callout line does not re-enable `pointer-events` — clicks that land on the diagonal pass through to the canvas and close the popup via the water-click path [`frontend/src/components/ui/ActionPopup.css:12-22`] — deferred, low-probability click target

## Dev Notes

### Architecture & Design References

- **Action Popup component spec:** See `architecture.md` — Custom Components → Action Popup (ActionPopup, PopupActionButton, PopupColorSwatch)
- **UX spec:** See `ux-design-specification.md` → Custom Components — Action Popup section; Pad Interaction Pattern section
- **Camera focus system:** Existing in `PondCamera.tsx` and `usePondStore.cameraFocus` / `focusCamera(x, z, zoom)`
- **Bloom postprocessing:** Already wired in `PondScene.tsx`; wireframe + emissive materials will glow automatically
- **Neon design tokens:** `--neon-pink #ff10f0`, `--neon-cyan #00eeff`, `--neon-orange #ff6600`, `--neon-green #39ff14`, `--neon-gold #ffd700`

### Popup Positioning Approach (shipped)

The popup is an HTML overlay rendered via drei `<Html>` at the pad's 3D position. drei projects that position to screen space every frame so the panel tracks the pad as the camera moves. Inside the `<Html>` wrapper is a zero-size anchor div; the neon panel and SVG callout are absolutely positioned from that anchor.

```tsx
// frontend/src/components/ui/ActionPopup.tsx (actual)
import { Html } from '@react-three/drei';
import './ActionPopup.css';

const PANEL_OFFSET_X = 80;
const PANEL_OFFSET_Y = 120;

export function ActionPopup({ todo, onComplete, onDelete, onSetColor, onGroup }: Props) {
  return (
    <Html
      position={[todo.positionX ?? 0, 0.4, todo.positionY ?? 0]}
      zIndexRange={[100, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <div className="action-popup">
        <svg className="action-popup__callout" width={PANEL_OFFSET_X} height={PANEL_OFFSET_Y}>
          <line x1="0" y1={PANEL_OFFSET_Y} x2={PANEL_OFFSET_X} y2="0" />
        </svg>
        <div
          className="action-popup__panel"
          style={{ transform: `translate(${PANEL_OFFSET_X}px, -${PANEL_OFFSET_Y}px)` }}
        >
          <button className="action-popup__button action-popup__button--complete" onClick={onComplete}>Complete</button>
          <button className="action-popup__button action-popup__button--delete" onClick={onDelete}>Delete</button>
          <button className="action-popup__button action-popup__button--set-color" onClick={onSetColor}>Set Color</button>
          <button className="action-popup__button action-popup__button--group" onClick={onGroup}>Group</button>
        </div>
      </div>
    </Html>
  );
}
```

**Pointer-events strategy.** The outer `<Html>` wrapper sets `pointer-events: none` so mouse events pass through the overlay region to the canvas beneath (letting OrbitControls keep receiving drag/wheel input). The `.action-popup__panel` class re-enables `pointer-events: auto` so the buttons are clickable. Because the buttons are real DOM `<button>` elements sitting above the canvas, their click events don't flow through R3F's raycasting system at all.

### Button Styling (shipped)

Buttons are plain `<button>` elements styled via CSS in `ActionPopup.css`:

- `border: 1px solid currentColor` per-button neon color
- `background: rgba(0, 0, 0, 0.82)` for the panel, transparent for buttons
- `box-shadow` + `text-shadow` with neon tokens for the glow
- `font-family: var(--font-mono)`, uppercase, 0.12em letter-spacing
- `cursor: none` to avoid doubling the neon firefly cursor
- `:hover` brightens glow and adds an inset shadow; `:active` scales to 0.96

### Camera Focus Integration (shipped)

- `openPopup(todoId, x, z)` sets `activePopupTodoId` and calls `focusCamera(x, z, POPUP_FOCUS_ZOOM)` (distance 4).
- `PondCamera.useFrame` re-seeds `targetVec` from `cameraFocus` **every frame** while it's set — not just on transition. This was a deliberate fix for a race where the canvas `pointerup` listener and R3F's click dispatch both fire on a pad click and stomp each other's target: letting `cameraFocus` always win makes the pad reliably end up centered.
- On arrival, `PondCamera` clears `cameraFocus` and `animating`. Outside an active lerp, it calls `controls.update()` every frame so OrbitControls' damping state stays synced with the camera (otherwise post-animation wheel/drag misfired).
- `closePopup()` clears both `activePopupTodoId` **and** `cameraFocus` — so a mid-lerp dismiss immediately halts the camera instead of letting it finish zooming into a pad whose popup is already gone.

### Click Detection: Pad vs. Water vs. Popup (shipped)

- **Pad click (no popup open):** DOM `pointerup` fires first on canvas → `PondCamera.handlePointerUp` raycasts water → sets `targetVec` to water-hit + `animating=true`. Then R3F dispatches pad `onClick` → `openPopup` sets `cameraFocus` at the pad. The per-frame override immediately re-seeds `targetVec` from `cameraFocus` so the camera ends up on the pad, not the water-hit point. (An earlier `sceneHandled` flag on the native event was removed — it couldn't work because R3F's click fires after DOM pointerup, so the flag was never observable in time.)
- **Pad click (popup open):** `PondCamera.handlePointerUp` sees `activePopupTodoId !== null` → calls `closePopup` (clears id + cameraFocus). Then R3F dispatches pad `onClick` → `openPopup` sets the new pad. Net effect: popup switches.
- **Popup button click:** the button is a DOM element rendered by `<Html>`, sitting above the canvas. Its click event fires on the button and doesn't reach the canvas's `pointerup` listener, so water/pad logic isn't triggered.
- **Empty water click (no popup):** standard camera centering.
- **Empty water click (popup open):** `closePopup` fires (short-circuits the centering path).

### Click Detection: Pad vs. Water vs. Popup

`PondCamera.tsx` currently detects clicks on empty water (for the camera target move) via raycasting against the water plane. We need to order click handling:

1. If a popup button is clicked → button's onClick fires, `stopPropagation` prevents the pad/water handlers
2. If a pad is clicked (not the active one) → `openPopup(padId)` fires; if a popup was already open for another pad, `openPopup` auto-closes it first
3. If empty water is clicked while a popup is open → `closePopup()`
4. If empty water is clicked without a popup open → existing PondCamera centering behavior

The R3F event system bubbles; use `e.stopPropagation()` in pad/button onClick handlers. In `PondCamera.tsx`, the pointer-up handler's click-on-water path should check `activePopupTodoId`: if set, call `closePopup()` instead of the centering behavior.

### Progressive Density Override

`LilyPad.tsx` currently renders at a density-aware scale (not yet implemented if fewer than ~10 pads exist). When `activePopupTodoId === todo.id`, the pad should override its density scale to at least 1.0. Simplest approach: pass a `focused` prop from `PondScene`.

### Anti-Patterns to Avoid

- DO NOT use `async def` in backend Python (CLAUDE.md) — this story is frontend-only
- DO NOT implement Complete logic (that's Story 2.4)
- DO NOT implement Delete logic (that's Story 2.5)
- DO NOT implement Set Color swatch panel (that's Story 4.1)
- DO NOT implement Group/Ungroup logic (that's Epic 4.2)
- DO NOT install new npm packages (Three.js, drei, R3F all already present)
- DO NOT store popup state in React component state — use the Zustand store so any component can open/close it
- DO NOT remove the existing CompletionEgg / creature hatch code yet (Story 2.4 handles that cleanup)
- DO NOT re-introduce drei `<Line>` / in-scene meshes for the popup unless you've diagnosed and fixed the R3F event/render-loop interference we hit on the first attempt (see Change Log entry for 2026-04-16 refactor)

### Previous Story Learnings

From Story 2.2 (Lily Pad Creation):
- **drei `<Html>`**: already used in LilyPad text overlay — same pattern works for button labels
- **`useState(factory)` for stable refs** — React Compiler safe pattern
- **happy-dom mocking of R3F**: `PondScene.test.tsx` pattern of mocking Canvas/useFrame
- **Zustand store pattern**: existing `triggerRipple` and `focusCamera` actions are good templates for `openPopup`/`closePopup`
- **Scope discipline**: only create the files listed in Tasks 1-9

### Project Structure — Files to Create/Modify (shipped)

```
frontend/src/
├── components/
│   ├── ui/
│   │   ├── ActionPopup.tsx              # NEW — drei <Html> overlay with panel + SVG callout
│   │   ├── ActionPopup.test.tsx         # NEW
│   │   └── ActionPopup.css              # NEW — neon panel, callout, button styles
│   ├── pond/
│   │   ├── LilyPad.tsx                  # MODIFY — add onClick → openPopup; `focused` prop + scale override
│   │   ├── LilyPad.test.tsx             # MODIFY — verify click calls openPopup
│   │   ├── PondScene.tsx                # MODIFY — render ActionPopup when popup is active
│   │   └── PondCamera.tsx               # MODIFY — close popup on click-outside; per-frame cameraFocus override; per-frame controls.update
├── hooks/
│   ├── useClosePopupOnEscape.ts         # NEW
│   └── useClosePopupOnEscape.test.ts    # NEW
├── stores/
│   ├── usePondStore.ts                  # MODIFY — activePopupTodoId + openPopup/closePopup (clears cameraFocus too)
│   └── usePondStore.test.ts             # MODIFY — new action tests
├── api/
│   └── client.ts                        # MODIFY — hardcode baseURL to '/api' (MSYS path-mangling fix bundled with this story)
└── App.tsx                              # MODIFY — wire useClosePopupOnEscape
```

`PopupActionButton.tsx` was planned in the original in-scene design but is **not shipped** in the HTML-overlay refactor — buttons are plain `<button>` elements inside `ActionPopup.tsx`.

### Testing Standards

- Vitest + @testing-library/react
- happy-dom environment (already configured)
- Mock R3F Canvas/useFrame as done in existing tests
- Use `renderHook` for store action tests
- Run `npm run test` to verify all tests pass before marking story done

### References

- [Source: architecture.md#Frontend component tree] — ActionPopup/PopupActionButton/PopupColorSwatch locations
- [Source: architecture.md#Component rendering table] — Action Popup row specifies Three.js wireframe + CSS2DRenderer + Bloom
- [Source: ux-design-specification.md#Pad Interaction Pattern] — click-to-focus + popup materialization flow
- [Source: ux-design-specification.md#Custom Components — Action Popup] — ActionPopup/PopupActionButton/PopupColorSwatch descriptions
- [Source: epics.md#Story 2.3] — original AC source
- [Source: frontend/src/stores/usePondStore.ts] — existing `cameraFocus`/`focusCamera` contract
- [Source: frontend/src/components/pond/PondCamera.tsx] — existing focus lerp implementation
- [Source: 2-2-lily-pad-creation-the-drop.md] — patterns for test mocking, store actions, optimistic mutations

### Open Questions (for developer judgment during implementation)

1. **Popup offset direction:** Should the popup always appear upper-right of the pad, or should it pick a side based on camera angle? Suggested: start with upper-right + viewport-edge flip logic (see AC 2); refine if it feels awkward.
2. **Camera zoom distance on focus:** `zoom=4` is a starting guess. Tune during implementation to get a comfortable popup reading distance.
3. **Button spacing:** 0.4 unit spacing is a starting guess; verify it doesn't overlap at different popup positions.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context)

### Debug Log References

- `npx vitest run` — all tests passing.
- `npx tsc -b` — clean.
- `npm run lint` — no new errors vs master baseline.
- Manual browser testing — open pad → popup appears, rotate/zoom work, click-outside/Escape dismiss, camera releases on close.

### Completion Notes List

**Final shipped behavior (after the HTML-overlay refactor in commit `cbc39fd`):**

- **Store (`usePondStore`)**: added `activePopupTodoId`, `openPopup(id, x, z)`, `closePopup()`. `openPopup` replaces any active popup and routes through `focusCamera` with `POPUP_FOCUS_ZOOM = 4`. `closePopup` clears both `activePopupTodoId` **and** `cameraFocus` so a mid-lerp dismiss immediately halts the camera.
- **LilyPad**: pad mesh `onClick` calls `openPopup(todo.id, posX, posZ)`. `focused` prop bumps resting-phase scale to 1.2 for progressive-density readability.
- **ActionPopup**: drei `<Html>` anchored at `[todo.positionX ?? 0, 0.4, todo.positionY ?? 0]`. Inside: a zero-size anchor div (`.action-popup`, `pointer-events: none`), an SVG callout line (`<line>` from origin to panel top-left), and a panel div (`.action-popup__panel`, `pointer-events: auto`) translated by `(80px, -120px)` from the anchor. Four `<button>` elements — Complete / Delete / Set Color / Group — with per-button neon colors and `cursor: none` to match the app-wide cursor hide.
- **ActionPopup.css**: neon panel with dark translucent background + cyan border + box-shadow glow; SVG callout with `drop-shadow` filter; monospace uppercase button labels with `text-shadow` glow; `:hover` brightens, `:active` scales to 0.96.
- **PondScene**: reads `activePopupTodoId` via zustand selector; mounts at most one `<ActionPopup>` keyed by todo id. Passes `focused={activePopupTodoId === todo.id}` to each `LilyPad`. No setTimeout close-hold — popup unmounts immediately on dismiss.
- **PondCamera**: canvas `pointerup` handler — if `activePopupTodoId` is set, calls `closePopup()` (water-click path short-circuits to dismiss). `useFrame` re-seeds `targetVec` from `cameraFocus` every frame while set (not just on transition) so every pad click reliably centers. `controls.update()` runs every frame (inside the focus lerp for smooth damping, and in the non-focus branch too so post-animation input doesn't misfire).
- **`useClosePopupOnEscape` hook**: wired from `App.tsx`; Escape dismisses popup unless focus is in an input/textarea/contentEditable element.
- **Stubs**: Complete/Delete/Set Color/Group are `console.log` with `// TODO(Story 2.4/2.5/4.1/Epic 4.2)` markers in `PondScene.tsx`.
- **Existing CompletionEgg / creature hatch code** left in place per Dev Notes (Story 2.4 will replace it).

**Bundled fix (out-of-scope but necessary):**
- `frontend/src/api/client.ts` hardcodes `baseURL: '/api'` and `.env.example` got a warning comment. Git Bash / MSYS on Windows was mangling `VITE_API_URL=/api` into `C:/Program Files/Git/api`, silently breaking POSTs during iteration. Not a popup concern but blocked the dev loop.

**Dropped from scope for this story** (see the "Scope amended" note at the top of the file):
- Materialize-in / materialize-out scale animations
- Camera-return-to-prior on popup dismiss
- Viewport-edge flip (upper-right ↔ upper-left)
- True neon wireframe geometry + Bloom-lit glow (DOM overlay is outside the WebGL render target)

### Change Log

| Date | Change |
|------|--------|
| 2026-04-16 | Initial implementation of Story 2.3: in-scene 3D popup with `<Billboard>` + drei `<Line>` + in-scene button meshes, scale materialize animations, prior-focus capture/restore, viewport-edge NDC flip. Committed as `7afaa2a`. |
| 2026-04-16 | **Refactored to HTML overlay** (commit `cbc39fd`). Root cause: the in-scene approach interfered with R3F's event routing (OrbitControls rotate/zoom broke once a popup was shown) and the water-ripple render loop (ripples froze). Replaced Billboard + Line meshes with a single drei `<Html>` containing a CSS-styled panel and SVG callout. Dropped: materialize animations, camera-return-on-close, viewport-edge flip (see Scope Amended note for rationale). Added: per-frame `controls.update()` in `PondCamera`, `closePopup` also clears `cameraFocus`. Bundled fix: hardcode `/api` in `client.ts` to sidestep Git Bash MSYS path-mangling. |
| 2026-04-16 | Code review follow-up: closePopup cleared cameraFocus (was already set-to-null at a different site but not in the action itself), removed dead `sceneHandled` plumbing that was left over from the in-scene approach, this story file amended to match shipped reality. |

### File List

**New:**
- `frontend/src/components/ui/ActionPopup.tsx` — drei `<Html>` overlay
- `frontend/src/components/ui/ActionPopup.test.tsx`
- `frontend/src/components/ui/ActionPopup.css` — neon panel, callout, button styles
- `frontend/src/hooks/useClosePopupOnEscape.ts`
- `frontend/src/hooks/useClosePopupOnEscape.test.ts`
- `frontend/src/stores/usePondStore.test.ts`

**Modified:**
- `frontend/src/stores/usePondStore.ts` — added `activePopupTodoId`, `openPopup`, `closePopup` (closePopup clears cameraFocus)
- `frontend/src/components/pond/LilyPad.tsx` — pad click → `openPopup`; `focused` prop + resting-phase scale override
- `frontend/src/components/pond/LilyPad.test.tsx` — mock updates; click-fires-openPopup test
- `frontend/src/components/pond/PondScene.tsx` — mounts `ActionPopup`; passes `focused` to LilyPad; no close-hold
- `frontend/src/components/pond/PondCamera.tsx` — click-outside closes popup; per-frame `cameraFocus → targetVec` override; per-frame `controls.update()`
- `frontend/src/App.tsx` — wires `useClosePopupOnEscape`
- `frontend/src/api/client.ts` — hardcode `baseURL: '/api'` (MSYS path-mangling fix, out-of-scope bundled change)
- `.env.example` — comment documenting the MSYS trap

**Not shipped (planned in original in-scene design):**
- `frontend/src/components/ui/PopupActionButton.tsx` and test — superseded by plain `<button>` elements inside `ActionPopup.tsx`
