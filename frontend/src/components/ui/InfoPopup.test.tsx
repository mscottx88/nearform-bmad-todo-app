import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InfoPopup } from './InfoPopup';
import type { Todo } from '../../types';

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

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

    it('embedding=complete hides the embedding row', () => {
      const { container } = render(
        <InfoPopup todo={makeTodo({ embeddingStatus: 'complete' })} focused={false} />,
      );
      expect(container.textContent).not.toMatch(/EMBEDDING/i);
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
});
