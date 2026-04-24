import { usePondStore } from '../../stores/usePondStore';
import './PondSearchOverlay.css';

// Story 5.3: HTML overlay that renders the user's typed search query
// on top of the water surface. Lives next to (not inside) the R3F
// <Canvas> because it's plain DOM. Positioned fixed at the top of the
// viewport so it reads like a system-level search UI without a chrome.
//
// Rendered unconditionally — the opacity transition handles the
// appear/disappear animation (AC #12 requires a ~200ms dissolve on
// clear, not an abrupt unmount). The child content reads from the
// same `searchQuery` the keyboard hook writes to, so keystroke → DOM
// update latency is one render frame.
//
// `hasVisiblePads`: when false, the user is searching against an empty
// visible-todo set (no pads in the pond at all, or every pad hidden via
// `/hide-all` / visibility filters). Show a friendly note instead of
// silently rendering zero results.
export function PondSearchOverlay({ hasVisiblePads }: { hasVisiblePads: boolean }) {
  const searchQuery = usePondStore((s) => s.searchQuery);
  const searchActive = usePondStore((s) => s.searchActive);
  const vectorSearchUnavailable = usePondStore((s) => s.vectorSearchUnavailable);

  const className = searchActive
    ? 'pond-search-overlay pond-search-overlay--active'
    : 'pond-search-overlay';

  const showNothingToSearch = searchActive && !hasVisiblePads;

  return (
    <div className={className} aria-hidden={!searchActive}>
      <div className="pond-search-overlay__query">{searchQuery || ' '}</div>
      {searchActive && vectorSearchUnavailable && (
        <div className="pond-search-overlay__badge">semantic search offline</div>
      )}
      {showNothingToSearch && (
        <div className="pond-search-overlay__empty">
          nothing to search — the pond is empty
        </div>
      )}
    </div>
  );
}
