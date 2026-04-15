import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LilyPad } from './LilyPad';
import type { Todo } from '../../types';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockTodo: Todo = {
  id: '123',
  text: 'Test todo',
  completed: false,
  color: '#00eeff',
  positionX: 0,
  positionY: 0,
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
});
