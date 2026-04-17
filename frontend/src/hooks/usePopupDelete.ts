import { useCallback } from 'react';
import { useDeleteTodo } from '../api/todoApi';

export function useDeleteTodoAction(): (todoId: string) => void {
  const deleteTodo = useDeleteTodo();

  return useCallback(
    (todoId: string): void => {
      // Fire-and-forget: the visual flash/dissolve must not wait on the
      // network. AC #7 requires async failures log via `console.warn`
      // without rolling back the animation. React Query routes network
      // errors through `onError`, not synchronous throws — so hook both
      // the sync and async paths (2.4 locked this contract in).
      try {
        deleteTodo.mutate(todoId, {
          onError: (err) => {
            console.warn('[usePopupDelete] deleteTodo failed:', err);
          },
        });
      } catch (err) {
        console.warn('[usePopupDelete] deleteTodo threw:', err);
      }
    },
    [deleteTodo],
  );
}
