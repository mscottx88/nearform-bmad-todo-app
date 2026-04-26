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

describe('AgentPanelOracleView (Story 6.7 — 2D pivot)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('renders the agent-panel__oracle container with the SVG frog inside', () => {
    const { container } = render(<AgentPanelOracleView />);
    const oracle = container.querySelector('.agent-panel__oracle');
    expect(oracle).not.toBeNull();
    const svg = oracle?.querySelector('.oracle-frog-svg');
    expect(svg).not.toBeNull();
  });

  it('exposes the current agentState as a data-state attribute on the SVG', () => {
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
      const svg = container.querySelector('.oracle-frog-svg');
      expect(svg?.getAttribute('data-state')).toBe(s);
      unmount();
    }
  });
});
