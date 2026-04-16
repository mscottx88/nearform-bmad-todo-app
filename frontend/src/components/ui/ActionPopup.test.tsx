import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ActionPopup } from './ActionPopup';
import type { Todo } from '../../types';

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockTodo: Todo = {
  id: 'todo-1',
  text: 'Test',
  completed: false,
  color: '#00eeff',
  positionX: 2,
  positionY: 3,
  embeddingStatus: 'pending',
  archived: false,
  archivedAt: null,
  deleted: false,
  deletedAt: null,
  createdAt: '2026-04-16T00:00:00Z',
  updatedAt: '2026-04-16T00:00:00Z',
};

describe('ActionPopup', () => {
  it('renders four action buttons', () => {
    render(
      <ActionPopup
        todo={mockTodo}
        onComplete={() => {}}
        onDelete={() => {}}
        onSetColor={() => {}}
        onGroup={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /complete/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set color/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /group/i })).toBeInTheDocument();
  });

  it('wires each button to its handler', () => {
    const onComplete = vi.fn();
    const onDelete = vi.fn();
    const onSetColor = vi.fn();
    const onGroup = vi.fn();
    render(
      <ActionPopup
        todo={mockTodo}
        onComplete={onComplete}
        onDelete={onDelete}
        onSetColor={onSetColor}
        onGroup={onGroup}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /complete/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    fireEvent.click(screen.getByRole('button', { name: /set color/i }));
    fireEvent.click(screen.getByRole('button', { name: /group/i }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onSetColor).toHaveBeenCalledTimes(1);
    expect(onGroup).toHaveBeenCalledTimes(1);
  });
});
