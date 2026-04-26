import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import { AgentPanelOracleView } from './AgentPanelOracleView';
import { useAgentStore } from '../../stores/useAgentStore';
import { useOracleViewStore } from '../../stores/useOracleViewStore';

function resetStores() {
  useAgentStore.setState({
    panelOpen: false,
    activeSessionId: null,
    sessions: [],
    messages: [],
    inputDraft: '',
    streamingMessageId: null,
    streamingBuffer: '',
    agentState: 'idle',
    oraclePadPosition: null,
  });
  useOracleViewStore.setState({ trackRef: null });
}

describe('AgentPanelOracleView (Story 6.7 AC 5)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the DOM container with the existing agent-panel__oracle class', () => {
    const { container } = render(<AgentPanelOracleView />);
    const track = container.querySelector('.agent-panel__oracle');
    expect(track).not.toBeNull();
    expect(track?.tagName).toBe('DIV');
  });

  it('publishes its DOM ref into useOracleViewStore on mount', () => {
    expect(useOracleViewStore.getState().trackRef).toBeNull();
    render(<AgentPanelOracleView />);
    const ref = useOracleViewStore.getState().trackRef;
    expect(ref).not.toBeNull();
    expect(ref?.classList.contains('agent-panel__oracle')).toBe(true);
  });

  it('clears the track ref on unmount', () => {
    render(<AgentPanelOracleView />);
    expect(useOracleViewStore.getState().trackRef).not.toBeNull();
    cleanup();
    expect(useOracleViewStore.getState().trackRef).toBeNull();
  });

  it('does not depend on agentState — the secondary view reads it directly', () => {
    // The DOM container is a plain div; agentState transitions only
    // affect the OracleFrog's useFrame in PondScene's <Canvas>, not
    // the panel-side track div.
    const { container, rerender } = render(<AgentPanelOracleView />);
    const trackBefore = container.querySelector('.agent-panel__oracle');
    expect(trackBefore).not.toBeNull();
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
      rerender(<AgentPanelOracleView />);
      const trackAfter = container.querySelector('.agent-panel__oracle');
      expect(trackAfter).not.toBeNull();
      expect(trackAfter).toBe(trackBefore);
    }
  });
});
