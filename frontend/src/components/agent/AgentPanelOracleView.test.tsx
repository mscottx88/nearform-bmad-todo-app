import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

import { AgentPanelOracleView } from './AgentPanelOracleView';
import { useAgentStore } from '../../stores/useAgentStore';

function resetStore() {
  useAgentStore.setState({
    panelOpen: false,
    activeSessionId: null,
    sessions: [],
    messages: [],
    inputDraft: '',
    streamingMessageId: null,
    streamingBuffer: '',
    agentState: 'idle',
  });
}

describe('AgentPanelOracleView (Story 6.7 — bitmap pivot)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('renders the agent-panel__oracle container with the frog image inside', () => {
    const { container } = render(<AgentPanelOracleView />);
    const oracle = container.querySelector('.agent-panel__oracle');
    expect(oracle).not.toBeNull();
    const frog = oracle?.querySelector('.oracle-frog');
    expect(frog).not.toBeNull();
    // 3 RGB-split layers + 1 smile overlay = 4 image layers.
    expect(oracle?.querySelectorAll('.oracle-frog__layer').length).toBe(4);
    // The smile-specific layer is the one tagged with .oracle-frog__smile.
    expect(oracle?.querySelector('.oracle-frog__smile')).not.toBeNull();
  });

  it('exposes the current agentState as a data-state attribute on the wrapper', () => {
    const states: Array<'idle' | 'listening' | 'thinking' | 'speaking' | 'success' | 'error'> = [
      'idle',
      'listening',
      'thinking',
      'speaking',
      'success',
      'error',
    ];
    for (const s of states) {
      useAgentStore.setState({ agentState: s });
      const { container, unmount } = render(<AgentPanelOracleView />);
      const frog = container.querySelector('.oracle-frog');
      expect(frog?.getAttribute('data-state')).toBe(s);
      unmount();
    }
  });

  it('serves the closed-mouth bitmap on the RGB-split layers and the smile bitmap on the mouth-flap overlay', () => {
    const { container } = render(<AgentPanelOracleView />);
    const baseLayers = container.querySelectorAll(
      '.oracle-frog__layer:not(.oracle-frog__smile)',
    );
    expect(baseLayers.length).toBe(3);
    baseLayers.forEach((layer) => {
      expect((layer as HTMLImageElement).getAttribute('src')).toBe('/oracle-frog.png');
    });
    const smile = container.querySelector('.oracle-frog__smile') as HTMLImageElement;
    expect(smile).not.toBeNull();
    expect(smile.getAttribute('src')).toBe('/oracle-frog-smile.png');
  });
});
