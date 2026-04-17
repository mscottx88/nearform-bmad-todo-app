import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCompleteTodo } from './usePopupComplete';

const updateMutate = vi.fn();
const createMutate = vi.fn();

vi.mock('../api/todoApi', () => ({
  useUpdateTodo: () => ({ mutate: updateMutate }),
}));

vi.mock('../api/creatureApi', () => ({
  useCreateCreature: () => ({ mutate: createMutate }),
}));

describe('useCompleteTodo', () => {
  beforeEach(() => {
    updateMutate.mockReset();
    createMutate.mockReset();
  });

  it('returns a { creatureType, rarity } pick with a non-empty type string', () => {
    const { result } = renderHook(() => useCompleteTodo());
    const pick = result.current('todo-1');
    expect(typeof pick.creatureType).toBe('string');
    expect(pick.creatureType.length).toBeGreaterThan(0);
    expect(['common', 'uncommon', 'rare', 'legendary']).toContain(pick.rarity);
  });

  it('fires updateTodo with completed:true', () => {
    const { result } = renderHook(() => useCompleteTodo());
    result.current('todo-42');
    expect(updateMutate).toHaveBeenCalledWith(
      { id: 'todo-42', completed: true },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('fires createCreature with todoId + picked type + rarity', () => {
    const { result } = renderHook(() => useCompleteTodo());
    const pick = result.current('todo-7');
    expect(createMutate).toHaveBeenCalledWith(
      {
        todoId: 'todo-7',
        creatureType: pick.creatureType,
        rarity: pick.rarity,
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('logs via console.warn when an onError handler fires (async network failure)', () => {
    // React Query routes network errors through the `onError` option, not a
    // synchronous throw — so exercise that path explicitly to lock AC #8.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    updateMutate.mockImplementation(
      (_args: unknown, opts?: { onError?: (err: Error) => void }) => {
        opts?.onError?.(new Error('boom'));
      },
    );
    const { result } = renderHook(() => useCompleteTodo());
    result.current('todo-async');
    expect(warnSpy).toHaveBeenCalledWith(
      '[usePopupComplete] updateTodo failed:',
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it('still returns a pick when updateTodo.mutate throws', () => {
    updateMutate.mockImplementation(() => {
      throw new Error('network down');
    });
    const { result } = renderHook(() => useCompleteTodo());
    const pick = result.current('todo-x');
    expect(pick.creatureType).toBeTruthy();
    // Still attempts the creature creation
    expect(createMutate).toHaveBeenCalled();
  });

  it('still returns a pick when createCreature.mutate throws', () => {
    createMutate.mockImplementation(() => {
      throw new Error('creature endpoint gone');
    });
    const { result } = renderHook(() => useCompleteTodo());
    const pick = result.current('todo-y');
    expect(pick.creatureType).toBeTruthy();
    expect(updateMutate).toHaveBeenCalled();
  });
});
