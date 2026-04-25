/**
 * Top section of the agent panel — placeholder for Story 6.7's
 * Oracle-Frog `<View>` aquarium camera. 16:10 aspect rectangle with a
 * neon-cyan border, dark-water background, and a centred greyed-out
 * caption. 6.7 will swap this for `AgentPanelOracleView.tsx` and pipe
 * the secondary camera through the `children` slot — no panel
 * restructuring required.
 */

import type { ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

export function AgentPanelOraclePlaceholder({ children = null }: Props) {
  return (
    <div className="agent-panel__oracle">
      {children ?? (
        <div className="agent-panel__oracle-placeholder">
          oracle frog · arrives in story 6.7
        </div>
      )}
    </div>
  );
}
