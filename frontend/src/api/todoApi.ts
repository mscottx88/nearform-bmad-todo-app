import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import apiClient from './client';
import { usePondStore } from '../stores/usePondStore';
import type { Todo } from '../types';

// Story 3.3: TODOS_KEY stays as the prefix; the concrete query key
// now includes a visibility triple so each flag combination gets its
// own React Query cache entry. Mutations invalidate this prefix so
// every cached mode refetches after a create/update/delete.
export const TODOS_KEY = ['todos', 'list'] as const;

interface VisibilityTriple {
  showActive: boolean;
  showCompleted: boolean;
  showDeleted: boolean;
}

export function todosQueryKey(visibility: VisibilityTriple) {
  return [
    ...TODOS_KEY,
    {
      active: visibility.showActive,
      completed: visibility.showCompleted,
      deleted: visibility.showDeleted,
    },
  ] as const;
}

interface CreateTodoInput {
  text: string;
  color?: string;
  positionX?: number;
  positionY?: number;
}

export function useTodos() {
  // `useShallow` because the selector returns a fresh object per
  // render — without it, every render is a new reference and the
  // `useQuery` effect re-runs infinitely. Shallow-compare keeps the
  // three booleans from triggering unless their values actually change.
  const visibility = usePondStore(
    useShallow((s) => ({
      showActive: s.showActive,
      showCompleted: s.showCompleted,
      showDeleted: s.showDeleted,
    })),
  );
  return useQuery({
    queryKey: todosQueryKey(visibility),
    queryFn: async () => {
      const params = new URLSearchParams({
        include_active: String(visibility.showActive),
        include_completed: String(visibility.showCompleted),
        include_deleted: String(visibility.showDeleted),
      });
      const { data } = await apiClient.get<Todo[]>(`/todos?${params.toString()}`);
      return data;
    },
  });
}

export function useCreateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTodoInput) => {
      const { data } = await apiClient.post<Todo>('/todos', input);
      return data;
    },
    onSuccess: () => {
      // Story 3.3: prefix-invalidate so every cached visibility triple
      // (['todos', 'list', { ... }]) refetches. React Query v5 matches
      // by prefix unless `exact: true` is set.
      queryClient.invalidateQueries({ queryKey: TODOS_KEY });
    },
  });
}

interface UpdateTodoInput {
  id: string;
  completed?: boolean;
  text?: string;
  color?: string;
  positionX?: number;
  positionY?: number;
}

export function useUpdateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...fields }: UpdateTodoInput) => {
      const { data } = await apiClient.patch<Todo>(`/todos/${id}`, fields);
      return data;
    },
    // Story 2.6 AC #5: clear any decay the moment a fresh mutation begins
    // so the pad reads as healthy during the attempt. React Query calls
    // onMutate once per `mutate()` call (before the first attempt), NOT on
    // each retry — retries happen inside the existing promise. That's the
    // behavior we want: the user-triggered retry clears decay; internal
    // retries don't flicker the visual during the backoff window (AC #7).
    onMutate: ({ id }) => {
      usePondStore.getState().clearTodoError(id);
    },
    onSuccess: (_data, { id }) => {
      usePondStore.getState().clearTodoError(id);
      // Story 3.3: prefix-invalidate so every cached visibility triple
      // (['todos', 'list', { ... }]) refetches. React Query v5 matches
      // by prefix unless `exact: true` is set.
      queryClient.invalidateQueries({ queryKey: TODOS_KEY });
    },
    // Story 2.6 AC #4: fires only after the client-level retry budget
    // (3 attempts, exponential backoff) is exhausted.
    onError: (err, { id }) => {
      usePondStore.getState().setTodoError(id, 'update', err as Error);
    },
  });
}

/**
 * Story 4-8: batch position update.
 *
 * Replaces the per-pad PATCH fan-out that drag-release fired for the
 * dragged pad plus every sibling whose cascade nudge crossed the
 * commit threshold. One request, one invalidation, one retry budget.
 *
 * Request shape: `{ positions: [{ id, positionX, positionY }, ...] }`.
 * Axios's `decamelize-keys` request interceptor flips the keys to
 * snake_case on the wire; the backend's `TodoPositionsUpdate` model
 * is defined in snake_case directly.
 *
 * Error handling mirrors `useUpdateTodo`: on mutation entry every id
 * in the batch has its decay cleared; on exhausted-retry error every
 * id gets a fresh `setTodoError('update', ...)` — so a partial
 * network failure decays all involved pads together. Successful
 * response triggers a single prefix-invalidate on `TODOS_KEY`.
 */
export interface UpdatePositionEntry {
  id: string;
  positionX: number;
  positionY: number;
  rotationY: number;
}

export function useUpdateTodoPositions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entries: UpdatePositionEntry[]) => {
      const { data } = await apiClient.patch<Todo[]>('/todos/positions', {
        positions: entries,
      });
      return data;
    },
    onMutate: (entries) => {
      const store = usePondStore.getState();
      for (const e of entries) store.clearTodoError(e.id);
    },
    onSuccess: (_data, entries) => {
      const store = usePondStore.getState();
      for (const e of entries) store.clearTodoError(e.id);
      queryClient.invalidateQueries({ queryKey: TODOS_KEY });
    },
    onError: (err, entries) => {
      const store = usePondStore.getState();
      for (const e of entries) store.setTodoError(e.id, 'update', err as Error);
    },
  });
}

export function useRestoreTodo() {
  // Story 3.3: POST /api/todos/:id/restore flips a soft-deleted row's
  // `deleted` back to `false`. Used by the ActionPopup UNDELETE button
  // when the popup opens on a deleted pad. Mirrors the mutation
  // plumbing of useUpdateTodo — clearTodoError onMutate/onSuccess,
  // setTodoError onError (via the 'update' op slot since restore is
  // conceptually an update), prefix-invalidate todos on success.
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<Todo>(`/todos/${id}/restore`);
      return data;
    },
    onMutate: (id) => {
      usePondStore.getState().clearTodoError(id);
    },
    onSuccess: (_data, id) => {
      usePondStore.getState().clearTodoError(id);
      queryClient.invalidateQueries({ queryKey: TODOS_KEY });
    },
    onError: (err, id) => {
      usePondStore.getState().setTodoError(id, 'update', err as Error);
    },
  });
}

export function useDeleteTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      // Backend currently returns the soft-deleted TodoResponse body, but the
      // consumer (usePopupDelete) discards it. Typing as void keeps the hook
      // honest if/when the endpoint switches to the canonical 204 No Content.
      await apiClient.delete(`/todos/${id}`);
    },
    onMutate: (id) => {
      usePondStore.getState().clearTodoError(id);
    },
    onSuccess: (_data, id) => {
      usePondStore.getState().clearTodoError(id);
      // Story 3.3: prefix-invalidate so every cached visibility triple
      // (['todos', 'list', { ... }]) refetches. React Query v5 matches
      // by prefix unless `exact: true` is set.
      queryClient.invalidateQueries({ queryKey: TODOS_KEY });
    },
    onError: (err, id) => {
      usePondStore.getState().setTodoError(id, 'delete', err as Error);
    },
  });
}
