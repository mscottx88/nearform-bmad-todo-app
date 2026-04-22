import { useQuery } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import apiClient from './client';
import { usePondStore } from '../stores/usePondStore';
import type { SearchResponse } from '../types';

// Per-query cache: back-and-forth typing returns instantly from cache for 30s.
// Long enough that retyping after a glance at results is free; short enough
// that stale embedding/FTS ordering doesn't linger past the working session.
const SEARCH_STALE_TIME_MS = 30_000;

export function useSearch(query: string, enabled: boolean) {
  // Story 3.3: search matches every currently-visible pad. The query
  // key includes the visibility triple so switching visibility
  // invalidates the prior search cache for the same text — otherwise
  // toggling "show completed" after a search would serve stale FTS-
  // only results. `useShallow` keeps the selector stable per identity.
  const visibility = usePondStore(
    useShallow((s) => ({
      showActive: s.showActive,
      showCompleted: s.showCompleted,
      showDeleted: s.showDeleted,
    })),
  );
  return useQuery({
    queryKey: [
      'search',
      query,
      {
        active: visibility.showActive,
        completed: visibility.showCompleted,
        deleted: visibility.showDeleted,
      },
    ] as const,
    queryFn: async () => {
      const { data } = await apiClient.get<SearchResponse>('/search', {
        params: {
          q: query,
          include_active: visibility.showActive,
          include_completed: visibility.showCompleted,
          include_deleted: visibility.showDeleted,
        },
      });
      return data;
    },
    // Skip the network entirely for whitespace-only or empty queries —
    // the backend would 422 them and there's nothing to render.
    enabled: enabled && query.trim().length > 0,
    staleTime: SEARCH_STALE_TIME_MS,
  });
}
