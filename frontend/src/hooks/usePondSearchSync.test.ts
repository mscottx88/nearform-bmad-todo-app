import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import apiClient from '../api/client';
import { usePondStore } from '../stores/usePondStore';
import { usePondSearchSync } from './usePondSearchSync';
import type { SearchResponse, Todo } from '../types';

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
    ...overrides,
  };
}

function renderSync() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(() => usePondSearchSync(), { wrapper });
}

function resetStore() {
  usePondStore.setState({
    searchQuery: '',
    searchActive: false,
    searchResults: new Map(),
    searchAllMatches: false,
    vectorSearchUnavailable: false,
    cameraFocus: null,
  });
}

// Debounce-timing tests run under fake timers so we can assert
// the 300 ms window precisely and verify keystroke coalescing.
describe('usePondSearchSync (debounce, fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not fire a request before the 300ms debounce elapses', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: {} });
    renderSync();

    act(() => {
      usePondStore.setState({ searchQuery: 'rev', searchActive: true });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('fires exactly once after the debounce window elapses', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        query: 'rev',
        results: [],
        vectorSearchUnavailable: false,
        ftsSupported: true,
      } satisfies SearchResponse,
    });
    renderSync();

    act(() => {
      usePondStore.setState({ searchQuery: 'rev', searchActive: true });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(
      '/search',
      {
        params: {
          q: 'rev',
          include_active: true,
          include_completed: false,
          include_deleted: false,
        },
      },
    );
  });

  it('coalesces rapid keystrokes into a single request', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        query: 'rev',
        results: [],
        vectorSearchUnavailable: false,
        ftsSupported: true,
      } satisfies SearchResponse,
    });
    renderSync();

    act(() => {
      usePondStore.setState({ searchQuery: 'r', searchActive: true });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    act(() => usePondStore.setState({ searchQuery: 're' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    act(() => usePondStore.setState({ searchQuery: 'rev' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(
      '/search',
      {
        params: {
          q: 'rev',
          include_active: true,
          include_completed: false,
          include_deleted: false,
        },
      },
    );
  });

  it('skips the request when searchActive is false', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: {} });
    renderSync();

    act(() => {
      usePondStore.setState({ searchQuery: 'rev', searchActive: false });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(getSpy).not.toHaveBeenCalled();
  });
});

// Response-handling tests use real timers so we can waitFor() on
// React-Query's async resolve + the downstream useEffect.
describe('usePondSearchSync (response handling, real timers)', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('populates searchResults with the map keyed by todo id', async () => {
    const todo = makeTodo('todo-42', { text: 'Review Q2', positionX: 5, positionY: 6 });
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        query: 'rev',
        results: [{ todo, score: 0.88, matchType: 'hybrid' }],
        vectorSearchUnavailable: false,
        ftsSupported: true,
      } satisfies SearchResponse,
    });
    renderSync();

    act(() => {
      usePondStore.setState({ searchQuery: 'rev', searchActive: true });
    });

    await waitFor(
      () => {
        expect(usePondStore.getState().searchResults.size).toBe(1);
      },
      { timeout: 2000 },
    );
    expect(usePondStore.getState().searchResults.get('todo-42')).toEqual({
      score: 0.88,
      matchType: 'hybrid',
    });
    expect(usePondStore.getState().searchAllMatches).toBe(false);
  });

  it('sets searchAllMatches=true when ftsSupported is false', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        query: 'the',
        results: [],
        vectorSearchUnavailable: false,
        ftsSupported: false,
      } satisfies SearchResponse,
    });
    renderSync();

    act(() => {
      usePondStore.setState({ searchQuery: 'the', searchActive: true });
    });

    await waitFor(
      () => {
        expect(usePondStore.getState().searchAllMatches).toBe(true);
      },
      { timeout: 2000 },
    );
    expect(usePondStore.getState().searchResults.size).toBe(0);
  });

  it('surfaces vectorSearchUnavailable from the response', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        query: 'rev',
        results: [],
        vectorSearchUnavailable: true,
        ftsSupported: true,
      } satisfies SearchResponse,
    });
    renderSync();

    act(() => {
      usePondStore.setState({ searchQuery: 'rev', searchActive: true });
    });

    await waitFor(
      () => {
        expect(usePondStore.getState().vectorSearchUnavailable).toBe(true);
      },
      { timeout: 2000 },
    );
  });

  it('never touches cameraFocus — search leaves the pond view alone', async () => {
    // Per user direction: searching must NOT zoom or pan the camera;
    // every pad must stay visible. This pins the invariant — the sync
    // hook must not dispatch focusCamera regardless of where the
    // matched pads sit. Seeding a sentinel cameraFocus and verifying
    // it's unchanged after a response lands guards against a future
    // "helpful" re-introduction of auto-framing.
    const matchA = makeTodo('a', { positionX: 0, positionY: 0 });
    const matchB = makeTodo('b', { positionX: 4, positionY: 2 });
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        query: 'x',
        results: [
          { todo: matchA, score: 0.9, matchType: 'hybrid' },
          { todo: matchB, score: 0.8, matchType: 'hybrid' },
        ],
        vectorSearchUnavailable: false,
        ftsSupported: true,
      } satisfies SearchResponse,
    });
    renderSync();

    const sentinelFocus = { x: 99, z: 99, zoom: 42 };
    act(() => {
      usePondStore.setState({
        searchQuery: 'x',
        searchActive: true,
        cameraFocus: sentinelFocus,
      });
    });

    // Wait for the response to propagate so we know the sync hook ran.
    await waitFor(
      () => {
        expect(usePondStore.getState().searchResults.size).toBe(2);
      },
      { timeout: 2000 },
    );
    // cameraFocus must still be the sentinel — search must not touch it.
    expect(usePondStore.getState().cameraFocus).toEqual(sentinelFocus);
  });
});
