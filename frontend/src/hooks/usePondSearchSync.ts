import { useEffect, useState } from 'react';
import { useSearch } from '../api/searchApi';
import { SEARCH_DEBOUNCE_MS, usePondStore } from '../stores/usePondStore';
import type { SearchHit, SearchResponse } from '../types';

// Story 5.3: debounced search subscriber.
//
// Reads `searchQuery` from the store, waits SEARCH_DEBOUNCE_MS after
// the last keystroke, fires the backend search, and pushes the
// results into the store slices that LilyPad reads each frame.
//
// The camera is NOT auto-framed: per user direction the pond view
// stays put so every pad stays on-screen. Search feedback is purely
// the per-pad halo scaling (LilyPad glow write uses the match score)
// — no zoom, no pan, no orbit touching.
//
// Response handling:
//   - ftsSupported=false      → searchAllMatches=true (every live
//                                 todo is treated as a match)
//   - results=[] + fts=true   → empty Map (every live todo is a
//                                 non-match → all halos snuff)
//   - otherwise               → Map<id, SearchHit> drives per-pad
//                                 glow scaling
export function usePondSearchSync(): void {
  const searchQuery = usePondStore((s) => s.searchQuery);
  const searchActive = usePondStore((s) => s.searchActive);

  // Classic `useEffect` + `setTimeout` debounce — no external lib
  // needed for a 300 ms window.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  const { data } = useSearch(debouncedQuery, searchActive);

  useEffect(() => {
    if (!data) return;
    applySearchResponse(data);
  }, [data]);
}

function applySearchResponse(data: SearchResponse): void {
  const { setSearchResults } = usePondStore.getState();

  if (!data.ftsSupported) {
    // Treat every live todo as a match. No per-id hit map is needed —
    // LilyPad reads `searchAllMatches` as the signal and takes the
    // match path without consulting `searchResults`.
    setSearchResults({
      results: new Map(),
      allMatches: true,
      vectorUnavailable: data.vectorSearchUnavailable,
    });
    return;
  }

  const results = new Map<string, SearchHit>();
  for (const r of data.results) {
    results.set(r.todo.id, { score: r.score, matchType: r.matchType });
  }
  setSearchResults({
    results,
    allMatches: false,
    vectorUnavailable: data.vectorSearchUnavailable,
  });
}
