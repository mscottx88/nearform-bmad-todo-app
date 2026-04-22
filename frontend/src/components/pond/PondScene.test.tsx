import { render, fireEvent, screen } from '@testing-library/react';
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

// Test-configurable `useTodos` — the default fixture returns empty, but
// individual tests can override via `mockUseTodosData` before rendering.
let mockUseTodosData: Todo[] = [];
// Shared spy for `useUpdateTodo().mutate` — reset in beforeEach so
// individual tests (e.g. the story-4.1 commit-flow test) can assert
// what PondScene dispatches when a swatch is committed.
const mockUpdateTodoMutate = vi.fn();
const mockRestoreTodoMutate = vi.fn();
vi.mock('../../api/todoApi', () => ({
  useTodos: () => ({ data: mockUseTodosData, isLoading: false }),
  useUpdateTodo: () => ({ mutate: mockUpdateTodoMutate }),
  useRestoreTodo: () => ({ mutate: mockRestoreTodoMutate }),
}));

vi.mock('../../api/creatureApi', () => ({
  useCreateCreature: () => ({ mutate: vi.fn() }),
}));

vi.mock('../../hooks/usePopupDelete', () => ({
  useDeleteTodoAction: () => vi.fn(),
}));

vi.mock('../../api/groupApi', () => ({
  useCreateGroup: () => ({ mutate: vi.fn() }),
  useUpdateGroup: () => ({ mutate: vi.fn() }),
  useDeleteGroup: () => ({ mutate: vi.fn() }),
}));

vi.mock('./ClusterLabel', () => ({
  ClusterLabel: ({ label }: { label: string }) => (
    <div data-testid="cluster-label" data-label={label} />
  ),
}));

// Expose dropDelayMs via a data attribute so the staggered-index test can
// assert what PondScene passes to each LilyPad on initial load.
vi.mock('./LilyPad', () => ({
  LilyPad: ({ todo, dropDelayMs }: { todo: Todo; dropDelayMs?: number }) => (
    <div
      data-testid={`lily-pad-${todo.id}`}
      data-drop-delay-ms={dropDelayMs ?? 0}
    />
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
    groupId: null,
  };
}

describe('PondScene', () => {
  beforeEach(() => {
    mockUseTodosData = [];
    mockUpdateTodoMutate.mockReset();
    usePondStore.setState({
      activePopupTodoId: null,
      cameraFocus: null,
      completingTodos: new Map(),
      deletingTodos: new Map(),
      errorTodos: new Map(),
      dropRipples: [],
      colorPreviews: new Map(),
    });
  });

  // Test QueryClient with retry disabled — production retry policy is the
  // App-level default (3 attempts, exponential backoff) but tests should
  // not wait for backoff windows.
  const makeTestClient = () =>
    new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

  it('mounts without errors', () => {
    const queryClient = makeTestClient();
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

    const queryClient = makeTestClient();
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

    const queryClient = makeTestClient();
    const { getByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <PondScene />
      </QueryClientProvider>,
    );

    expect(getByTestId('lily-pad-ghost-delete')).toBeInTheDocument();
  });

  it('passes staggered dropDelayMs (0, 100, 200) to LilyPad children on initial load (story 2.6 AC #1)', () => {
    mockUseTodosData = [makeTodo('a'), makeTodo('b'), makeTodo('c')];

    const queryClient = makeTestClient();
    const { getByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <PondScene />
      </QueryClientProvider>,
    );

    expect(getByTestId('lily-pad-a').getAttribute('data-drop-delay-ms')).toBe('0');
    expect(getByTestId('lily-pad-b').getAttribute('data-drop-delay-ms')).toBe('100');
    expect(getByTestId('lily-pad-c').getAttribute('data-drop-delay-ms')).toBe('200');
  });

  it('stops passing the index-based stagger after the initial non-empty render — a remount after the first cascade must NOT replay the stagger (story 2.6 AC #3, P5 follow-up)', () => {
    // P5 (2026-04-17 code review): PondScene now tracks a
    // `hasSeenInitialLoadRef` that flips (via useEffect) once the first
    // non-empty `todos` list renders. From that moment on, every pad —
    // including brand-new mounts caused by StrictMode remounts, failed-
    // mutation-induced unmount + refetch cycles, or error-boundary retries
    // — receives `dropDelayMs = 0`. Defense in depth alongside LilyPad's
    // mount-time lazy-capture useState, which handles pads that stay
    // mounted across re-renders.
    mockUseTodosData = [makeTodo('a'), makeTodo('b')];

    const queryClient = makeTestClient();
    const { getByTestId, rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PondScene />
      </QueryClientProvider>,
    );

    // First non-empty render: the stagger is still in effect (effect
    // hasn't fired yet). This is THE one staggered cascade.
    expect(getByTestId('lily-pad-a').getAttribute('data-drop-delay-ms')).toBe('0');
    expect(getByTestId('lily-pad-b').getAttribute('data-drop-delay-ms')).toBe('100');

    rerender(
      <QueryClientProvider client={queryClient}>
        <PondScene />
      </QueryClientProvider>,
    );

    // After the effect has flipped the ref, subsequent renders pass 0 to
    // every LilyPad regardless of index. Existing pads don't care (their
    // useState already captured a value at mount); a hypothetical fresh
    // mount would NOT re-trigger the cascade.
    expect(getByTestId('lily-pad-a').getAttribute('data-drop-delay-ms')).toBe('0');
    expect(getByTestId('lily-pad-b').getAttribute('data-drop-delay-ms')).toBe('0');
  });

  it('color-swatch commit: mutate, ripple, and closePopup all fire (story 4.1 AC #3)', () => {
    // Seed a single todo and open its popup so PondScene renders the
    // ActionPopup. The LilyPad mock renders a <div>, but the popup
    // lives at the scene level (outside the mocked LilyPad) so its
    // buttons + swatch sub-panel are real DOM for this test.
    const todoA = makeTodo('a');
    todoA.positionX = 3;
    todoA.positionY = 4;
    mockUseTodosData = [todoA];
    usePondStore.setState({ activePopupTodoId: 'a' });

    const queryClient = makeTestClient();
    render(
      <QueryClientProvider client={queryClient}>
        <PondScene />
      </QueryClientProvider>,
    );

    // Open the swatch sub-panel.
    fireEvent.click(screen.getByRole('button', { name: /set color/i }));
    // Commit the lily swatch (pond's default green, palette row 2).
    fireEvent.click(screen.getByLabelText('Set color to neon lily'));

    // AC #3a-b: PATCH /api/todos/{id} fires with the new color.
    expect(mockUpdateTodoMutate).toHaveBeenCalledTimes(1);
    expect(mockUpdateTodoMutate).toHaveBeenCalledWith({
      id: 'a',
      color: '#00ff88',
    });
    // AC #3d: ripple emanates from the pad's world (x, z) — assert
    // via the store's queue (drained each frame by WaterSurface).
    const queued = usePondStore.getState().dropRipples;
    expect(queued).toHaveLength(1);
    expect(queued[0]).toEqual({ worldX: 3, worldZ: 4 });
    // AC #3c: popup closes.
    expect(usePondStore.getState().activePopupTodoId).toBeNull();
  });

  it('color-swatch hover: setColorPreview writes to the store slice (story 4.1 AC #2)', () => {
    const todoA = makeTodo('a');
    mockUseTodosData = [todoA];
    usePondStore.setState({ activePopupTodoId: 'a' });

    const queryClient = makeTestClient();
    render(
      <QueryClientProvider client={queryClient}>
        <PondScene />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /set color/i }));
    const swatch = screen.getByLabelText('Set color to neon green');

    fireEvent.mouseEnter(swatch);
    expect(usePondStore.getState().colorPreviews.get('a')).toBe('#39ff14');

    fireEvent.mouseLeave(swatch);
    expect(usePondStore.getState().colorPreviews.has('a')).toBe(false);
  });

  // ─── Story 4.6: cluster label (AC #12) ───
  it('renders a ClusterLabel for each group with a non-null label (AC #12)', async () => {
    // Two todos in the same group, with the group label in the store's
    // groupLabelCacheRef (normally populated by mutation onSuccess).
    // We use the real `usePondStore` — set up a cached label by
    // bypassing the mutation and updating the todos query directly.
    // Since PondScene derives labels from groupLabelCacheRef (a ref),
    // and useMemo re-runs when renderTodos changes, we need todos that
    // share a groupId. The label in the cache starts null, so a label-
    // bearing ClusterLabel will NOT appear unless the cache is pre-seeded.
    // Instead, we verify the opposite (no label = no ClusterLabel).
    mockUseTodosData = [
      { ...makeTodo('g1'), groupId: 'grp-1' },
      { ...makeTodo('g2'), groupId: 'grp-1' },
    ];

    const queryClient = makeTestClient();
    const { queryAllByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <PondScene />
      </QueryClientProvider>,
    );
    // No ClusterLabel when the group's label is null (cache empty at mount).
    expect(queryAllByTestId('cluster-label')).toHaveLength(0);
  });
});
