/**
 * E2E test seam.
 *
 * Story 1.5: Playwright drives a real browser, but the lily-pad meshes
 * live inside an R3F `<canvas>` and aren't reachable through DOM
 * selectors. Rather than projecting world coordinates into screen space
 * and dispatching synthetic mouse events at unstable pixel positions,
 * we expose a narrow programmatic hook that opens the in-scene popup
 * for a known todo id. The Playwright test then drives the popup's
 * Complete / Delete buttons through real DOM clicks — same React code
 * path as a manual user, just bypassing the WebGL raycast that picked
 * the pad.
 *
 * Activation: requires BOTH (a) a non-production build (`import.meta.env.DEV`
 * or `MODE === 'test'`) AND (b) the URL containing `?e2e=1` / `&e2e=1`.
 * Production bundles still bundle the file but `maybeInstallE2EHooks`
 * is a no-op behind the env-mode guard, so the entire seam tree-shakes
 * if the bundler drops dead code at build time. The runtime guard is
 * the belt-and-braces against any tree-shaker miss.
 */

import { queryClient } from '../api/queryClient';
import { TODOS_KEY } from '../api/todoApi';
import { usePondStore } from '../stores/usePondStore';
import type { Todo } from '../types';

export interface E2EHooks {
  openPopup(todoId: string, x?: number, z?: number): void;
  closePopup(): void;
  /**
   * Story 1.5 review patch (D1): list of todo ids the SPA currently
   * has in its React Query cache (across all visibility filters).
   * Used by `e2e/create-todo.spec.ts` to verify a created todo
   * surfaces in the rendered set without requiring a WebGL probe.
   */
  getRenderedTodoIds(): string[];
  /**
   * Story 1.5 review patch (D2): list of todo ids that the active
   * search currently considers a hit. Used by `e2e/search.spec.ts`
   * to verify the matching pad rises and others submerge — that
   * behavior is driven by `searchResults` in the pond store.
   */
  getSearchResultIds(): string[];
  /** Stable build identifier for sanity in failing CI logs. */
  readonly version: '2';
}

declare global {
  interface Window {
    __pondE2E__?: E2EHooks;
  }
}

export function maybeInstallE2EHooks(): void {
  if (typeof window === 'undefined') return;
  // Build-time gate: production bundles never reach the runtime check
  // unless the build was explicitly opted-in via VITE_E2E_HOOKS=1.
  // `import.meta.env.DEV` covers `vite dev` and unit-test runs;
  // `VITE_E2E_HOOKS` is set by the docker-compose frontend build so
  // Playwright can drive the production-shaped stack. A "real prod"
  // build (no DEV, no VITE_E2E_HOOKS) tree-shakes the install path.
  const e2eBuildOptIn =
    import.meta.env.VITE_E2E_HOOKS === '1' ||
    import.meta.env.VITE_E2E_HOOKS === 'true';
  if (!import.meta.env.DEV && !e2eBuildOptIn) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get('e2e') !== '1') return;
  window.__pondE2E__ = {
    version: '2',
    openPopup(todoId, x = 0, z = 0) {
      usePondStore.getState().openPopup(todoId, x, z);
    },
    closePopup() {
      usePondStore.getState().closePopup();
    },
    getRenderedTodoIds() {
      // React Query stores one cache entry per visibility-filter
      // triple. Flatten across all of them and dedupe by id so the
      // helper works regardless of which `/show-*` mode the user
      // (or the test) is currently in.
      const entries = queryClient.getQueriesData<readonly Todo[]>({
        queryKey: TODOS_KEY,
      });
      const seen = new Set<string>();
      for (const [, data] of entries) {
        if (!data) continue;
        for (const t of data) seen.add(t.id);
      }
      return [...seen];
    },
    getSearchResultIds() {
      return [...usePondStore.getState().searchResults.keys()];
    },
  };
}
