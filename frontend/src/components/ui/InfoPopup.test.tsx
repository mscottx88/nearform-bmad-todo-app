import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Story 6.3: InfoPopup uses `useUpdateTodo` for the due-date picker.
// The test environment has no React Query client, so mock the hook to
// keep this file's render scope tight.
vi.mock('../../api/todoApi', () => ({
  useUpdateTodo: () => ({ mutate: vi.fn() }),
}));

import { InfoPopup } from './InfoPopup';
import type { Todo } from '../../types';

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 'todo-1',
    text: 'Hello pond',
    completed: false,
    color: '#00eeff',
    positionX: 1.23,
    positionY: 4.56,
    rotationY: 0,
    driftSeed: 0,
    dueDate: null,
    embeddingStatus: 'complete',
    archived: false,
    archivedAt: null,
    deleted: false,
    deletedAt: null,
    createdAt: '2026-04-16T12:00:00Z',
    updatedAt: '2026-04-16T12:00:00Z',
    ...overrides,
  };
}

describe('InfoPopup', () => {
  describe('hover mode (focused=false)', () => {
    it('renders the full todo text', () => {
      render(<InfoPopup todo={makeTodo({ text: 'A very informative note' })} focused={false} />);
      expect(screen.getByText('A very informative note')).toBeInTheDocument();
    });

    it('renders a Created row with a formatted timestamp', () => {
      const { container } = render(<InfoPopup todo={makeTodo()} focused={false} />);
      expect(container.textContent).toMatch(/CREATED/i);
      // Year from the fixture timestamp should appear in the formatted value.
      expect(container.textContent).toMatch(/2026/);
    });

    it('renders ACTIVE status badge for a pristine todo', () => {
      render(<InfoPopup todo={makeTodo()} focused={false} />);
      expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    });

    it('applies the hover-mode class (pointer-events: none)', () => {
      const { container } = render(<InfoPopup todo={makeTodo()} focused={false} />);
      const panel = container.querySelector('.info-popup__panel');
      expect(panel).not.toBeNull();
      expect(panel?.className).toContain('info-popup__panel--hover');
    });

    it('uses role="tooltip" in hover mode', () => {
      const { container } = render(<InfoPopup todo={makeTodo()} focused={false} />);
      const panel = container.querySelector('.info-popup__panel');
      expect(panel?.getAttribute('role')).toBe('tooltip');
    });
  });

  describe('focused mode (focused=true)', () => {
    it('applies the focused class', () => {
      const { container } = render(<InfoPopup todo={makeTodo()} focused={true} />);
      const panel = container.querySelector('.info-popup__panel');
      expect(panel?.className).toContain('info-popup__panel--focused');
    });

    it('uses role="dialog" in focused mode', () => {
      const { container } = render(<InfoPopup todo={makeTodo()} focused={true} />);
      const panel = container.querySelector('.info-popup__panel');
      expect(panel?.getAttribute('role')).toBe('dialog');
    });

    it('pointerDown on the panel calls stopPropagation (does not bubble)', () => {
      const outerPointerDown = vi.fn();
      const { container } = render(
        <div onPointerDown={outerPointerDown}>
          <InfoPopup todo={makeTodo()} focused={true} />
        </div>,
      );
      const panel = container.querySelector('.info-popup__panel');
      expect(panel).not.toBeNull();
      if (panel) fireEvent.pointerDown(panel);
      expect(outerPointerDown).not.toHaveBeenCalled();
    });
  });

  describe('meta-row combinations', () => {
    it('completed todo renders COMPLETED badge', () => {
      render(<InfoPopup todo={makeTodo({ completed: true })} focused={false} />);
      expect(screen.getByText('COMPLETED')).toBeInTheDocument();
      expect(screen.queryByText('ACTIVE')).toBeNull();
    });

    it('deleted-only todo renders DELETED badge', () => {
      render(<InfoPopup todo={makeTodo({ deleted: true })} focused={false} />);
      expect(screen.getByText('DELETED')).toBeInTheDocument();
      expect(screen.queryByText('ACTIVE')).toBeNull();
    });

    it('completed + archived todo renders both badges', () => {
      render(<InfoPopup todo={makeTodo({ completed: true, archived: true })} focused={false} />);
      expect(screen.getByText('COMPLETED')).toBeInTheDocument();
      expect(screen.getByText('ARCHIVED')).toBeInTheDocument();
    });

    it('embedding=pending shows the embedding row with "pending"', () => {
      const { container } = render(
        <InfoPopup todo={makeTodo({ embeddingStatus: 'pending' })} focused={false} />,
      );
      expect(container.textContent).toMatch(/EMBEDDING/i);
      expect(container.textContent).toMatch(/pending/i);
    });

    it('embedding=complete shows the embedding row with "COMPLETE"', () => {
      const { container } = render(
        <InfoPopup todo={makeTodo({ embeddingStatus: 'complete' })} focused={false} />,
      );
      expect(container.textContent).toMatch(/EMBEDDING/i);
      expect(container.textContent).toMatch(/COMPLETE/i);
    });

    it('updatedAt === createdAt hides the Updated row', () => {
      const { container } = render(<InfoPopup todo={makeTodo()} focused={false} />);
      expect(container.textContent).not.toMatch(/UPDATED/i);
    });

    it('updatedAt !== createdAt shows the Updated row', () => {
      const { container } = render(
        <InfoPopup
          todo={makeTodo({ updatedAt: '2026-04-20T00:00:00Z' })}
          focused={false}
        />,
      );
      expect(container.textContent).toMatch(/UPDATED/i);
    });

    it('Position row renders (x, z) rounded to 2 decimals', () => {
      const { container } = render(
        <InfoPopup todo={makeTodo({ positionX: 1.234, positionY: 5.678 })} focused={false} />,
      );
      expect(container.textContent).toMatch(/\(1\.23, 5\.68\)/);
    });
  });

  describe('merged actions (focused mode)', () => {
    it('renders Complete / Delete / Set Color buttons when focused with callbacks', () => {
      render(
        <InfoPopup
          todo={makeTodo()}
          focused={true}
          onComplete={() => {}}
          onDelete={() => {}}
          onCommitColor={() => {}}
        />,
      );
      expect(screen.getByRole('button', { name: /^complete$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /set color/i })).toBeInTheDocument();
    });

    it('swaps labels to Uncomplete / Undelete for completed/deleted todos', () => {
      render(
        <InfoPopup
          todo={makeTodo({ completed: true, deleted: true })}
          focused={true}
          onComplete={() => {}}
          onDelete={() => {}}
        />,
      );
      expect(screen.getByRole('button', { name: /uncomplete/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /undelete/i })).toBeInTheDocument();
    });

    it('does NOT render action buttons in hover mode', () => {
      render(
        <InfoPopup
          todo={makeTodo()}
          focused={false}
          onComplete={() => {}}
          onDelete={() => {}}
          onCommitColor={() => {}}
        />,
      );
      expect(screen.queryByRole('button', { name: /^complete$/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /set color/i })).toBeNull();
    });

    it('Complete click calls onComplete', () => {
      const onComplete = vi.fn();
      render(<InfoPopup todo={makeTodo()} focused={true} onComplete={onComplete} />);
      fireEvent.click(screen.getByRole('button', { name: /^complete$/i }));
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('Set Color toggle opens the swatch sub-panel', () => {
      const { container } = render(
        <InfoPopup todo={makeTodo()} focused={true} onCommitColor={() => {}} />,
      );
      // Swatch panel not visible initially.
      expect(container.querySelector('.action-popup__color-swatches')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /set color/i }));
      expect(container.querySelector('.action-popup__color-swatches')).not.toBeNull();
    });
  });

  describe('edit mode', () => {
    it('clicking the todo text in focused mode switches to a textarea', () => {
      const { container } = render(
        <InfoPopup todo={makeTodo({ text: 'orig' })} focused={true} onCommitText={() => {}} />,
      );
      const textDiv = container.querySelector('.info-popup__text--clickable');
      expect(textDiv).not.toBeNull();
      if (textDiv) fireEvent.click(textDiv);
      expect(container.querySelector('textarea.info-popup__editor-textarea')).not.toBeNull();
    });

    it('text is NOT clickable when onCommitText is omitted', () => {
      const { container } = render(<InfoPopup todo={makeTodo()} focused={true} />);
      expect(container.querySelector('.info-popup__text--clickable')).toBeNull();
    });

    it('text is NOT clickable in hover mode even if onCommitText given', () => {
      const { container } = render(
        <InfoPopup todo={makeTodo()} focused={false} onCommitText={() => {}} />,
      );
      expect(container.querySelector('.info-popup__text--clickable')).toBeNull();
    });

    it('Enter commits trimmed text via onCommitText and exits edit mode', () => {
      const onCommitText = vi.fn();
      const { container } = render(
        <InfoPopup todo={makeTodo({ text: 'orig' })} focused={true} onCommitText={onCommitText} />,
      );
      fireEvent.click(container.querySelector('.info-popup__text--clickable')!);
      const textarea = container.querySelector<HTMLTextAreaElement>('textarea.info-popup__editor-textarea');
      expect(textarea).not.toBeNull();
      if (!textarea) return;
      fireEvent.change(textarea, { target: { value: '  new value  ' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(onCommitText).toHaveBeenCalledWith('new value');
      expect(container.querySelector('textarea.info-popup__editor-textarea')).toBeNull();
    });

    it('Enter is a no-op when the trimmed text matches the current value', () => {
      const onCommitText = vi.fn();
      const { container } = render(
        <InfoPopup todo={makeTodo({ text: 'same' })} focused={true} onCommitText={onCommitText} />,
      );
      fireEvent.click(container.querySelector('.info-popup__text--clickable')!);
      const textarea = container.querySelector<HTMLTextAreaElement>('textarea.info-popup__editor-textarea')!;
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(onCommitText).not.toHaveBeenCalled();
    });

    it('Escape discards changes and exits edit mode', () => {
      const onCommitText = vi.fn();
      const { container } = render(
        <InfoPopup todo={makeTodo({ text: 'orig' })} focused={true} onCommitText={onCommitText} />,
      );
      fireEvent.click(container.querySelector('.info-popup__text--clickable')!);
      const textarea = container.querySelector<HTMLTextAreaElement>('textarea.info-popup__editor-textarea')!;
      fireEvent.change(textarea, { target: { value: 'changed' } });
      fireEvent.keyDown(textarea, { key: 'Escape' });
      expect(onCommitText).not.toHaveBeenCalled();
      expect(container.querySelector('textarea.info-popup__editor-textarea')).toBeNull();
    });

    it('Ctrl+Enter inserts a newline at the cursor, not commit', () => {
      const onCommitText = vi.fn();
      const { container } = render(
        <InfoPopup todo={makeTodo({ text: 'abc' })} focused={true} onCommitText={onCommitText} />,
      );
      fireEvent.click(container.querySelector('.info-popup__text--clickable')!);
      const textarea = container.querySelector<HTMLTextAreaElement>('textarea.info-popup__editor-textarea')!;
      // Place caret at end.
      textarea.selectionStart = textarea.value.length;
      textarea.selectionEnd = textarea.value.length;
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      expect(onCommitText).not.toHaveBeenCalled();
      // Still in edit mode, value appended with a newline.
      expect(container.querySelector('textarea.info-popup__editor-textarea')).not.toBeNull();
      expect(
        (container.querySelector<HTMLTextAreaElement>('textarea.info-popup__editor-textarea')!).value,
      ).toBe('abc\n');
    });

    it('does NOT render Save or Cancel buttons in edit mode', () => {
      const { container } = render(
        <InfoPopup todo={makeTodo()} focused={true} onCommitText={() => {}} />,
      );
      fireEvent.click(container.querySelector('.info-popup__text--clickable')!);
      expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /^cancel$/i })).toBeNull();
    });

    it('hides action buttons (Complete/Delete/Set Color) while editing', () => {
      const { container } = render(
        <InfoPopup
          todo={makeTodo()}
          focused={true}
          onComplete={() => {}}
          onDelete={() => {}}
          onCommitColor={() => {}}
          onCommitText={() => {}}
        />,
      );
      fireEvent.click(container.querySelector('.info-popup__text--clickable')!);
      expect(screen.queryByRole('button', { name: /^complete$/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /set color/i })).toBeNull();
    });

    it('edit mode renders a neon resize handle beneath the textarea', () => {
      const { container } = render(
        <InfoPopup todo={makeTodo()} focused={true} onCommitText={() => {}} />,
      );
      fireEvent.click(container.querySelector('.info-popup__text--clickable')!);
      expect(container.querySelector('.info-popup__editor-resize')).not.toBeNull();
    });

    it('losing focus exits edit mode (draft discarded)', () => {
      const onCommitText = vi.fn();
      const { container, rerender } = render(
        <InfoPopup todo={makeTodo()} focused={true} onCommitText={onCommitText} />,
      );
      fireEvent.click(container.querySelector('.info-popup__text--clickable')!);
      expect(container.querySelector('textarea.info-popup__editor-textarea')).not.toBeNull();
      // Flip focused → false (popup closed / another pad focused).
      rerender(<InfoPopup todo={makeTodo()} focused={false} onCommitText={onCommitText} />);
      expect(container.querySelector('textarea.info-popup__editor-textarea')).toBeNull();
      expect(onCommitText).not.toHaveBeenCalled();
    });
  });
});
