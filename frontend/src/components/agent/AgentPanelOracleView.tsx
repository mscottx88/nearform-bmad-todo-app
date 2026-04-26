/**
 * Story 6.7: replaces `AgentPanelOraclePlaceholder.tsx`. Renders the
 * DOM rectangle that drei's secondary `<View>` (mounted inside the
 * shared `<Canvas>` over in PondScene.tsx) tracks via
 * `getBoundingClientRect()`.
 *
 * This component is intentionally **DOM-only** — no `<View>` here.
 * The `<View>` lives inside the Canvas (PondScene's `<OracleAquariumView>`)
 * and reads its track ref from `useOracleViewStore`. That pattern
 * (suggested by the story's Dev Notes) avoids drei's tunnel-rat
 * portal — putting the View directly inside the Canvas keeps the
 * render order predictable, which matters because the main scene's
 * `<EffectComposer>` and the View's per-frame scissor render both
 * use `useFrame` and we need the View to run AFTER the composer to
 * paint OVER its bloomed output without being clobbered.
 *
 * Lifecycle:
 *   - Mount: publish the div ref into the store; remove on unmount.
 *   - The panel re-mounts on every false→true `panelOpen` flip
 *     (AgentPanel returns null when closed). Each fresh mount
 *     creates a fresh DOM node; the store's ref tracks it via
 *     useLayoutEffect so drei's per-frame rect-measure picks up
 *     the new element on the very next animation frame.
 */

import { useLayoutEffect, useRef } from 'react';
import { useOracleViewStore } from '../../stores/useOracleViewStore';

export function AgentPanelOracleView() {
  const localRef = useRef<HTMLDivElement>(null);
  const setTrackRef = useOracleViewStore((s) => s.setTrackRef);

  // useLayoutEffect (vs useEffect) so the ref is published BEFORE
  // the next paint — drei's per-frame rect-read in PondScene's
  // <View> shouldn't see a transient null between the panel's
  // mount and the effect.
  useLayoutEffect(() => {
    setTrackRef(localRef.current);
    return () => setTrackRef(null);
  }, [setTrackRef]);

  return <div ref={localRef} className="agent-panel__oracle" />;
}
