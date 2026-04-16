# Story 2.3: In-Scene Neon Wireframe Action Popup

Status: review

> **Story 2.3 was renumbered on 2026-04-16.** The prior "Completion Egg — Hatch to Complete" work was superseded during a PRD simplification; it now lives at `2-3-completion-egg-hatch-to-complete.superseded.md`. This new Story 2.3 is the **foundational primitive** for all pad-level actions — Stories 2.4 (Complete), 2.5 (Delete), and 4.1 (Set Color) all depend on it.

## Story

As a user,
I want to click a lily pad and see the camera focus on it with a neon wireframe action popup rendered in the 3D scene beside it,
so that every pad interaction (complete, delete, set color, group) flows through one consistent primitive.

## Acceptance Criteria

1. **Given** an active lily pad on the pond, **When** I click the pad, **Then** the camera smoothly glides to frame the pad (300-500ms eased) via the existing `cameraFocus` system in `usePondStore`.

2. **Given** the camera has finished focusing, **When** the pad is in view, **Then** a neon wireframe popup materializes in the 3D scene anchored to the pad's upper-right in camera space, auto-repositioned to stay within the viewport.

3. **Given** the popup is materializing, **When** it appears, **Then** it renders 4 action buttons as neon wireframe elements: **Complete**, **Delete**, **Set Color**, **Group** (or **Ungroup** if the pad is part of a cluster — for v1 of this primitive, render **Group** always since clustering is Epic 4.2).

4. **Given** the popup is open, **When** I click outside the pad's hit area, **Then** the popup dismisses with a brief materialize-out animation (~150ms) and the camera returns to its prior position (300-500ms eased).

5. **Given** the popup is open, **When** I press Escape, **Then** the popup dismisses and the camera returns to its prior position (same as AC 4).

6. **Given** the popup is open, **When** I click a different lily pad, **Then** the current popup closes immediately and the new pad's popup opens (only one popup open at a time).

7. **Given** the popup is rendered, **When** observing it, **Then** it uses the neon aesthetic: wireframe geometry, Bloom-lit glow, monospace retro labels (`var(--font-mono)`).

8. **Given** I click an action button, **When** the button is clicked, **Then** the button's onClick handler fires a typed event (see Technical Notes — action handlers are stubs in this story; Stories 2.4, 2.5, and 4.1 wire up Complete, Delete, and Set Color respectively; Group is a no-op console.log for now).

9. **Given** the todo count is high and pads are at progressive density, **When** I click a pad, **Then** the camera focus enlarges the pad to readable size before the popup appears, and the popup is sized for legibility regardless of pad density state.

10. **Given** the popup is rendering, **When** the camera orbits or zooms, **Then** the popup stays anchored to the pad's upper-right in camera space and remains legible.

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

## Dev Notes

### Architecture & Design References

- **Action Popup component spec:** See `architecture.md` — Custom Components → Action Popup (ActionPopup, PopupActionButton, PopupColorSwatch)
- **UX spec:** See `ux-design-specification.md` → Custom Components — Action Popup section; Pad Interaction Pattern section
- **Camera focus system:** Existing in `PondCamera.tsx` and `usePondStore.cameraFocus` / `focusCamera(x, z, zoom)`
- **Bloom postprocessing:** Already wired in `PondScene.tsx`; wireframe + emissive materials will glow automatically
- **Neon design tokens:** `--neon-pink #ff10f0`, `--neon-cyan #00eeff`, `--neon-orange #ff6600`, `--neon-green #39ff14`, `--neon-gold #ffd700`

### Popup Positioning Approach

The popup lives in the 3D scene (not as an HTML overlay) so it glows via Bloom and feels native to the pond. It's rendered as a `<group>` at a position offset from the pad, with a billboard rotation so it always faces the camera.

```tsx
// frontend/src/components/ui/ActionPopup.tsx (sketch)
import { Billboard } from '@react-three/drei';

export function ActionPopup({ todo, onComplete, onDelete, onSetColor, onGroup }: Props) {
  const [visible, setVisible] = useState(true);
  const offset = useMemo(() => new THREE.Vector3(1.5, 1.5, -1.5), []);

  useEffect(() => {
    // Materialize in; trigger unmount animation on prop change
    // (parent unmounts this component when activePopupTodoId changes)
  }, []);

  return (
    <Billboard position={[todo.positionX + offset.x, offset.y, todo.positionY + offset.z]}>
      <PopupActionButton label="Complete" onClick={onComplete} color="--neon-green" />
      <PopupActionButton label="Delete"   onClick={onDelete}   color="--neon-pink" />
      <PopupActionButton label="Set Color" onClick={onSetColor} color="--neon-cyan" />
      <PopupActionButton label="Group"    onClick={onGroup}    color="--neon-gold" />
    </Billboard>
  );
}
```

### PopupActionButton Wireframe Rendering

Use `<line>` with `LineSegmentsGeometry` (from drei `<Line>`) for the wireframe rectangle; Bloom will pick up the `color` prop and glow it. The label overlays via drei `<Html center transform>` with the monospace retro font.

```tsx
// frontend/src/components/ui/PopupActionButton.tsx (sketch)
import { Line, Html } from '@react-three/drei';

const BUTTON_W = 1.4;
const BUTTON_H = 0.3;
const CORNERS: Array<[number, number, number]> = [
  [-BUTTON_W/2, -BUTTON_H/2, 0],
  [ BUTTON_W/2, -BUTTON_H/2, 0],
  [ BUTTON_W/2,  BUTTON_H/2, 0],
  [-BUTTON_W/2,  BUTTON_H/2, 0],
  [-BUTTON_W/2, -BUTTON_H/2, 0],
];

export function PopupActionButton({ label, onClick, color = 'cyan' }: Props) {
  const [hovered, setHovered] = useState(false);
  return (
    <group
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <Line points={CORNERS} color={color} lineWidth={hovered ? 2.5 : 1.5} />
      <Html center transform>
        <span style={{ color, fontFamily: 'var(--font-mono)', fontSize: 14, textShadow: `0 0 6px ${color}` }}>
          {label}
        </span>
      </Html>
    </group>
  );
}
```

### Camera Focus Integration

The store's existing `focusCamera(x, z, zoom)` already handles the lerp-to-target animation in `PondCamera.tsx`. For the popup:

- `openPopup(todoId)` reads the todo's `positionX`/`positionY` and calls `focusCamera(positionX, positionY, 4)` (distance 4 gives a tight framing)
- `closePopup()` clears `activePopupTodoId` and clears `cameraFocus` — PondCamera stops the lerp, user can continue orbiting

```typescript
// frontend/src/stores/usePondStore.ts (additions)
interface PondState {
  // ... existing fields
  activePopupTodoId: string | null;
  openPopup: (todoId: string, x: number, z: number) => void;
  closePopup: () => void;
}

// In create:
activePopupTodoId: null,
openPopup: (todoId, x, z) => {
  set({ activePopupTodoId: todoId });
  get().focusCamera(x, z, 4);
},
closePopup: () => {
  set({ activePopupTodoId: null, cameraFocus: null });
},
```

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
- DO NOT render the popup as an HTML overlay above the canvas — it must be in-scene so Bloom picks it up
- DO NOT install new npm packages (Three.js, drei, R3F all already present)
- DO NOT store popup state in React component state — use the Zustand store so any component can open/close it
- DO NOT remove the existing CompletionEgg / creature hatch code yet (Story 2.4 handles that cleanup)

### Previous Story Learnings

From Story 2.2 (Lily Pad Creation):
- **drei `<Html>`**: already used in LilyPad text overlay — same pattern works for button labels
- **`useState(factory)` for stable refs** — React Compiler safe pattern
- **happy-dom mocking of R3F**: `PondScene.test.tsx` pattern of mocking Canvas/useFrame
- **Zustand store pattern**: existing `triggerRipple` and `focusCamera` actions are good templates for `openPopup`/`closePopup`
- **Scope discipline**: only create the files listed in Tasks 1-9

### Project Structure — Files to Create/Modify

```
frontend/src/
├── components/
│   ├── ui/
│   │   ├── ActionPopup.tsx              # NEW
│   │   ├── ActionPopup.test.tsx         # NEW
│   │   ├── PopupActionButton.tsx        # NEW
│   │   └── PopupActionButton.test.tsx   # NEW
│   ├── pond/
│   │   ├── LilyPad.tsx                  # MODIFY — add onClick → openPopup
│   │   ├── LilyPad.test.tsx             # MODIFY — verify click calls openPopup
│   │   ├── PondScene.tsx                # MODIFY — render ActionPopup when popup is active
│   │   └── PondCamera.tsx               # MODIFY — close popup on click-outside
├── hooks/
│   ├── useClosePopupOnEscape.ts         # NEW
│   └── useClosePopupOnEscape.test.ts    # NEW
├── stores/
│   ├── usePondStore.ts                  # MODIFY — activePopupTodoId + openPopup/closePopup
│   └── usePondStore.test.ts             # MODIFY — new action tests
└── App.tsx                              # MODIFY — wire useClosePopupOnEscape
```

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

- `npx vitest run` — 30/30 tests passing across 11 files (includes 4 new test files).
- `npx tsc -b` — clean.
- `npm run lint` — 7 errors, identical count and categories to master baseline (no new errors introduced by this story).
- `npm run dev` — Vite compiles all new/modified modules, serves at 5173, no transform errors.

### Completion Notes List

- Store (`usePondStore`): added `activePopupTodoId`, `openPopup(id,x,z)`, `closePopup()`. `openPopup` replaces any active popup and routes through existing `focusCamera` with `zoom=4`.
- LilyPad: pad mesh `onClick` calls `openPopup(todo.id, posX, posZ)`, stops R3F propagation, and marks `nativeEvent.sceneHandled = true` so `PondCamera`'s canvas pointer-up skips water-centering. Added `focused` prop that bumps resting scale to 1.2 (progressive density override guard).
- ActionPopup: in-scene `<Billboard>` positioned at `[padX ± 1.5, 1.5, padZ − 1.5]`, with NDC flip logic between upper-right/upper-left based on viewport edge (thresholds 0.7/-0.3). Materialize-in/out animates scale 0↔1 over 150ms; materialize-in is gated on `cameraFocus === null` so the popup appears only after the camera arrival animation settles.
- PopupActionButton: wireframe rectangle via drei `<Line>`, monospace label via `<Html center>`, Bloom picks up glow automatically. Hover bumps line width + label glow; click triggers a 120ms 1→0.92→1 pulse via `useFrame`.
- PondScene: mounts at most one `ActionPopup`. Uses `usePondStore.subscribe` (not `useEffect` on selector) to hold the rendered popup id for 150ms after `activePopupTodoId` clears so the close animation plays — avoids `react-hooks/set-state-in-effect`.
- PondCamera: subscribes to the store to capture `{ target.x, target.z, distance }` when a popup opens, and restores it via `focusCamera` on close — this implements AC 4/5 "camera returns to prior position". Water-click handler now (a) respects `sceneHandled` on the native event, and (b) when a popup is open, calls `closePopup()` instead of centering on the water hit.
- `useClosePopupOnEscape` hook: wired from `App.tsx`; skips when input/textarea/contentEditable is focused (same guard pattern as `useKeyboardShortcuts`).
- Stubs for Complete/Delete/Set Color/Group are wired as `console.log` with `// TODO(Story 2.4/2.5/4.1/Epic 4.2)` markers in `PondScene.tsx`.
- Existing CompletionEgg / creature hatch code was intentionally left in place per Dev Notes ("Story 2.4 handles that cleanup").

### Change Log

| Date | Change |
|------|--------|
| 2026-04-16 | Implemented Story 2.3: in-scene neon wireframe Action Popup primitive. Added store actions, ActionPopup + PopupActionButton components, click-outside + Escape dismiss, camera return-to-prior, progressive density focus override, 17 new tests. All ACs satisfied. |

### File List

**New:**
- `frontend/src/components/ui/ActionPopup.tsx`
- `frontend/src/components/ui/ActionPopup.test.tsx`
- `frontend/src/components/ui/PopupActionButton.tsx`
- `frontend/src/components/ui/PopupActionButton.test.tsx`
- `frontend/src/hooks/useClosePopupOnEscape.ts`
- `frontend/src/hooks/useClosePopupOnEscape.test.ts`
- `frontend/src/stores/usePondStore.test.ts`

**Modified:**
- `frontend/src/stores/usePondStore.ts` — added `activePopupTodoId`, `openPopup`, `closePopup`
- `frontend/src/components/pond/LilyPad.tsx` — pad click → `openPopup`; `focused` prop + scale override
- `frontend/src/components/pond/LilyPad.test.tsx` — mock updates; click-fires-openPopup test
- `frontend/src/components/pond/PondScene.tsx` — mounts `ActionPopup`; 150ms close-hold via store subscribe; passes `focused` to LilyPad
- `frontend/src/components/pond/PondCamera.tsx` — prior-focus capture/restore; click-outside closes popup; `sceneHandled` short-circuit
- `frontend/src/App.tsx` — wires `useClosePopupOnEscape`
