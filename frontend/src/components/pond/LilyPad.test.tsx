import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LilyPad } from './LilyPad';
import type { Todo } from '../../types';

const openPopupMock = vi.fn();
const focusCameraMock = vi.fn();

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../api/todoApi', () => ({
  useUpdateTodo: () => ({ mutate: vi.fn() }),
}));

vi.mock('../../stores/usePondStore', () => ({
  usePondStore: Object.assign(() => 1.0, {
    getState: () => ({
      focusCamera: focusCameraMock,
      openPopup: openPopupMock,
    }),
  }),
}));

vi.mock('../../api/creatureApi', () => ({
  useCreateCreature: () => ({ mutate: vi.fn() }),
  useDeleteCreature: () => ({ mutate: vi.fn() }),
}));

vi.mock('../creatures/CompletionEgg', () => ({
  CompletionEgg: () => null,
}));

vi.mock('../creatures/creatures/Firefly', () => ({
  Firefly: () => null,
}));

vi.mock('../creatures/creatures/WaterStrider', () => ({
  WaterStrider: () => null,
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
