import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Todo } from '../types';
import { useWorldStore } from '../stores/useWorldStore';
import { usePeriodicWorldSave, WORLD_SAVE_URL, sendExitPayload } from './usePeriodicWorldSave';

// Mock the axios client — we just want to observe calls, not hit HTTP.
vi.mock('../api/client', () => {
  const patch = vi.fn().mockResolvedValue({ data: [] });
  return {
    default: {
      patch,
      defaults: { baseURL: '/api' },
    },
  };
});

import apiClient from '../api/client';

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    text: 'test',
    completed: false,
    color: '#00ff88',
    positionX: 1,
    positionY: 2,
    rotationY: 0.5,
    driftSeed: 0.9,
    embeddingStatus: 'complete',
    archived: false,
    archivedAt: null,
    deleted: false,
    deletedAt: null,
    createdAt: '2026-04-24T00:00:00Z',
    updatedAt: '2026-04-24T00:00:00Z',
    ...overrides,
  };
}

describe('usePeriodicWorldSave', () => {
  beforeEach(() => {
    useWorldStore.setState({ worldMetadata: new Map() });
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('periodic save', () => {
    it('does NOT fire when no entries are dirty', async () => {
      useWorldStore.getState().hydrateFromTodos([makeTodo({ id: 'a' })]);
      renderHook(() => usePeriodicWorldSave({ intervalMs: 1000 }));
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(apiClient.patch).not.toHaveBeenCalled();
    });

    it('fires a batch PATCH when dirty entries exist at tick time', async () => {
      useWorldStore.getState().hydrateFromTodos([
        makeTodo({ id: 'a' }),
        makeTodo({ id: 'b' }),
      ]);
      useWorldStore.getState().setPosition('a', 10, 20);
      useWorldStore.getState().setPosition('b', 30, 40);
      renderHook(() => usePeriodicWorldSave({ intervalMs: 1000 }));
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve(); // settle the awaited patch call
      });
      expect(apiClient.patch).toHaveBeenCalledWith(
        WORLD_SAVE_URL,
        expect.objectContaining({
          positions: expect.arrayContaining([
            expect.objectContaining({ id: 'a', positionX: 10, positionY: 20 }),
            expect.objectContaining({ id: 'b', positionX: 30, positionY: 40 }),
          ]),
        }),
      );
    });

    it('marks committed entries as saved on success', async () => {
      useWorldStore.getState().hydrateFromTodos([makeTodo({ id: 'a' })]);
      useWorldStore.getState().setPosition('a', 10, 20);
      expect(useWorldStore.getState().getDirtyEntries()).toHaveLength(1);
      renderHook(() => usePeriodicWorldSave({ intervalMs: 1000 }));
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(useWorldStore.getState().getDirtyEntries()).toHaveLength(0);
    });

    it('keeps entries dirty on network failure', async () => {
      const err = new Error('network down');
      const mockedPatch = vi.mocked(apiClient.patch);
      mockedPatch.mockRejectedValueOnce(err);
      const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
      useWorldStore.getState().hydrateFromTodos([makeTodo({ id: 'a' })]);
      useWorldStore.getState().setPosition('a', 10, 20);
      renderHook(() => usePeriodicWorldSave({ intervalMs: 1000 }));
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(useWorldStore.getState().getDirtyEntries()).toHaveLength(1);
      expect(consoleErr).toHaveBeenCalledWith(
        expect.stringContaining('periodic save failed'),
        err,
      );
      consoleErr.mockRestore();
    });
  });
});

describe('sendExitPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers navigator.sendBeacon when available', () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(globalThis, 'navigator', {
      value: { sendBeacon },
      configurable: true,
      writable: true,
    });
    const result = sendExitPayload({
      positions: [{ id: 'a', position_x: 1, position_y: 2, rotation_y: 0 }],
    });
    expect(result).toBe(true);
    expect(sendBeacon).toHaveBeenCalledWith(
      '/api/todos/positions',
      expect.any(Blob),
    );
  });

  it('falls back to fetch({keepalive}) when sendBeacon returns false', () => {
    const sendBeacon = vi.fn().mockReturnValue(false);
    Object.defineProperty(globalThis, 'navigator', {
      value: { sendBeacon },
      configurable: true,
      writable: true,
    });
    const fetchSpy = vi.fn().mockResolvedValue(new Response());
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchSpy,
      configurable: true,
      writable: true,
    });
    const result = sendExitPayload({
      positions: [{ id: 'a', position_x: 1, position_y: 2, rotation_y: 0 }],
    });
    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/todos/positions',
      expect.objectContaining({
        method: 'PATCH',
        keepalive: true,
        body: expect.any(String),
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });
});
