import { useEffect, useState } from 'react';
import { useSearch } from '../api/searchApi';
import { SEARCH_DEBOUNCE_MS, usePondStore } from '../stores/usePondStore';
import type { SearchHit, SearchResponse } from '../types';

// Minimum zoom distance when framing search results. Matches the
// "default zoom" UX-spec callout (~natural working distance) so a
// single match doesn't zoom uncomfortably close to one pad.
const MIN_SEARCH_ZOOM = 8;

// Padding factor around the match bounding box. 1.2 = 20% margin so
// edge pads don't flush with the viewport.
const BBOX_ZOOM_PADDING = 1.2;

// Story 5.3: debounced search subscriber.
//
// Reads `searchQuery` from the store, waits SEARCH_DEBOUNCE_MS after
// the last keystroke, fires the backend search, and pushes the
// results into the store slices that LilyPad reads each frame.
// Also dispatches a camera auto-frame toward the centroid of matches.
//
// Response handling per AC #3, #8, #9, #10:
//   - ftsSupported=false      → searchAllMatches=true (every live
//                                 todo is treated as a match)
//   - results=[] + fts=true   → empty Map (all live todos become
//                                 non-matches → universal submerge)
//   - otherwise               → Map<id, SearchHit> drives per-pad
//                                 rise/fall
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
  const { setSearchResults, focusCamera } = usePondStore.getState();

  if (!data.ftsSupported) {
    // AC #9: treat all live todos as matches. No per-id hit map is
    // needed — LilyPad reads `searchAllMatches` as the signal and
    // takes the match path without consulting `searchResults`.
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

  // AC #7: auto-frame the camera toward match centroid. Skip the
  // dispatch entirely if no match has a resolved position — the
  // user's current camera pose is left untouched.
  const positioned = data.results.filter(
    (r): r is typeof r & { todo: { positionX: number; positionY: number } } =>
      r.todo.positionX !== null && r.todo.positionY !== null,
  );
  if (positioned.length === 0) return;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let sumX = 0;
  let sumY = 0;
  for (const r of positioned) {
    const { positionX, positionY } = r.todo;
    sumX += positionX;
    sumY += positionY;
    if (positionX < minX) minX = positionX;
    if (positionX > maxX) maxX = positionX;
    if (positionY < minY) minY = positionY;
    if (positionY > maxY) maxY = positionY;
  }
  const cx = sumX / positioned.length;
  const cz = sumY / positioned.length;
  const diagonal = Math.hypot(maxX - minX, maxY - minY);
  const zoom = Math.max(MIN_SEARCH_ZOOM, diagonal * BBOX_ZOOM_PADDING);

  focusCamera(cx, cz, zoom);
}
