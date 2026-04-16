import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ActionPopup } from './ActionPopup';
import type { Todo } from '../../types';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: () => ({
    camera: {
      position: { x: 0, y: 15, z: 20 },
      matrixWorldInverse: {},
      projectionMatrix: {},
    },
  }),
}));

vi.mock('@react-three/drei', () => ({
  Billboard: ({ children }: { children: React.ReactNode }) => <group>{children}</group>,
  Html: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => <div data-testid="line" />,
}));

vi.mock('../../stores/usePondStore', () => {
  const state = { cameraFocus: null, activePopupTodoId: null };
  return {
    usePondStore: Object.assign(
      <T,>(selector: (s: typeof state) => T) => selector(state),
      {
        getState: () => ({ ...state, closePopup: vi.fn() }),
        setState: (patch: Partial<typeof state>) => Object.assign(state, patch),
      },
    ),
  };
});

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
  it('renders four action button labels', () => {
    const { getByText } = render(
      <ActionPopup
        todo={mockTodo}
        onComplete={() => {}}
        onDelete={() => {}}
        onSetColor={() => {}}
        onGroup={() => {}}
      />,
    );
    expect(getByText('Complete')).toBeInTheDocument();
    expect(getByText('Delete')).toBeInTheDocument();
    expect(getByText('Set Color')).toBeInTheDocument();
    expect(getByText('Group')).toBeInTheDocument();
  });

  it('wires each button to its respective handler', () => {
    const onComplete = vi.fn();
    const onDelete = vi.fn();
    const onSetColor = vi.fn();
    const onGroup = vi.fn();
    const { getByText } = render(
      <ActionPopup
        todo={mockTodo}
        onComplete={onComplete}
        onDelete={onDelete}
        onSetColor={onSetColor}
        onGroup={onGroup}
      />,
    );

    // Each label lives inside a clickable group ancestor (PopupActionButton).
    // Walk up to the nearest <group> and click it.
    const clickButtonByLabel = (label: string) => {
      const span = getByText(label);
      let node: HTMLElement | null = span;
      while (node && node.tagName.toLowerCase() !== 'group') {
        node = node.parentElement;
      }
      if (node) fireEvent.click(node);
    };

    clickButtonByLabel('Complete');
    clickButtonByLabel('Delete');
    clickButtonByLabel('Set Color');
    clickButtonByLabel('Group');

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onSetColor).toHaveBeenCalledTimes(1);
    expect(onGroup).toHaveBeenCalledTimes(1);
  });

  it('mounts without error when closing is true', () => {
    const { getByText } = render(
      <ActionPopup
        todo={mockTodo}
        closing
        onComplete={() => {}}
        onDelete={() => {}}
        onSetColor={() => {}}
        onGroup={() => {}}
      />,
    );
    expect(getByText('Complete')).toBeInTheDocument();
  });
});
