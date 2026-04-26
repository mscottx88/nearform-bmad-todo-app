/**
 * Story 6.7: replaces `AgentPanelOraclePlaceholder.tsx`. Renders
 * the bitmap-based Oracle Frog (with glitch FX) inside the agent
 * panel's "aquarium window" rectangle.
 *
 * Per user direction (2026-04-25):
 *   - "Can we just use a bitmap instead and can you apply small
 *      glitch effects to give it a techie feel?"
 *   - The bitmap is a transparent-background neon-frog PNG; drop
 *     it into `frontend/public/oracle-frog.png`. Vite serves
 *     `frontend/public/*` at the site root automatically.
 */

import { OracleFrogImage } from './OracleFrogImage';

export function AgentPanelOracleView() {
  return (
    <div className="agent-panel__oracle">
      <OracleFrogImage />
    </div>
  );
}
