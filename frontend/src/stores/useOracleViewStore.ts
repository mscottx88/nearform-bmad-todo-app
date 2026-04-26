/**
 * Story 6.7: a tiny store carrying the secondary `<View>`'s track
 * DOM ref between `AgentPanelOracleView` (which mounts the div) and
 * `PondScene` (which renders the actual drei `<View>` inside the
 * shared `<Canvas>`).
 *
 * Why a store and not React context: the panel and the canvas live
 * as siblings under `<App>`. Threading a ref via context would
 * require wrapping both in a shared provider, which also means
 * lifting state to App and adding a new context layer. A one-field
 * Zustand store is far simpler and lets either side mount/unmount
 * independently.
 *
 * This store does NOT participate in persistence — the ref is
 * lifecycle-bound to the panel mount and meaningless across reloads.
 */

import { create } from 'zustand';

interface OracleViewState {
  /** Track div for drei's secondary `<View>`. Null when the panel
   *  is closed (the panel chrome is fully unmounted in that state). */
  trackRef: HTMLDivElement | null;
  setTrackRef: (ref: HTMLDivElement | null) => void;
}

export const useOracleViewStore = create<OracleViewState>((set) => ({
  trackRef: null,
  setTrackRef: (ref) => set({ trackRef: ref }),
}));
