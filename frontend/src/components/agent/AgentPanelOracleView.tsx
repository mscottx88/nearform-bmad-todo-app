/**
 * Story 6.7: replaces `AgentPanelOraclePlaceholder.tsx`. Renders the
 * 2D animated Oracle Frog SVG inside the agent panel's "aquarium
 * window" rectangle.
 *
 * Per user direction (2026-04-25):
 *   - "Replace the secondary view concept and the 3d frog with a
 *      2d neon outline looking budgett frog."
 *   - "The oracle frog only exists in the chat window, remove it
 *      from the pond."
 *
 * So the entire `<View>` / shared-canvas / 3D-frog architecture
 * was scrapped. The frog is now a pure SVG component that sits
 * in the panel's DOM. No drei, no track-ref store, no
 * EffectComposer interaction. The procedural-animation state
 * machine (idle / listening / thinking / speaking / success /
 * error) is unchanged at the data layer; only the rendering
 * surface flipped from Three.js → SVG.
 */

import { OracleFrogSVG } from './OracleFrogSVG';

export function AgentPanelOracleView() {
  return (
    <div className="agent-panel__oracle">
      <OracleFrogSVG />
    </div>
  );
}
