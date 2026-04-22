// Story 4.2: shared React Query client instance.
//
// Previously defined inline in App.tsx, hoisted here so non-React
// code (e.g. the `/spread-out` slash command registered in
// main.tsx at boot) can read cached todo data without going
// through a hook.
//
// The retry policy mirrors story 2.6 AC #7: 3 automatic retries
// with exponential backoff capped at 8s. React Query's `onError`
// fires only after the final retry exhausts — that's when
// LilyPad's decay visual appears. Queries (e.g. `useTodos`) use
// React Query's default retry policy.

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
  },
});
