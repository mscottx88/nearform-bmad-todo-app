import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { useCameraResetOnDoubleEscape } from './useCameraResetOnDoubleEscape';
import { usePondStore } from '../stores/usePondStore';
import { fitCameraToPads } from '../components/pond/fitCameraToPads';
import { todosQueryKey } from '../api/todoApi';
import type { Todo } from '../types';

function dispatchEscape(target?: EventTarget): void {
  const event = new KeyboardEvent('keydown', { key: 'Escape' });
  if (target) {
    Object.defineProperty(event, 'target', { value: target, writable: false });
  }
  window.dispatchEvent(event);
}

function makeTodo(overrides: Partial<Todo> & Pick<Todo, 'id'>): Todo {
  return {
    id: overrides.id,
    text: overrides.text ?? 'test',
    completed: overrides.completed ?? false,
    color: overrides.color ?? '#00eeff',
    positionX: overrides.positionX ?? null,
    positionY: overrides.positionY ?? null,
    embeddingStatus: overrides.embeddingStatus ?? 'complete',
    archived: overrides.archived ?? false,
    archivedAt: overrides.archivedAt ?? null,
    deleted: overrides.deleted ?? false,
    deletedAt: overrides.deletedAt ?? null,
    createdAt: overrides.createdAt ?? '2026-04-22T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-04-22T00:00:00Z',
  };
}

function renderWithClient(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useCameraResetOnDoubleEscape(), { wrapper });
}

describe('useCameraResetOnDoubleEscape', () => {
  let nowSpy: ReturnType<typeof vi.spyOn>;
  let mockNow = 0;

  beforeEach(() => {
    usePondStore.setState({ cameraResetRequestId: 0, pendingCameraFit: null });
    mockNow = 0;
    nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('single Escape does not trigger a reset', () => {
    const client = new QueryClient();
    const { unmount } = renderWithClient(client);
    mockNow = 100;
    dispatchEscape();
    expect(usePondStore.getState().cameraResetRequestId).toBe(0);
    expect(usePondStore.getState().pendingCameraFit).toBeNull();
    unmount();
  });

  it('double Escape within 600ms dispatches reset with computed fit', () => {
    const client = new QueryClient();
    const todos: Todo[] = [
      makeTodo({ id: 'a', positionX: 10, positionY: 10 }),
      makeTodo({ id: 'b', positionX: 12, positionY: 12 }),
    ];
    client.setQueryData(['todos', 'list'], todos);
    const { unmount } = renderWithClient(client);

    mockNow = 100;
    dispatchEscape();
    mockNow = 400; // 300ms later, well within the window
    dispatchEscape();

    expect(usePondStore.getState().cameraResetRequestId).toBe(1);
    const expected = fitCameraToPads(todos);
    expect(usePondStore.getState().pendingCameraFit).toEqual(expected);
    unmount();
  });

  it('two Escapes > 600ms apart do NOT trigger reset', () => {
    const client = new QueryClient();
    const { unmount } = renderWithClient(client);

    mockNow = 100;
    dispatchEscape();
    mockNow = 800; // 700ms later — window expired
    dispatchEscape();

    expect(usePondStore.getState().cameraResetRequestId).toBe(0);
    expect(usePondStore.getState().pendingCameraFit).toBeNull();
    unmount();
  });

  it('Escape originating from an input is ignored', () => {
    const client = new QueryClient();
    const { unmount } = renderWithClient(client);

    const input = document.createElement('input');
    document.body.appendChild(input);

    mockNow = 100;
    dispatchEscape(input);
    mockNow = 200;
    dispatchEscape(input);

    expect(usePondStore.getState().cameraResetRequestId).toBe(0);
    expect(usePondStore.getState().pendingCameraFit).toBeNull();

    unmount();
    document.body.removeChild(input);
  });

  it('consume-on-trigger: triple-rapid Escape fires one reset, not two', () => {
    const client = new QueryClient();
    const { unmount } = renderWithClient(client);

    mockNow = 100;
    dispatchEscape();
    mockNow = 200;
    dispatchEscape(); // triggers reset — counter = 1, timestamp cleared
    mockNow = 300;
    dispatchEscape(); // timestamp was cleared; this is a fresh "first" ESC

    expect(usePondStore.getState().cameraResetRequestId).toBe(1);
    unmount();
  });

  it('empty cache falls back to default fit', () => {
    const client = new QueryClient();
    // No seeded todos — getQueryData returns undefined, hook falls back to [].
    const { unmount } = renderWithClient(client);

    mockNow = 100;
    dispatchEscape();
    mockNow = 300;
    dispatchEscape();

    expect(usePondStore.getState().cameraResetRequestId).toBe(1);
    expect(usePondStore.getState().pendingCameraFit).toEqual({
      position: [0, 15, 20],
      target: [0, 0, 0],
    });
    unmount();
  });

  // Story 3.3: under the new useTodos keying, a single seeded
  // ['todos', 'list', { ... }] entry still prefix-matches the hook's
  // getQueriesData query.
  it('reads from a new-shape (story 3.3) cache entry via prefix match', () => {
    const client = new QueryClient();
    const todos: Todo[] = [
      makeTodo({ id: 'a', positionX: 10, positionY: 10 }),
      makeTodo({ id: 'b', positionX: 12, positionY: 12 }),
    ];
    client.setQueryData(
      todosQueryKey({ showActive: true, showCompleted: false, showDeleted: false }),
      todos,
    );
    const { unmount } = renderWithClient(client);

    mockNow = 100;
    dispatchEscape();
    mockNow = 200;
    dispatchEscape();

    expect(usePondStore.getState().cameraResetRequestId).toBe(1);
    expect(usePondStore.getState().pendingCameraFit).toEqual(fitCameraToPads(todos));
    unmount();
  });

  // Story 3.3 AC #5 regression: two visibility cache entries (default
  // + all-three-true) — the hook should union their todos and de-dupe
  // by id so overlapping entries don't skew the fit.
  it('merges multiple visibility cache entries and de-dupes by id', () => {
    const client = new QueryClient();
    const activeTodos: Todo[] = [
      makeTodo({ id: 'a', positionX: 10, positionY: 10 }),
    ];
    const allTodos: Todo[] = [
      makeTodo({ id: 'a', positionX: 10, positionY: 10 }),
      makeTodo({ id: 'b', positionX: -20, positionY: 5, completed: true }),
      makeTodo({ id: 'c', positionX: 30, positionY: -15, deleted: true }),
    ];
    client.setQueryData(
      todosQueryKey({ showActive: true, showCompleted: false, showDeleted: false }),
      activeTodos,
    );
    client.setQueryData(
      todosQueryKey({ showActive: true, showCompleted: true, showDeleted: true }),
      allTodos,
    );
    const { unmount } = renderWithClient(client);

    mockNow = 100;
    dispatchEscape();
    mockNow = 200;
    dispatchEscape();

    // Union by id = a, b, c (a de-duped across the two entries).
    const expected = fitCameraToPads(allTodos);
    expect(usePondStore.getState().pendingCameraFit).toEqual(expected);
    unmount();
  });

  it('cleans up the listener on unmount', () => {
    const client = new QueryClient();
    const { unmount } = renderWithClient(client);
    unmount();

    mockNow = 100;
    dispatchEscape();
    mockNow = 300;
    dispatchEscape();

    expect(usePondStore.getState().cameraResetRequestId).toBe(0);
  });
});
