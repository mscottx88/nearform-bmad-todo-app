import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PondScene } from './PondScene';
import { usePondStore } from '../../stores/usePondStore';
import type { Todo } from '../../types';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
  useFrame: vi.fn(),
  useThree: () => ({
    camera: {
      position: { set: vi.fn(), x: 0, y: 15, z: 20, clone: () => ({ sub: () => ({ normalize: () => ({ multiplyScalar: () => ({}) }) }) }), distanceTo: () => 25, copy: vi.fn(), add: vi.fn() },
      lookAt: vi.fn(),
    },
    gl: { domElement: document.createElement('canvas') },
  }),
}));

vi.mock('@react-three/postprocessing', () => ({
  EffectComposer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Bloom: () => null,
}));

vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
  Html: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../api/todoApi', () => ({
  useTodos: () => ({ data: [], isLoading: false }),
  useUpdateTodo: () => ({ mutate: vi.fn() }),
}));

vi.mock('../../api/creatureApi', () => ({
  useCreateCreature: () => ({ mutate: vi.fn() }),
}));

vi.mock('../../hooks/usePopupDelete', () => ({
  useDeleteTodoAction: () => vi.fn(),
}));

vi.mock('./LilyPad', () => ({
  LilyPad: ({ todo }: { todo: Todo }) => (
    <div data-testid={`lily-pad-${todo.id}`} />
  ),
}));

function makeTodo(id: string): Todo {
  return {
    id,
    text: 'test',
    completed: false,
    color: '#00eeff',
    positionX: 0,
    positionY: 0,
    embeddingStatus: 'pending',
    archived: false,
    archivedAt: null,
    deleted: false,
    deletedAt: null,
    createdAt: '2026-04-16T00:00:00Z',
    updatedAt: '2026-04-16T00:00:00Z',
  };
}

describe('PondScene', () => {
  beforeEach(() => {
    usePondStore.setState({
      activePopupTodoId: null,
      cameraFocus: null,
      completingTodos: new Map(),
      deletingTodos: new Map(),
    });
  });

  it('mounts without errors', () => {
    const queryClient = new QueryClient();
    const { getByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <PondScene />
      </QueryClientProvider>,
    );
    expect(getByTestId('r3f-canvas')).toBeInTheDocument();
  });

  it('renders a LilyPad for a todo that exists only in completingTodos (AC #7 override)', () => {
    const ghost = makeTodo('ghost-todo');
    usePondStore.getState().startCompletion(ghost, 'firefly', 'common');

    const queryClient = new QueryClient();
    const { getByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <PondScene />
      </QueryClientProvider>,
    );

    expect(getByTestId('lily-pad-ghost-todo')).toBeInTheDocument();
  });

  it('renders a LilyPad for a todo that exists only in deletingTodos (story 2.5 override)', () => {
    const ghost = makeTodo('ghost-delete');
    usePondStore.getState().startDeletion(ghost);

    const queryClient = new QueryClient();
    const { getByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <PondScene />
      </QueryClientProvider>,
    );

    expect(getByTestId('lily-pad-ghost-delete')).toBeInTheDocument();
  });
});
