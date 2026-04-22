import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LilyPad } from './LilyPad';
import type { Todo } from '../../types';

const openPopupMock = vi.fn();

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const completingTodosMock = new Map<string, unknown>();
const deletingTodosMock = new Map<string, unknown>();
const triggerRippleMock = vi.fn();
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
      // Story 5.3: LilyPad reads these imperatively inside useFrame to
      // decide its per-pad search mode. Inactive defaults keep this
      // test running against the pre-search rendering path.
      searchActive: false,
      searchAllMatches: false,
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
}));

const mockTodo: Todo = {
  id: '123',
  text: 'Test todo',
  completed: false,
  color: '#00eeff',
  positionX: 5,
  positionY: 7,
  embeddingStatus: 'pending',
  archived: false,
  archivedAt: null,
  deleted: false,
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('LilyPad', () => {
  beforeEach(() => {
    openPopupMock.mockClear();
    completingTodosMock.clear();
    deletingTodosMock.clear();
  });

  it('renders without errors', () => {
    const { container } = render(<LilyPad todo={mockTodo} />);
    expect(container).toBeTruthy();
  });

  it('calls openPopup with todo id and pad position when clicked', () => {
    const { container } = render(<LilyPad todo={mockTodo} />);
    const padMesh = container.querySelector('mesh');
    expect(padMesh).toBeTruthy();
    if (padMesh) fireEvent.click(padMesh);
    expect(openPopupMock).toHaveBeenCalledWith('123', 5, 7);
  });

  it('does not open the popup when the todo is already in deletingTodos (double-click guard)', () => {
    deletingTodosMock.set('123', { todo: mockTodo, startedAt: 0 });
    const { container } = render(<LilyPad todo={mockTodo} />);
    const padMesh = container.querySelector('mesh');
    if (padMesh) fireEvent.click(padMesh);
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
    if (padMesh) fireEvent.click(padMesh);
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
      if (padMesh) fireEvent.click(padMesh);
      expect(openPopupMock).toHaveBeenCalledWith('123', 5, 7);
    });

    it('deleted pad opens the popup when clicked', () => {
      const deletedTodo: Todo = { ...mockTodo, deleted: true };
      const { container } = render(<LilyPad todo={deletedTodo} />);
      const padMesh = container.querySelector('mesh');
      if (padMesh) fireEvent.click(padMesh);
      expect(openPopupMock).toHaveBeenCalledWith('123', 5, 7);
    });

    it('active pad with completed=false and deleted=false opens the popup', () => {
      const { container } = render(<LilyPad todo={mockTodo} />);
      const padMesh = container.querySelector('mesh');
      if (padMesh) fireEvent.click(padMesh);
      expect(openPopupMock).toHaveBeenCalledWith('123', 5, 7);
    });
  });
});
