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
    // Three stacked image layers for the RGB-split glitch effect.
    expect(oracle?.querySelectorAll('.oracle-frog__layer').length).toBe(3);
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

  it('serves the bitmap from /oracle-frog.png on every layer', () => {
    const { container } = render(<AgentPanelOracleView />);
    const layers = container.querySelectorAll('.oracle-frog__layer');
    layers.forEach((layer) => {
      expect((layer as HTMLImageElement).getAttribute('src')).toBe('/oracle-frog.png');
    });
  });
});
