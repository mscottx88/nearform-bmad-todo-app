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
//
// Fade-on-focus: when a popup is open on a pad AND that pad has a
// search hit, the overlay drops to very low opacity so it doesn't
// compete with the focused pad for attention. The typed query is still
// there (no full dismissal — users may want to continue typing to
// narrow further), but it gets out of the way visually.
export function PondSearchOverlay({ hasVisiblePads }: { hasVisiblePads: boolean }) {
  const searchQuery = usePondStore((s) => s.searchQuery);
  const searchActive = usePondStore((s) => s.searchActive);
  const vectorSearchUnavailable = usePondStore((s) => s.vectorSearchUnavailable);
  // True iff a popup is currently open on a pad AND that pad is among
  // the current search results. Re-evaluated when any of the three
  // inputs changes; the selector is a simple boolean so Zustand's
  // default equality check keeps renders tight.
  const activePadIsMatched = usePondStore(
    (s) =>
      s.activePopupTodoId !== null && s.searchResults.has(s.activePopupTodoId),
  );

  const faded = searchActive && activePadIsMatched;
  const classes = ['pond-search-overlay'];
  if (searchActive) classes.push('pond-search-overlay--active');
  if (faded) classes.push('pond-search-overlay--faded');
  const className = classes.join(' ');

  const showNothingToSearch = searchActive && !hasVisiblePads;

  return (
    <div className={className} aria-hidden={!searchActive}>
      <div className="pond-search-overlay__query">{searchQuery || ' '}</div>
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
