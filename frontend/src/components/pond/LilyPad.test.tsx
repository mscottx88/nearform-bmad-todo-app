import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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

vi.mock('../../stores/usePondStore', () => ({
  // Selector-aware stub: returns undefined for any hook selector call
  // (covers `s.completingTodos.get(id)` and `s.deletingTodos.get(id)` — the
  // only selectors this component uses). `getState()` exposes the shape the
  // component touches imperatively — `openPopup` + the two override maps
  // read by the handlePadClick double-click guard.
  usePondStore: Object.assign(() => undefined, {
    getState: () => ({
      openPopup: openPopupMock,
      completingTodos: completingTodosMock,
      deletingTodos: deletingTodosMock,
    }),
  }),
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
  it('renders without errors', () => {
    const { container } = render(<LilyPad todo={mockTodo} />);
    expect(container).toBeTruthy();
  });

  it('calls openPopup with todo id and pad position when clicked', () => {
    openPopupMock.mockClear();
    const { container } = render(<LilyPad todo={mockTodo} />);
    const padMesh = container.querySelector('mesh');
    expect(padMesh).toBeTruthy();
    if (padMesh) fireEvent.click(padMesh);
    expect(openPopupMock).toHaveBeenCalledWith('123', 5, 7);
  });
});
