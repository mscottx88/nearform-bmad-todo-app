import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from './client';
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos', 'list'] });
    },
  });
}

export function useDeleteCreature() {
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
