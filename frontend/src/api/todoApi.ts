import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from './client';
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...TODOS_KEY] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...TODOS_KEY] });
    },
  });
}
