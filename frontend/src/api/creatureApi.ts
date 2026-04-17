import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from './client';
import { usePondStore } from '../stores/usePondStore';
import type { Creature } from '../types';

interface CreateCreatureInput {
  todoId: string;
  creatureType: string;
  rarity: string;
}

export function useCreateCreature() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCreatureInput) => {
      const { data } = await apiClient.post<Creature>('/creatures', input);
      return data;
    },
    // Story 2.6: the user-facing action is "click Complete", so error
    // tracking uses the `'complete'` operation tag even though the
    // failing network call here is the creature POST.
    onMutate: ({ todoId }) => {
      usePondStore.getState().clearTodoError(todoId);
    },
    onSuccess: (_data, { todoId }) => {
      usePondStore.getState().clearTodoError(todoId);
      queryClient.invalidateQueries({ queryKey: ['todos', 'list'] });
    },
    onError: (err, { todoId }) => {
      usePondStore.getState().setTodoError(todoId, 'complete', err as Error);
    },
  });
}

export function useDeleteCreature() {
  // Currently unused (egg-hatch path was removed with story 2.4 — see the
  // superseded story doc). Kept as dead-but-harmless backend wiring per
  // 2.4's "leave it as dead backend code for now" decision. No error
  // tracking wired; if this ever comes back into use, mirror useCreateCreature.
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (todoId: string) => {
      await apiClient.delete(`/creatures/todo/${todoId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos', 'list'] });
    },
  });
}
