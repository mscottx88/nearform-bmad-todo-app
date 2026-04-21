import { useQuery } from '@tanstack/react-query';
import apiClient from './client';
import type { SearchResponse } from '../types';

// Per-query cache: back-and-forth typing returns instantly from cache for 30s.
// Long enough that retyping after a glance at results is free; short enough
// that stale embedding/FTS ordering doesn't linger past the working session.
const SEARCH_STALE_TIME_MS = 30_000;

export function useSearch(query: string, enabled: boolean) {
  return useQuery({
    queryKey: ['search', query] as const,
    queryFn: async () => {
      const { data } = await apiClient.get<SearchResponse>('/search', {
        params: { q: query },
      });
      return data;
    },
    // Skip the network entirely for whitespace-only or empty queries —
    // the backend would 422 them and there's nothing to render.
    enabled: enabled && query.trim().length > 0,
    staleTime: SEARCH_STALE_TIME_MS,
  });
}
