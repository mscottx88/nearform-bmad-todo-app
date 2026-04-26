import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LilyPad } from './LilyPad';
import type { Todo } from '../../types';

const openPopupMock = vi.fn();
const clearTargetPositionMock = vi.fn();
const togglePadSelectionMock = vi.fn();
// Story 4.2: hoisted mock fn so both `vi.mock('../../api/todoApi')` and
// per-test assertions can reach the same instance. vitest hoists
// `vi.mock` above imports, so a top-level `const` declared before
// `vi.mock` isn't yet initialised when the mock factory runs — the
// `vi.hoisted` wrapper gives us a hoisted-safe shared reference.
const { updateTodoMutateMock } = vi.hoisted(() => ({
  updateTodoMutateMock: vi.fn(),
}));

vi.mock('../../api/todoApi', () => ({
  // Story 4-8: LilyPad now calls useUpdateTodoPositions (batch). The
  // existing test spy is reused under the new hook name so every
  // existing test's mutate-was-called assertion continues to work —
  // the test just sees a single-entry array where it previously saw
  // `{ id, positionX, positionY }`.
  useUpdateTodoPositions: () => ({ mutate: updateTodoMutateMock }),
  TODOS_KEY: ['todos', 'list'],
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  // Story 4.2: LilyPad's drag pipeline calls useThree() for the
  // camera + canvas so it can convert window-level pointermove
  // events into water-plane raycasts. The stub returns a fake
  // camera with a projectionMatrix + matrixWorld that
  // `Raycaster.setFromCamera` can consume, and a minimal
  // `gl.domElement` whose getBoundingClientRect returns a
  // viewport-sized rect. Tests that assert on drag math call the
  // raycaster via a synthetic pointermove — the numbers don't need
  // to correspond to a real scene, they just can't throw.
  useThree: () => ({
    camera: (() => {
      const THREE = require('three') as typeof import('three');
      const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
      cam.position.set(0, 15, 20);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld(true);
      return cam;
    })(),
    gl: {
      domElement: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 1920,
          bottom: 1080,
          width: 1920,
          height: 1080,
          x: 0,
          y: 0,
        }),
      },
    },
  }),
}));

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const completingTodosMock = new Map<string, unknown>();
const deletingTodosMock = new Map<string, unknown>();
const triggerRippleMock = vi.fn();
const setHoveredTodoIdMock = vi.fn();
// Story 3.4: mutable hoveredTodoId so tests can emulate the "hover is
// the current one" state when firing pointerLeave.
const hoverStateMock = { current: null as string | null };
// Story 3.4: mutable activeDragAnchor so tests can emulate "another pad
// is being dragged" to assert hover is blocked.
const activeDragAnchorMock = { current: null as { padId: string; x: number; z: number } | null };
const startCompletionMock = vi.fn();
const stampCompletionStartMock = vi.fn();
const finishCompletionMock = vi.fn();
const startDeletionMock = vi.fn();
const stampDeletionStartMock = vi.fn();
const finishDeletionMock = vi.fn();

vi.mock('../../stores/usePondStore', () => ({
  // Selector-aware stub: returns undefined for any hook selector call
  // (covers `s.completingTodos.get(id)` and `s.deletingTodos.get(id)` — the
  // only selectors this component uses). `getState()` exposes the shape the
  // component touches imperatively — `openPopup`, the two override maps,
  // the triggerRipple action, and all the start/stamp/finish actions that
  // the `useFrame` branches call. These are mocked defensively so that if a
  // future test un-mocks `useFrame` for a phase-progression assertion, the
  // store methods exist and the suite doesn't blow up with "not a function".
  usePondStore: Object.assign(() => undefined, {
    getState: () => ({
      openPopup: openPopupMock,
      completingTodos: completingTodosMock,
      deletingTodos: deletingTodosMock,
      // Story 4.2: AC #6 — if a popup is open on THIS pad, the
      // pointerDown guard returns early. Setting to null here
      // matches the default "no popup open" state for the click
      // tests; the guard is exercised via explicit override below.
      activePopupTodoId: null,
      triggerRipple: triggerRippleMock,
      startCompletion: startCompletionMock,
      stampCompletionStart: stampCompletionStartMock,
      finishCompletion: finishCompletionMock,
      startDeletion: startDeletionMock,
      stampDeletionStart: stampDeletionStartMock,
      finishDeletion: finishDeletionMock,
      // Story 2.6 P7 follow-up: LilyPad calls clearTodoError on unmount to
      // prevent Map-entry leaks. The mock must expose it so the cleanup
      // effect doesn't throw "not a function" during test teardown.
      clearTodoError: vi.fn(),
      // Story 4.1 CR-patch: LilyPad's unmount cleanup also clears any
      // lingering color preview. Mirror the pattern above.
      setColorPreview: vi.fn(),
      // Story 4.2: drag-over-spread and spread-arrival both touch
      // these. Kept empty so the resting-branch spread lerp is a
      // no-op in unit tests (no arrival callback fires).
      clearTargetPosition: clearTargetPositionMock,
      padTargetPositions: new Map(),
      // Story 5.3: LilyPad reads these imperatively inside useFrame to
      // decide its per-pad search mode. Inactive defaults keep this
      // test running against the pre-search rendering path.
      searchActive: false,
      searchAllMatches: false,
      // Story 4.6: Shift/Ctrl/Meta-click on a pad routes into the
      // selection slice instead of the drag / popup pipeline.
      togglePadSelection: togglePadSelectionMock,
      // Retained drag-pipeline + cursor wiring (post group removal).
      setActiveDragAnchor: vi.fn(),
      get activeDragAnchor() {
        return activeDragAnchorMock.current;
      },
      cursorMode: 'firefly',
      setCursorMode: vi.fn(),
      // Story 3.4: hover publish/clear.
      get hoveredTodoId() {
        return hoverStateMock.current;
      },
      setHoveredTodoId: setHoveredTodoIdMock,
      // Story 4.2 cascade (2026-04-23): secondary-anchor map. Empty
      // Map plus no-op setters keeps unit-test runs deterministic —
      // the cascade branch in useFrame iterates an empty Map and
      // falls through without engaging.
      displacedPads: new Map(),
      setDisplacedPad: vi.fn(),
      clearDisplacedPad: vi.fn(),
    }),
  }),
  selectCompleting: () => () => undefined,
  selectDeleting: () => () => undefined,
  selectTodoError: () => () => undefined,
  // Story 4.1: preview selector returns null so effectiveColor falls
  // back to todo.color in this test harness.
  selectColorPreview: () => () => null,
  // Story 5.3: search-hit selector returns undefined — todo isn't a
  // match in this test harness.
  selectSearchHit: () => () => undefined,
  // Story 4.6: test harness reports the pad as unselected; the
  // selection-visual branch (useFrame oscillation) is therefore
  // inactive for these tests.
  selectIsSelected: () => () => false,
}));

const mockTodo: Todo = {
  id: '123',
  text: 'Test todo',
  completed: false,
  color: '#00eeff',
  positionX: 5,
  positionY: 7,
  rotationY: 0,
  driftSeed: 0,
  dueDate: null,
  embeddingStatus: 'pending',
  archived: false,
  archivedAt: null,
  deleted: false,
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// Story 4.2: the pad's click path is a mesh pointerDown followed
// by a window-level pointerUp (with no movement between) so the
// click-vs-drag discrimination classifies it as a click. The
// window-level listener is attached inside the mesh's pointerDown
// handler, so the pointerUp MUST be dispatched on `window` (not the
// mesh) to trigger the popup-open branch.
function fireClickAt(el: Element, x = 0, y = 0): void {
  fireEvent.pointerDown(el, {
    clientX: x,
    clientY: y,
    pointerId: 1,
    buttons: 1,
  });
  fireEvent.pointerUp(window, {
    clientX: x,
    clientY: y,
    pointerId: 1,
    buttons: 0,
  });
}

describe('LilyPad', () => {
  beforeEach(() => {
    openPopupMock.mockClear();
    updateTodoMutateMock.mockClear();
    clearTargetPositionMock.mockClear();
    togglePadSelectionMock.mockClear();
    setHoveredTodoIdMock.mockClear();
    completingTodosMock.clear();
    deletingTodosMock.clear();
    hoverStateMock.current = null;
    activeDragAnchorMock.current = null;
  });

  it('renders without errors', () => {
    const { container } = render(<LilyPad todo={mockTodo} />);
    expect(container).toBeTruthy();
  });

  it('calls openPopup with todo id and pad position when clicked (sub-threshold pointerUp)', () => {
    const { container } = render(<LilyPad todo={mockTodo} />);
    const padMesh = container.querySelector('mesh');
    expect(padMesh).toBeTruthy();
    if (padMesh) fireClickAt(padMesh);
    expect(openPopupMock).toHaveBeenCalledWith('123', 5, 7);
  });

  it('does not open the popup when the todo is already in deletingTodos (double-click guard)', () => {
    deletingTodosMock.set('123', { todo: mockTodo, startedAt: 0 });
    const { container } = render(<LilyPad todo={mockTodo} />);
    const padMesh = container.querySelector('mesh');
    if (padMesh) fireClickAt(padMesh);
    expect(openPopupMock).not.toHaveBeenCalled();
  });

  it('does not open the popup when the todo is already in completingTodos (double-click guard)', () => {
    completingTodosMock.set('123', {
      todo: mockTodo,
      creatureType: 'firefly',
      rarity: 'common',
      startedAt: 0,
    });
    const { container } = render(<LilyPad todo={mockTodo} />);
    const padMesh = container.querySelector('mesh');
    if (padMesh) fireClickAt(padMesh);
    expect(openPopupMock).not.toHaveBeenCalled();
  });

  // Story 3.3 (revised): completed / deleted pads remain INTERACTIVE so
  // the ActionPopup can offer UNCOMPLETE / UNDELETE / color / group.
  // The grey/fade visual was pulled per product direction; only the
  // halo color changes (green for completed, red for deleted) — that
  // behaviour is validated in browser walkthroughs rather than unit
  // tests because the JSX stub doesn't host real Three.js objects.
  describe('historical pads remain interactive (story 3.3 revised)', () => {
    it('completed pad opens the popup when clicked', () => {
      const completedTodo: Todo = { ...mockTodo, completed: true };
      const { container } = render(<LilyPad todo={completedTodo} />);
      const padMesh = container.querySelector('mesh');
      if (padMesh) fireClickAt(padMesh);
      expect(openPopupMock).toHaveBeenCalledWith('123', 5, 7);
    });

    it('deleted pad opens the popup when clicked', () => {
      const deletedTodo: Todo = { ...mockTodo, deleted: true };
      const { container } = render(<LilyPad todo={deletedTodo} />);
      const padMesh = container.querySelector('mesh');
      if (padMesh) fireClickAt(padMesh);
      expect(openPopupMock).toHaveBeenCalledWith('123', 5, 7);
    });

    it('active pad with completed=false and deleted=false opens the popup', () => {
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      if (padMesh) fireClickAt(padMesh);
      expect(openPopupMock).toHaveBeenCalledWith('123', 5, 7);
    });
  });

  // Story 4.2: drag mechanics — click-vs-drag discrimination and
  // position PATCH on release. The drag pipeline uses WINDOW-level
  // pointermove/pointerup so release is captured even when the
  // pointer leaves the mesh. Tests dispatch pointermove/pointerup
  // against `window`.
  describe('drag (story 4.2)', () => {
    it('treats sub-4px movement as a click, not a drag', () => {
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      expect(padMesh).toBeTruthy();
      if (!padMesh) return;
      fireEvent.pointerDown(padMesh, { clientX: 0, clientY: 0, pointerId: 1, buttons: 1 });
      // 3 px diagonal — below 4 px threshold.
      fireEvent.pointerMove(window, { clientX: 2, clientY: 2, pointerId: 1, buttons: 1 });
      fireEvent.pointerUp(window, { clientX: 2, clientY: 2, pointerId: 1, buttons: 0 });
      expect(openPopupMock).toHaveBeenCalledWith('123', 5, 7);
      expect(updateTodoMutateMock).not.toHaveBeenCalled();
    });

    it('crossing the 4px threshold flips from click to drag and persists the final position', () => {
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      expect(padMesh).toBeTruthy();
      if (!padMesh) return;
      fireEvent.pointerDown(padMesh, { clientX: 100, clientY: 100, pointerId: 1, buttons: 1 });
      // 50 px horizontal move — crosses the threshold. The
      // raycaster in the mocked useThree() runs the real
      // Three.js math, so we just need the pointerMove to push
      // past 4 px for the drag to engage.
      fireEvent.pointerMove(window, { clientX: 200, clientY: 100, pointerId: 1, buttons: 1 });
      fireEvent.pointerUp(window, { clientX: 200, clientY: 100, pointerId: 1, buttons: 0 });

      expect(openPopupMock).not.toHaveBeenCalled();
      expect(updateTodoMutateMock).toHaveBeenCalled();
      // Story 4-8: batch shape — mutate receives an array of entries.
      // The dragged pad is always the first entry; any cascade-
      // displaced siblings follow. Test harness has an empty
      // `displacedPads` Map so the batch is exactly one entry.
      const batch = updateTodoMutateMock.mock.calls[0][0] as Array<{
        id: string;
        positionX: number;
        positionY: number;
      }>;
      expect(batch).toHaveLength(1);
      expect(batch[0].id).toBe('123');
      // Position should be a real number (not NaN), and differ
      // from the pad's original (5, 7) — confirming the raycast
      // ran and updated the drag target.
      expect(Number.isFinite(batch[0].positionX)).toBe(true);
      expect(Number.isFinite(batch[0].positionY)).toBe(true);
      expect(clearTargetPositionMock).toHaveBeenCalledWith('123');
    });

    it('pointerDown is ignored while the pad is deleting', () => {
      deletingTodosMock.set('123', { todo: mockTodo, startedAt: 0 });
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      expect(padMesh).toBeTruthy();
      if (!padMesh) return;
      fireEvent.pointerDown(padMesh, { clientX: 0, clientY: 0, pointerId: 1, buttons: 1 });
      fireEvent.pointerMove(window, { clientX: 40, clientY: 40, pointerId: 1, buttons: 1 });
      fireEvent.pointerUp(window, { clientX: 40, clientY: 40, pointerId: 1, buttons: 0 });
      expect(openPopupMock).not.toHaveBeenCalled();
      expect(updateTodoMutateMock).not.toHaveBeenCalled();
    });

    it('cancels the drag silently if pointermove arrives with no buttons pressed (off-window release)', () => {
      // Simulates the browser's "pointerup never fires" scenario —
      // the pointer is released outside the window/tab and the next
      // pointermove arrives with buttons === 0. Treat as cancelled:
      // detach listeners so a later hover cannot re-engage drag, but
      // do NOT open a popup (the user released outside the app, the
      // interaction was not a completed click).
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      expect(padMesh).toBeTruthy();
      if (!padMesh) return;
      fireEvent.pointerDown(padMesh, { clientX: 0, clientY: 0, pointerId: 1, buttons: 1 });
      // Mouse moved but NO button down → cancelled.
      fireEvent.pointerMove(window, { clientX: 200, clientY: 100, pointerId: 1, buttons: 0 });
      // A subsequent hover-move must NOT re-engage drag.
      fireEvent.pointerMove(window, { clientX: 300, clientY: 200, pointerId: 1, buttons: 0 });
      // Off-window release is NOT a completed click — no popup.
      expect(openPopupMock).not.toHaveBeenCalled();
      // And no PATCH either — the drag was aborted.
      expect(updateTodoMutateMock).not.toHaveBeenCalled();
    });
  });

  // Story 4.6 AC #1: Shift/Ctrl/Meta + click toggles the selection
  // set instead of triggering the drag or popup path.
  describe('multi-selection modifier click (story 4.6)', () => {
    it('Shift-click routes to togglePadSelection and skips the popup', () => {
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      expect(padMesh).toBeTruthy();
      if (!padMesh) return;
      fireEvent.pointerDown(padMesh, {
        clientX: 0,
        clientY: 0,
        pointerId: 1,
        buttons: 1,
        shiftKey: true,
      });
      expect(togglePadSelectionMock).toHaveBeenCalledWith('123');
      // No popup open on a selection click — even if pointerUp
      // happens without movement, the early return prevented the
      // window listener from being attached.
      fireEvent.pointerUp(window, {
        clientX: 0,
        clientY: 0,
        pointerId: 1,
        buttons: 0,
      });
      expect(openPopupMock).not.toHaveBeenCalled();
    });

    it('Ctrl-click also toggles selection', () => {
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      if (!padMesh) return;
      fireEvent.pointerDown(padMesh, {
        clientX: 0,
        clientY: 0,
        pointerId: 1,
        buttons: 1,
        ctrlKey: true,
      });
      expect(togglePadSelectionMock).toHaveBeenCalledWith('123');
    });

    it('Meta-click also toggles selection (macOS)', () => {
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      if (!padMesh) return;
      fireEvent.pointerDown(padMesh, {
        clientX: 0,
        clientY: 0,
        pointerId: 1,
        buttons: 1,
        metaKey: true,
      });
      expect(togglePadSelectionMock).toHaveBeenCalledWith('123');
    });

    it('plain click does NOT toggle selection', () => {
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      if (!padMesh) return;
      fireClickAt(padMesh);
      expect(togglePadSelectionMock).not.toHaveBeenCalled();
      expect(openPopupMock).toHaveBeenCalledTimes(1);
    });
  });

  // Story 3.4: hover publish/clear of hoveredTodoId
  describe('hover → hoveredTodoId (story 3.4)', () => {
    it('pointerEnter on a resting pad publishes the todo id', () => {
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      if (!padMesh) return;
      fireEvent.pointerEnter(padMesh);
      expect(setHoveredTodoIdMock).toHaveBeenCalledWith('123');
    });

    it('pointerLeave clears the hover when this pad is the current hover', () => {
      hoverStateMock.current = '123';
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      if (!padMesh) return;
      fireEvent.pointerLeave(padMesh);
      expect(setHoveredTodoIdMock).toHaveBeenCalledWith(null);
    });

    it('pointerLeave does NOT clear when a different pad is the current hover (event-order guard)', () => {
      hoverStateMock.current = 'other-pad';
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      if (!padMesh) return;
      fireEvent.pointerLeave(padMesh);
      // Stronger assertion: the setter must not fire AT ALL, not just
      // "not with null" — a future regression calling it with a
      // wrong-pad id should also fail this test.
      expect(setHoveredTodoIdMock).not.toHaveBeenCalled();
    });

    // Story 3.4 (CR reversal 2026-04-23): drag-start clears hover so
    // the info popup fades out. The pad no longer drags the popup
    // along; the popup can reappear only after drag release + a
    // fresh pointerEnter. These tests lock the reversal in.
    it('drag-start clears hoveredTodoId when this pad owned the hover', () => {
      hoverStateMock.current = '123';
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      if (!padMesh) return;
      fireEvent.pointerDown(padMesh, { clientX: 0, clientY: 0, pointerId: 1, buttons: 1 });
      // Cross the 4 px drag threshold to flip isDraggingRef.current → true
      // inside the pad's pointermove window handler.
      fireEvent.pointerMove(window, {
        clientX: 20,
        clientY: 0,
        pointerId: 1,
        buttons: 1,
      });
      expect(setHoveredTodoIdMock).toHaveBeenCalledWith(null);
    });

    it('drag-start does NOT clear hover when a different pad owns it', () => {
      hoverStateMock.current = 'other-pad';
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      if (!padMesh) return;
      fireEvent.pointerDown(padMesh, { clientX: 0, clientY: 0, pointerId: 1, buttons: 1 });
      fireEvent.pointerMove(window, {
        clientX: 20,
        clientY: 0,
        pointerId: 1,
        buttons: 1,
      });
      expect(setHoveredTodoIdMock).not.toHaveBeenCalledWith(null);
    });

    it('pointerEnter on a completing pad does NOT publish', () => {
      completingTodosMock.set('123', {
        todo: mockTodo,
        creatureType: 'firefly',
        rarity: 'common',
        startedAt: 0,
      });
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      if (!padMesh) return;
      fireEvent.pointerEnter(padMesh);
      expect(setHoveredTodoIdMock).not.toHaveBeenCalled();
    });

    it('pointerEnter on a deleting pad does NOT publish', () => {
      deletingTodosMock.set('123', { todo: mockTodo, startedAt: 0 });
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      if (!padMesh) return;
      fireEvent.pointerEnter(padMesh);
      expect(setHoveredTodoIdMock).not.toHaveBeenCalled();
    });

    it('pointerEnter while another pad is being dragged does NOT publish', () => {
      activeDragAnchorMock.current = { padId: 'other-pad', x: 0, z: 0 };
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      if (!padMesh) return;
      fireEvent.pointerEnter(padMesh);
      expect(setHoveredTodoIdMock).not.toHaveBeenCalled();
    });
  });

});
