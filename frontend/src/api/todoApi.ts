import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from './client';
import { usePondStore } from '../stores/usePondStore';
import type { Todo } from '../types';

const TODOS_KEY = ['todos', 'list'] as const;

interface CreateTodoInput {
  text: string;
  color?: string;
  positionX?: number;
  positionY?: number;
}

export function useTodos() {
  return useQuery({
    queryKey: TODOS_KEY,
    queryFn: async () => {
      const { data } = await apiClient.get<Todo[]>('/todos');
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
      queryClient.invalidateQueries({ queryKey: [...TODOS_KEY] });
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
    // Story 2.6 AC #5: clear any decay the moment a retry begins so the
    // pad reads as healthy during the attempt. Runs at the start of EACH
    // retry attempt (React Query contract).
    onMutate: ({ id }) => {
      usePondStore.getState().clearTodoError(id);
    },
    onSuccess: (_data, { id }) => {
      usePondStore.getState().clearTodoError(id);
      queryClient.invalidateQueries({ queryKey: [...TODOS_KEY] });
    },
    // Story 2.6 AC #4: fires only after the client-level retry budget
    // (3 attempts, exponential backoff) is exhausted.
    onError: (err, { id }) => {
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
      queryClient.invalidateQueries({ queryKey: [...TODOS_KEY] });
    },
    onError: (err, id) => {
      usePondStore.getState().setTodoError(id, 'delete', err as Error);
    },
  });
}
