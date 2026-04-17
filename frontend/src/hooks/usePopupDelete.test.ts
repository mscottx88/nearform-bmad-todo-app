import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDeleteTodoAction } from './usePopupDelete';

const deleteMutate = vi.fn();

vi.mock('../api/todoApi', () => ({
  useDeleteTodo: () => ({ mutate: deleteMutate }),
}));

describe('useDeleteTodoAction', () => {
  beforeEach(() => {
    deleteMutate.mockReset();
  });

  it('fires deleteTodo.mutate with the todo id and an onError option', () => {
    const { result } = renderHook(() => useDeleteTodoAction());
    result.current('todo-1');
    expect(deleteMutate).toHaveBeenCalledWith(
      'todo-1',
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('logs via console.warn when an onError handler fires (async network failure)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deleteMutate.mockImplementation(
      (_id: unknown, opts?: { onError?: (err: Error) => void }) => {
        opts?.onError?.(new Error('boom'));
      },
    );
    const { result } = renderHook(() => useDeleteTodoAction());
    result.current('todo-async');
    expect(warnSpy).toHaveBeenCalledWith(
      '[usePopupDelete] deleteTodo failed:',
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it('does not propagate when mutate throws synchronously', () => {
    deleteMutate.mockImplementation(() => {
      throw new Error('network down');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useDeleteTodoAction());
    expect(() => result.current('todo-sync')).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      '[usePopupDelete] deleteTodo threw:',
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
