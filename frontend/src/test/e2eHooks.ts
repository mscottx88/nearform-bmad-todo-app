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
 * Activation: ONLY when the URL contains `?e2e=1` (or `&e2e=1`). Normal
 * users never load this code path; production bundles include the file
 * but the activation guard fails closed.
 */

import { usePondStore } from '../stores/usePondStore';

export interface E2EHooks {
  openPopup(todoId: string, x?: number, z?: number): void;
  closePopup(): void;
  /** Stable build identifier for sanity in failing CI logs. */
  readonly version: '1';
}

declare global {
  interface Window {
    __pondE2E__?: E2EHooks;
  }
}

export function maybeInstallE2EHooks(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (params.get('e2e') !== '1') return;
  window.__pondE2E__ = {
    version: '1',
    openPopup(todoId, x = 0, z = 0) {
      usePondStore.getState().openPopup(todoId, x, z);
    },
    closePopup() {
      usePondStore.getState().closePopup();
    },
  };
}
