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
        onCommitColor={() => {}}
        onGroup={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /complete/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set color/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /group/i })).toBeInTheDocument();
  });

  // Story 3.3: label swap for historical pads.
  it('renders "Uncomplete" when todo.completed=true', () => {
    render(
      <ActionPopup
        todo={{ ...mockTodo, completed: true }}
        onComplete={() => {}}
        onDelete={() => {}}
        onCommitColor={() => {}}
        onGroup={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /uncomplete/i })).toBeInTheDocument();
    // "Delete" still reads as Delete when deleted=false.
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });

  it('renders "Undelete" when todo.deleted=true', () => {
    render(
      <ActionPopup
        todo={{ ...mockTodo, deleted: true }}
        onComplete={() => {}}
        onDelete={() => {}}
        onCommitColor={() => {}}
        onGroup={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /undelete/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^complete$/i })).toBeInTheDocument();
  });

  it('wires complete / delete / group to their handlers', () => {
    const onComplete = vi.fn();
    const onDelete = vi.fn();
    const onGroup = vi.fn();
    render(
      <ActionPopup
        todo={mockTodo}
        onComplete={onComplete}
        onDelete={onDelete}
        onCommitColor={() => {}}
        onGroup={onGroup}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /complete/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    fireEvent.click(screen.getByRole('button', { name: /group/i }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onGroup).toHaveBeenCalledTimes(1);
  });

  // ─── Story 4.1: swatch sub-panel toggle + commit + Escape ───
  describe('Set Color swatch sub-panel (story 4.1)', () => {
    it('click on Set Color opens the swatch sub-panel (AC #1)', () => {
      render(
        <ActionPopup
          todo={mockTodo}
          onComplete={() => {}}
          onDelete={() => {}}
          onCommitColor={() => {}}
          onGroup={() => {}}
        />,
      );
      // Panel is closed on mount — no swatches rendered.
      expect(
        screen.queryByLabelText(/^Set color to /),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /set color/i }));
      // Panel open — the locked palette renders.
      expect(
        screen.getAllByRole('button', { name: /^Set color to / }),
      ).toHaveLength(12);
    });

    it('click on Set Color a second time collapses the sub-panel (AC #4 toggle)', () => {
      render(
        <ActionPopup
          todo={mockTodo}
          onComplete={() => {}}
          onDelete={() => {}}
          onCommitColor={() => {}}
          onGroup={() => {}}
        />,
      );
      const setColorBtn = screen.getByRole('button', { name: /set color/i });
      fireEvent.click(setColorBtn);
      expect(
        screen.getAllByRole('button', { name: /^Set color to / }),
      ).toHaveLength(12);
      fireEvent.click(setColorBtn);
      expect(
        screen.queryByLabelText(/^Set color to /),
      ).not.toBeInTheDocument();
    });

    it('clicking a swatch fires onCommitColor with the hex and collapses (AC #3)', () => {
      const onCommitColor = vi.fn();
      render(
        <ActionPopup
          todo={mockTodo}
          onComplete={() => {}}
          onDelete={() => {}}
          onCommitColor={onCommitColor}
          onGroup={() => {}}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /set color/i }));
      fireEvent.click(screen.getByLabelText('Set color to neon green'));
      expect(onCommitColor).toHaveBeenCalledTimes(1);
      expect(onCommitColor).toHaveBeenCalledWith('#39ff14');
      // Panel collapses after commit.
      expect(
        screen.queryByLabelText(/^Set color to /),
      ).not.toBeInTheDocument();
    });

    it('Escape collapses the sub-panel WITHOUT firing onCommitColor (AC #4)', () => {
      const onCommitColor = vi.fn();
      render(
        <ActionPopup
          todo={mockTodo}
          onComplete={() => {}}
          onDelete={() => {}}
          onCommitColor={onCommitColor}
          onGroup={() => {}}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /set color/i }));
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(
        screen.queryByLabelText(/^Set color to /),
      ).not.toBeInTheDocument();
      expect(onCommitColor).not.toHaveBeenCalled();
    });

    it('hover on a swatch forwards the hex to onPreviewColor; unhover forwards null (AC #2)', () => {
      const onPreviewColor = vi.fn();
      render(
        <ActionPopup
          todo={mockTodo}
          onComplete={() => {}}
          onDelete={() => {}}
          onCommitColor={() => {}}
          onPreviewColor={onPreviewColor}
          onGroup={() => {}}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /set color/i }));
      // Initial effect fires onPreviewColor(null); reset the spy so
      // we assert only hover-driven calls below.
      onPreviewColor.mockClear();
      const swatch = screen.getByLabelText('Set color to neon magenta');
      fireEvent.mouseEnter(swatch);
      expect(onPreviewColor).toHaveBeenLastCalledWith('#ff00ff');
      fireEvent.mouseLeave(swatch);
      expect(onPreviewColor).toHaveBeenLastCalledWith(null);
    });
  });
});
