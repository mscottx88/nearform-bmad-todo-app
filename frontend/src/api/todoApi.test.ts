import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import apiClient from './client';
import { usePondStore } from '../stores/usePondStore';
import {
  TODOS_KEY,
  todosQueryKey,
  useCreateTodo,
  useDeleteTodo,
  useTodos,
  useUpdateTodo,
} from './todoApi';
import type { Todo } from '../types';

function makeTodo(id: string, overrides: Partial<Todo> = {}): Todo {
  return {
    id,
    text: 'test',
    completed: false,
    color: '#00eeff',
    positionX: 0,
    positionY: 0,
    embeddingStatus: 'complete',
    archived: false,
    archivedAt: null,
    deleted: false,
    deletedAt: null,
    createdAt: '2026-04-16T00:00:00Z',
    updatedAt: '2026-04-16T00:00:00Z',
    groupId: null,
    ...overrides,
  };
}

function resetStore() {
  usePondStore.setState({
    showActive: true,
    showCompleted: false,
    showDeleted: false,
  });
}

function renderWithClient<T>(hook: () => T, queryClient?: QueryClient) {
  const client =
    queryClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { ...renderHook(hook, { wrapper }), queryClient: client };
}

describe('todosQueryKey (story 3.3)', () => {
  it('derives a prefix-extended key from the visibility triple', () => {
    const key = todosQueryKey({ showActive: true, showCompleted: false, showDeleted: false });
    expect(key).toEqual([
      ...TODOS_KEY,
      { active: true, completed: false, deleted: false },
    ]);
  });

  it('unique combinations produce distinct keys', () => {
    const k1 = todosQueryKey({ showActive: true, showCompleted: false, showDeleted: false });
    const k2 = todosQueryKey({ showActive: true, showCompleted: true, showDeleted: false });
    expect(k1[2]).not.toEqual(k2[2]);
  });
});

describe('useTodos query-key derivation (story 3.3 AC #5)', () => {
  beforeEach(() => {
    resetStore();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('issues GET /todos with the default triple (include_active=true only)', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: [] });
    const { queryClient } = renderWithClient(() => useTodos());
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    const url = getSpy.mock.calls[0][0] as string;
    expect(url).toContain('include_active=true');
    expect(url).toContain('include_completed=false');
    expect(url).toContain('include_deleted=false');
    // Cache entry is keyed by the visibility triple.
    const keys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toContainEqual(
      todosQueryKey({ showActive: true, showCompleted: false, showDeleted: false }),
    );
  });

  it('flipping showCompleted re-keys the query and sends include_completed=true', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: [] });
    const { queryClient, rerender } = renderWithClient(() => useTodos());
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));

    act(() => {
      usePondStore.getState().setVisibility({ showCompleted: true });
    });
    rerender();
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));

    const secondUrl = getSpy.mock.calls[1][0] as string;
    expect(secondUrl).toContain('include_completed=true');

    const keys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toContainEqual(
      todosQueryKey({ showActive: true, showCompleted: true, showDeleted: false }),
    );
  });
});

describe('mutation invalidation prefix-matches every visibility entry (story 3.3 AC #5)', () => {
  beforeEach(() => {
    resetStore();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function seedTwoCacheEntries(queryClient: QueryClient) {
    // Seed the default triple + the all-three-true triple so we can
    // assert that a single mutation invalidates BOTH.
    queryClient.setQueryData(
      todosQueryKey({ showActive: true, showCompleted: false, showDeleted: false }),
      [makeTodo('a')],
    );
    queryClient.setQueryData(
      todosQueryKey({ showActive: true, showCompleted: true, showDeleted: true }),
      [makeTodo('a'), makeTodo('b', { completed: true })],
    );
  }

  it('useCreateTodo invalidates every cached [\'todos\', \'list\', *] entry', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: makeTodo('new') });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    seedTwoCacheEntries(queryClient);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderWithClient(() => useCreateTodo(), queryClient);
    await act(async () => {
      await result.current.mutateAsync({ text: 'hello' });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: TODOS_KEY });
  });

  it('useUpdateTodo invalidates on success', async () => {
    vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: makeTodo('a', { completed: true }) });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    seedTwoCacheEntries(queryClient);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderWithClient(() => useUpdateTodo(), queryClient);
    await act(async () => {
      await result.current.mutateAsync({ id: 'a', completed: true });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: TODOS_KEY });
  });

  it('useDeleteTodo invalidates on success', async () => {
    vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: null });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    seedTwoCacheEntries(queryClient);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderWithClient(() => useDeleteTodo(), queryClient);
    await act(async () => {
      await result.current.mutateAsync('a');
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: TODOS_KEY });
  });
});
