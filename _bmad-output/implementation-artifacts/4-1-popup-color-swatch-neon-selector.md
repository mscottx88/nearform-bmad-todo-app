# Story 4.1: Popup Color Swatch — Neon Selector

Status: ready-for-dev

> **Replaces** the prior "Color Chameleon & Neon Picker" story from the earlier Epic 4 plan. The chameleon creature and ring-of-sprites picker are removed; color assignment is now an inline sub-panel of the `ActionPopup` (shipped in Story 2.3). `ColorChameleon.tsx` / `ColorPicker.tsx` never landed in this codebase, so there is no removal work — clean slate.

## Story

As a user,
I want to click **Set Color** on a pad's Action Popup and pick a neon color from an inline swatch ring,
so that I can visually organize my todos without leaving the popup and without a separate creature interaction.

## Acceptance Criteria

1. **Given** a lily pad's Action Popup is open, **When** I click **Set Color**, **Then** the popup expands an inline sub-panel (appears below the four-button panel, same neon-cyan wireframe aesthetic) showing five swatches in a horizontal row: `#ff10f0` (neon pink), `#00eeff` (neon cyan), `#ff6600` (neon orange), `#39ff14` (neon green), `#ffd700` (neon gold). Each swatch is a small circle (~24px) with the swatch color, a 1px wireframe ring in `currentColor`, and an in-hue `text-shadow` glow — matching the existing popup button language.

2. **Given** the color sub-panel is open, **When** I hover a swatch, **Then** the target pad's body and rim color preview in real-time — the pad's shader `uColor` uniform and the rim's `MeshBasicMaterial.color` both lerp toward the hovered swatch's color over ~100ms (fast, so the preview reads as responsive). Releasing the hover (mouseleave) WITHOUT clicking reverts the preview to the committed color.

3. **Given** the color sub-panel is open, **When** I click a swatch, **Then** (a) the swatch's color commits as the pad's new color locally (ref + state-mirror; no flicker), (b) `useUpdateTodo.mutate({ id, color })` fires a `PATCH /api/todos/{id}` with the new color, (c) the sub-panel collapses back to the four-button popup state, and (d) a subtle ripple emanates from the pad's X/Z via `usePondStore.triggerRipple` — same primitive as the complete/delete ripples, used here as "choice made" feedback.

4. **Given** the color sub-panel is open, **When** I press Escape OR click **Set Color** a second time, **Then** the sub-panel collapses without changing the color. Any hover-preview lerp in flight snaps back to the committed color within one frame of collapse. No network call fires.

5. **Given** the `PATCH /api/todos/{id}` request fails (e.g., network error, 500 response), **When** React Query's retry budget (`retry: 3`, exponential backoff from 2.6 configuration) is exhausted, **Then** `usePondStore.setTodoError(id, 'update', error)` is called via the existing `useUpdateTodo` `onError` handler — the pad enters the decay visual from Story 2.6. The local color preview REMAINS at the user-picked color (optimistic UI) rather than reverting; the decay visual signals the failure without snapping the user's choice away.

6. **Given** the color-swatch commit path fires, **When** `PATCH /api/todos/{id}` succeeds, **Then** the existing `useUpdateTodo.onSuccess` handler clears the decay entry (via `clearTodoError`) and invalidates the `['todos', 'list']` query, producing a refetch that confirms the server's stored color matches the local value.

7. **Given** the pad shader's `uColor` uniform is currently initialized once at mount with a `useState` lazy initializer [`LilyPad.tsx:469-478`](frontend/src/components/pond/LilyPad.tsx#L469-L478), **When** `todo.color` changes from an external source (this story's color-swatch commit OR a concurrent edit from another session), **Then** a new effect syncs `padUniforms.uColor.value` to the latest `todo.color` — fixing the 2.4 code-review deferred-work entry that called this out. Rim color (`<meshBasicMaterial color={color} />`) already re-renders on prop change, so no change needed there.

8. **Given** keyboard users, **When** the color sub-panel is open, **Then** swatches are focusable in tab order (rendered as `<button>` elements, not `<div>`s); pressing Enter or Space on a focused swatch commits just like a click; pressing Escape collapses the panel (AC #4). Each swatch carries `aria-label` in the format `"Set color to {name}"` (e.g., `"Set color to neon green"`).

9. **Given** the existing popup click-event absorption added in story 2.7 (`onPointerDown/Up/Click` stopPropagation on the panel root), **When** I click a swatch, **Then** the click does NOT propagate to the water-surface raycaster (so the swatch commit doesn't accidentally trigger a water ripple under the popup). The commit-time ripple from AC #3 is the ONLY ripple that fires.

10. **Given** I re-run the full test suite after this change, **When** all tests finish, **Then** every existing test remains green. New unit tests cover: swatch render + aria labels, click-to-commit calls `useUpdateTodo.mutate` with `{ id, color }`, Escape collapses the sub-panel, second-click on Set Color toggles the sub-panel, and the `uColor`-sync effect writes `padUniforms.uColor.value` when `todo.color` changes.

## Tasks / Subtasks

- [ ] Task 1: Create `frontend/src/components/ui/PopupColorSwatch.tsx` (AC: #1, #8)
  - [ ] Export a component accepting props: `committedColor: string`, `onHover: (color: string | null) => void`, `onCommit: (color: string) => void`, `onCollapse: () => void`.
  - [ ] Define module-scope `NEON_SWATCHES` constant: `readonly [{ color: string; name: string }, ...]` with the five AC #1 entries. Use the names in `aria-label`.
  - [ ] Render `<div className="action-popup__color-swatches">` with five `<button type="button">` children, each styled as a circle via CSS (see Task 2).
  - [ ] Per-swatch inline style: `{ backgroundColor: color, color, boxShadow: '0 0 8px currentColor' }` — inherits text-shadow / wireframe pattern.
  - [ ] `onMouseEnter` → `onHover(color)`; `onMouseLeave` → `onHover(null)`; `onClick` / keyboard Enter-Space → `onCommit(color)`.
  - [ ] Add a `useEffect` that listens for `keydown` while mounted: Escape → `onCollapse()`. Cleanup on unmount.
  - [ ] Commit-and-collapse is `ActionPopup`'s responsibility (see Task 3); this component just forwards events.

- [ ] Task 2: Add CSS to `frontend/src/components/ui/ActionPopup.css` for the swatch row (AC: #1)
  - [ ] `.action-popup__color-swatches` — flex row, `gap: 8px`, `padding: 8px 10px 10px`, `border-top: 1px solid rgba(0, 238, 255, 0.2)` (divider from the action buttons above), hidden via `display: none` when the swatch sub-panel is collapsed.
  - [ ] `.action-popup__color-swatch` — 24px circle, `border: 1px solid currentColor`, `border-radius: 50%`, `cursor: none` (matches other popup buttons — OS cursor suppressed project-wide), `text-shadow: 0 0 4px currentColor`, `transition: transform 100ms ease, box-shadow 100ms ease`.
  - [ ] `.action-popup__color-swatch:hover { transform: scale(1.15); box-shadow: 0 0 12px currentColor, inset 0 0 6px currentColor; }`
  - [ ] `.action-popup__color-swatch:active { transform: scale(0.92); }`
  - [ ] `.action-popup__color-swatch:focus-visible { outline: 2px solid var(--neon-cyan); outline-offset: 3px; }` (keyboard-reachable per AC #8).

- [ ] Task 3: Integrate the swatch sub-panel into `ActionPopup.tsx` (AC: #1, #3, #4, #9)
  - [ ] Add local state: `const [swatchOpen, setSwatchOpen] = useState(false);`
  - [ ] Add local state: `const [previewColor, setPreviewColor] = useState<string | null>(null);`
  - [ ] Replace the `onSetColor` wiring on the Set Color button with `() => setSwatchOpen((open) => !open)` — toggle semantics (AC #4 "clicking Set Color again collapses").
  - [ ] Conditionally render `<PopupColorSwatch ... />` below the four-button block when `swatchOpen === true`.
  - [ ] Wire `onHover={setPreviewColor}`, `onCollapse={() => { setSwatchOpen(false); setPreviewColor(null); }}`, and `onCommit={(color) => { props.onCommitColor(color); setSwatchOpen(false); setPreviewColor(null); }}`.
  - [ ] Change the `ActionPopupProps` interface — `onSetColor` becomes `onCommitColor: (color: string) => void` and a new `onPreviewColor?: (color: string | null) => void` is added (called on hover). Propagate the hover via an effect: `useEffect(() => { props.onPreviewColor?.(previewColor); }, [previewColor, props.onPreviewColor])`.

- [ ] Task 4: Replace the stub in `frontend/src/components/pond/PondScene.tsx` (AC: #3, #6)
  - [ ] Import `useUpdateTodo` from `../../api/todoApi`.
  - [ ] Inside the PondScene component, call `const updateTodo = useUpdateTodo();`.
  - [ ] Replace `onSetColor={() => console.log('Set Color', popupTodo.id)}` at [`PondScene.tsx:162-163`](frontend/src/components/pond/PondScene.tsx#L162-L163) with:
    ```ts
    onCommitColor={(color) => {
      updateTodo.mutate({ id: popupTodo.id, color });
      usePondStore.getState().triggerRipple(popupTodo.positionX ?? 0, popupTodo.positionY ?? 0);
      usePondStore.getState().closePopup();
    }}
    onPreviewColor={(color) => usePondStore.getState().setColorPreview(popupTodo.id, color)}
    ```
  - [ ] The `closePopup` on commit matches the Complete/Delete pattern — popup closes once the user has acted. If product wants the popup to stay open for multi-pick, invert this in a follow-up.

- [ ] Task 5: Add `colorPreview` state to `usePondStore.ts` for live hover feedback (AC: #2)
  - [ ] New state: `colorPreviews: Map<string, string>` (todoId → previewed hex color). Empty by default.
  - [ ] New action: `setColorPreview: (todoId: string, color: string | null) => void`. If `color` is null, `delete` the entry; else `set`.
  - [ ] New selector: `selectColorPreview = (todoId: string) => (state: PondState) => state.colorPreviews.get(todoId) ?? null`.
  - [ ] No persistence; preview is session-only.

- [ ] Task 6: Wire preview into `LilyPad.tsx` (AC: #2, #7)
  - [ ] Subscribe: `const previewColor = usePondStore(selectColorPreview(todo.id));`.
  - [ ] Compute effective color: `const effectiveColor = previewColor ?? todo.color ?? '#00ff88';` — use throughout the component in place of the current `const color = todo.color || '#00ff88';` at [`LilyPad.tsx:372`](frontend/src/components/pond/LilyPad.tsx#L372).
  - [ ] Add `useEffect` that writes `padMeshRef.current.material.uniforms.uColor.value` on every change to `effectiveColor`:
    ```ts
    useEffect(() => {
      const c = new THREE.Color(effectiveColor);
      if (padMeshRef.current) {
        const mat = padMeshRef.current.material as THREE.ShaderMaterial;
        if (mat.uniforms?.uColor) {
          mat.uniforms.uColor.value.set(c.r, c.g, c.b);
        }
      }
    }, [effectiveColor]);
    ```
    _This is the fix for the 2.4 deferred-work entry: `padUniforms.uColor` no longer frozen at mount._
  - [ ] Keep the existing `colorVec` memoization but derive it from `effectiveColor` so the resting-branch `uColor` lerp target also tracks preview/committed color changes.

- [ ] Task 7: Tests — `frontend/src/components/ui/PopupColorSwatch.test.tsx` (AC: #8, #10)
  - [ ] Render the component with `committedColor="#00ff88"` and spies for `onHover`/`onCommit`/`onCollapse`.
  - [ ] Assert five swatches render with correct `aria-label` values.
  - [ ] Click a swatch → `onCommit` called with the swatch's hex.
  - [ ] Press Escape → `onCollapse` called.
  - [ ] Press Enter on focused swatch → `onCommit` called (native `<button>` handles this).
  - [ ] Hover → `onHover` called with hex; unhover → `onHover(null)`.

- [ ] Task 8: Tests — update `frontend/src/components/ui/ActionPopup.test.tsx` (AC: #3, #4, #10)
  - [ ] Click Set Color → swatch sub-panel visible.
  - [ ] Click Set Color again → sub-panel hidden.
  - [ ] Click a swatch → `onCommitColor` called with the hex, sub-panel hidden.
  - [ ] Press Escape with panel open → sub-panel hidden, `onCommitColor` NOT called.

- [ ] Task 9: Tests — update `frontend/src/components/pond/PondScene.test.tsx` (AC: #3, #10)
  - [ ] Add/extend a test that opens the popup and simulates the `onCommitColor` callback firing → assert `useUpdateTodo.mutate` was called with `{ id, color }`, `triggerRipple` was called, and `closePopup` was called. Reuse the existing `updateMutate` spy pattern (see [`PondScene.test.tsx:37`](frontend/src/components/pond/PondScene.test.tsx#L37)).

- [ ] Task 10: Manual browser verification (AC: all)
  - [ ] Open a pad's popup, click Set Color → swatch ring appears below the buttons.
  - [ ] Hover each of the five swatches → pad body + rim preview the color in real-time.
  - [ ] Click a swatch → pad commits the color, sub-panel closes, single ripple emanates, Network panel shows `PATCH /api/todos/{id}` with the new color.
  - [ ] Escape / second-click on Set Color → sub-panel closes without changing the color.
  - [ ] Force-fail the PATCH (DevTools offline mode) → decay visual from 2.6 appears on the pad, but the local color stays at the picked value.
  - [ ] `npx vitest run` — all new tests green, previous 69 still green.
  - [ ] `npx tsc -b` — clean.

## Dev Notes

### Pattern reuse from Story 2.7 / Story 2.4

This story leans directly on primitives established in recent Epic 2 work:
- **Popup button language** — `.action-popup__button` already defines the neon-wireframe aesthetic (transparent bg, 1px `currentColor` border, text-shadow glow, `cursor: none`). The swatch buttons are smaller circles with the same visual grammar.
- **Pointer-event absorption at panel root** — 2.7 added `onPointerDown`/`onPointerUp`/`onClick` stopPropagation on `.action-popup__panel`. The swatch sub-panel is a child of that root, so AC #9's ripple-guard is inherited for free.
- **`useUpdateTodo` with decay-on-failure** — 2.6 wired `onError` → `setTodoError` and `onSuccess` → `clearTodoError`. This story's commit reuses that hook unchanged; the only new behavior is the `triggerRipple` + `closePopup` call alongside the `mutate`.
- **`triggerRipple(x, z)`** — already a store primitive used by complete/delete. Reuse for the "choice made" feedback in AC #3. Single-slot ripple state may coalesce with in-flight ambient/click ripples (pre-existing limitation tracked in `deferred-work.md` 2.6 entry) — accept for this story.

### The `uColor` uniform sync (AC #7)

The `padUniforms` object is constructed once via `useState(() => ({ uColor: { value: ... } }))` at [`LilyPad.tsx:469-478`](frontend/src/components/pond/LilyPad.tsx#L469-L478). Its `.value` Vector3 is the authoritative source read by the shader every frame. Mutating `.value` via `.set(r, g, b)` inside a `useEffect([effectiveColor])` is the cheapest sync — no re-construction of the uniforms object, no React re-render. This matches the pattern 2.7 used for `uFlashColor.value.copy(...)` and `uFlashStrength.value = ...` inside `useFrame`.

The existing resting-branch lerp at [`LilyPad.tsx:785-799`](frontend/src/components/pond/LilyPad.tsx#L785-L799) already lerps `uColor.value` toward a completion-dimmed or decay-dimmed target — that logic must now read from `effectiveColor` (preview-aware) instead of the frozen-at-mount `colorVec`. Simplest: re-derive `colorVec = useMemo(() => new THREE.Color(effectiveColor), [effectiveColor])` from the preview-aware value, then the existing lerp works unchanged.

### Optimistic UI on PATCH failure (AC #5)

Do NOT revert the local color on `onError`. The decay visual from 2.6 already signals "this pad is in a failing state"; reverting the color would be a second, contradictory signal and would erase the user's stated intent. The "retry" button pattern from 2.6 (implicit via re-triggering the mutation — `useUpdateTodo`'s `onMutate` clears `errorTodos`) gives the user a path to recover without losing their color choice.

### Why swatches, not a color wheel / gradient picker

The epics-file notes explicitly cap the choice to five neon presets for the pond's retro-neon aesthetic — arbitrary hex picks would produce visually-discordant pads (muted greys, muddy browns) that break the pond's coherence. Locking to a curated palette preserves the "neon aquarium" feel. If Epic 4 later wants more colors, extend the `NEON_SWATCHES` constant in one place.

### Project Structure — Files to Create / Modify / Delete

**New:**
- `frontend/src/components/ui/PopupColorSwatch.tsx` — the swatch sub-panel component.
- `frontend/src/components/ui/PopupColorSwatch.test.tsx` — unit tests.

**Modified:**
- `frontend/src/components/ui/ActionPopup.tsx` — add `swatchOpen` state, toggle on Set Color click, render `<PopupColorSwatch>` conditionally. Change prop contract: `onSetColor` → `onCommitColor` + `onPreviewColor?`.
- `frontend/src/components/ui/ActionPopup.css` — add `.action-popup__color-swatches` container + `.action-popup__color-swatch` button styling.
- `frontend/src/components/ui/ActionPopup.test.tsx` — cover the toggle, commit, and Escape-dismiss flows.
- `frontend/src/components/pond/PondScene.tsx` — import `useUpdateTodo`; replace the `onSetColor` stub with `onCommitColor` + `onPreviewColor` wired to `useUpdateTodo` + `triggerRipple` + `closePopup` + `setColorPreview`.
- `frontend/src/components/pond/PondScene.test.tsx` — extend or add a test covering the commit flow (`useUpdateTodo.mutate` spy + ripple + closePopup).
- `frontend/src/components/pond/LilyPad.tsx` — subscribe to `selectColorPreview`, compute `effectiveColor`, re-derive `colorVec` from it, add the `useEffect` that syncs `padUniforms.uColor.value` on color change.
- `frontend/src/stores/usePondStore.ts` — add `colorPreviews: Map<string, string>` state, `setColorPreview` action, and `selectColorPreview` selector.
- `frontend/src/stores/usePondStore.test.ts` (if exists; otherwise extend a neighbouring test file) — cover `setColorPreview` set/clear semantics.

**Deleted:** none. `ColorChameleon.tsx` / `ColorPicker.tsx` don't exist in this codebase — the epics-file "removal" note is a carry-over from a pre-installation plan.

**Untouched (keep):**
- `backend/**` — the `PATCH /api/todos/{id}` endpoint and `update_todo` service already accept a `color` field (see [`backend/src/api/todos.py:34-44`](backend/src/api/todos.py#L34-L44) and [`backend/tests/api/test_todos.py:91`](backend/tests/api/test_todos.py#L91) `test_update_todo_color`). No backend changes.
- `useUpdateTodo` hook — already supports `color` in its `UpdateTodoInput` interface ([`todoApi.ts:38-45`](frontend/src/api/todoApi.ts#L38-L45)).
- The complete/delete/focus-flash animation logic from 2.4/2.5/2.7 — color changes during `resting` only; flash sequences use their own uniforms.
- `EmergingCreature.tsx` and the creature pool — completely orthogonal to color changes.
- ROYGBIV per-letter styling on the Set Color button from story 2.7 — kept as is; the button's visual still reads "colorful thing" even when collapsed.

## Previous Story Intelligence (from Stories 2.3, 2.4, 2.6, 2.7)

Patterns that apply directly:

- **Popup panel + pointerdown/pointerup/click stopPropagation** (2.7) — the swatch sub-panel is a child of `.action-popup__panel`, so the existing event-absorption inherits automatically. No new stopPropagation needed on swatches themselves.
- **`useUpdateTodo.mutate` + `onError` decay + `onSuccess` clearTodoError** (2.6) — reuse the hook unchanged. AC #5 and #6 are behavior that falls out of the existing wiring; this story adds no new error-handling code.
- **`triggerRipple(x, z)` at action commit** (2.4, 2.5) — same primitive; call it alongside `mutate` in PondScene's commit handler.
- **`closePopup()` after action** (2.4, 2.5) — popup closes once the user has acted. Exceptions (multi-pick, hover-to-sample) would invert this; not in scope.
- **Ref + state-mirror split for JSX gates** (2.4 / 2.5) — NOT needed here. The color preview is React state; the committed color is `todo.color` from React Query cache; nothing needs imperative ref mutation from `useFrame`.
- **`useEffect` syncing a ref/uniform to prop change** (2.6 `targetY`, 2.7 none-new) — the `uColor` sync in Task 6 follows this pattern: a tight `useEffect([effectiveColor])` that mutates the uniform in place without re-creating the uniforms object.
- **HDR vs LDR** — the swatch colors are LDR (standard hex triplets). No HDR treatment needed; they feed into the pad shader's existing sRGB `uColor` path. The HDR work is only in the flash sequences from 2.7.

## Anti-Patterns to Avoid

- **DO NOT reset local color to server value on PATCH failure.** Optimistic UI + decay visual is the correct feedback per AC #5. Reverting would fight the user's intent.
- **DO NOT embed the swatch ring as a drei `<Html>` overlay separate from the popup.** The swatches must live inside the existing `.action-popup__panel` so they inherit the popup's focus trap target, event absorption, and dismiss-on-popup-close semantics.
- **DO NOT allow arbitrary color input (color picker, hex field).** Locked palette per AC #1 and dev notes. If a future story wants free-form colors, extend the palette constant first and evaluate whether the pond's visual coherence survives.
- **DO NOT trigger a second ripple on hover/preview.** Ripples are "commit" feedback; hovering must be silent. AC #9 explicitly forbids this.
- **DO NOT add a close-on-click-outside behavior for the swatch panel specifically.** The popup itself handles click-outside-to-close (via existing camera-focus-clear or whatever ships in 2.3+); the swatch panel is a child of the popup and inherits that behavior.
- **DO NOT re-create `padUniforms` on color change.** Mutate `.value` in place. Re-creation would trigger a shader rebuild on every preview-hover frame.
- **DO NOT change the `useUpdateTodo` hook itself.** Its `onMutate`/`onSuccess`/`onError` already cover the error/recovery flow. Additional color-specific behavior belongs in the caller, not the shared hook.
- **DO NOT tile the swatches in a ring around the pad in 3D space.** The prior epics plan called for a "ring of sprites" — explicitly replaced by the inline 2D HTML swatches in the popup. Keeping this out of 3D keeps the hit-testing simple and matches the popup's DOM-overlay pattern.

## Git Intelligence (last commits, most → least recent)

- `4580fde` — story 2.7 code-review follow-ups. Among the patches: dropped the dead `.action-popup__rainbow-letter` CSS block from `ActionPopup.css`. Your new `.action-popup__color-swatch` CSS will live in the vicinity of the remaining `.action-popup__button--set-color` rule.
- `68f70d4` — story 2.7 polish: added ROYGBIV rainbow letters to the Set Color button + `onPointerDown`/`onPointerUp`/`onClick` stopPropagation on the popup panel root + delete button color `#ff1744`. **Directly relevant** — the Set Color button's visual treatment (rainbow letters) stays; only its onClick behavior changes from "log stub" to "toggle swatch sub-panel".
- `705def5` — story 2.7 initial implementation: focus-flash + uFlashColor/uFlashStrength uniforms. Orthogonal — flash sequences don't intersect color-change flow (no flashes during swatch-open/hover/commit).
- `77f450a` — story 2.6 code-review follow-ups: `clearTodoError` unmount cleanup, decay-flicker offset, `onMutate` → `clearTodoError` flow. **Directly relevant** — AC #5/#6 rely on this plumbing unchanged.
- `204c6ce` — realistic ripples. **Relevant** — the "commit-time ripple" in AC #3 rides this pipeline (single-slot uniform, 2.6-era wavefront shader).

Net: the popup + color-update + ripple plumbing is all fresh from Epic 2's recent work. 4.1 is mostly a wiring story — one new component, one stub replacement, one deferred-work patch (uColor sync). Tight scope.

## Testing Standards

- Vitest + `@testing-library/react`, `happy-dom` environment.
- Mock R3F `useFrame` / `useThree`; mock drei `<Html>` / `<Billboard>` as simple wrappers.
- Use the existing `makeTestClient()` factory in `PondScene.test.tsx` for React Query client (retry: false).
- Use `fireEvent.click`, `fireEvent.keyDown` with `key: 'Escape'` / `'Enter'` — no need for userEvent for keyboard flows at this scope.
- For the swatch hover test: `fireEvent.mouseEnter` / `fireEvent.mouseLeave` on the swatch element.
- Mock `useUpdateTodo` in PondScene test (pattern already established at [`PondScene.test.tsx:37`](frontend/src/components/pond/PondScene.test.tsx#L37) — `useUpdateTodo: () => ({ mutate: vi.fn() })`).
- `npx vitest run` — all 69+ existing tests remain green; 6-10 new assertions added across PopupColorSwatch/ActionPopup/PondScene test files.
- `npx tsc -b` — clean.

## References

- [Source: `_bmad-output/planning-artifacts/epics.md:441-467`] — Epic 4 and Story 4.1 AC source; replaces prior "Color Chameleon & Neon Picker" story.
- [Source: `frontend/src/components/pond/PondScene.tsx:162-163`] — current `onSetColor={() => console.log('Set Color', popupTodo.id)}` stub to replace.
- [Source: `frontend/src/components/ui/ActionPopup.tsx:45-142`] — existing popup structure + Set Color button with ROYGBIV letters (story 2.7) to hook into.
- [Source: `frontend/src/components/ui/ActionPopup.tsx:80-90`] — `onPointerDown`/`onPointerUp`/`onClick` stopPropagation on panel root; inherited by the new swatch sub-panel for AC #9.
- [Source: `frontend/src/api/todoApi.ts:38-73`] — `useUpdateTodo` hook with `color` field support, `onError` → `setTodoError`, `onSuccess` → `clearTodoError`.
- [Source: `frontend/src/components/pond/LilyPad.tsx:372`] — current `const color = todo.color || '#00ff88';`; to be replaced with `effectiveColor` computed from preview + committed color.
- [Source: `frontend/src/components/pond/LilyPad.tsx:469-478`] — `padUniforms` `useState` lazy init; site of the Task 6 sync `useEffect`.
- [Source: `frontend/src/components/pond/LilyPad.tsx:785-799`] — existing resting-branch `uColor` lerp; must read from `effectiveColor`.
- [Source: `frontend/src/stores/usePondStore.ts:109-110`] — `triggerRipple` action; reuse for AC #3 commit feedback.
- [Source: `frontend/src/stores/usePondStore.ts:62-86`] — store interface location for new `colorPreviews` state + `setColorPreview` action.
- [Source: `backend/src/api/todos.py:34-44`] — `PATCH /api/todos/{todo_id}` endpoint; already handles `color` field via `update_todo` service.
- [Source: `backend/tests/api/test_todos.py:91`] — `test_update_todo_color` confirms endpoint round-trips a color change.
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md` § "Deferred from: code review of story 2-4…"] — `padUniforms.uColor captured once at LilyPad mount; doesn't react to todo.color changes` — explicitly called out as "Story 4.1 (popup color-swatch) will need to wire color-change through the shader uniform". Task 6 resolves this deferred item.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md` § "Emotional Design Principles"] — neon-aquarium visual coherence rationale for the locked palette.

## Dev Agent Record

### Agent Model Used

_(to be filled on dev-story run)_

### Debug Log References

_(to be filled on dev-story run)_

### Completion Notes List

_(to be filled on dev-story run)_

### Change Log

| Date | Change |
|------|--------|
| 2026-04-17 | Story created as Epic 4.1 (first story of Epic 4 "Organizing the Pond"). Scope: replace the `onSetColor` stub in PondScene with a real swatch sub-panel + persist via existing `useUpdateTodo` + resolve the 2.4 `uColor` sync deferred-work entry. Palette locked to 5 neon colors. |

### File List

_(to be filled on dev-story run)_
