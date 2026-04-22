import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from './client';
import { TODOS_KEY } from './todoApi';
import type { Group } from '../types';

// Story 4.6: group mutations. All three invalidate TODOS_KEY on
// success so the visibility-triple cache entries refetch and pads
// pick up their new `groupId` value. No dedicated groups query —
// group membership is discovered via `todo.groupId`, so the React
// Query cache has no separate groups entry to invalidate.

interface CreateGroupInput {
  memberIds: string[];
  label?: string | null;
}

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateGroupInput) => {
      const { data } = await apiClient.post<Group>('/groups', input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TODOS_KEY });
    },
  });
}

interface UpdateGroupInput {
  id: string;
  label?: string | null;
  color?: string | null;
  memberIds?: string[];
}

export function useUpdateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...fields }: UpdateGroupInput) => {
      const { data } = await apiClient.patch<Group>(`/groups/${id}`, fields);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TODOS_KEY });
    },
  });
}

export function useDeleteGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TODOS_KEY });
    },
  });
}
