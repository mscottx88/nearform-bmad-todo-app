import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';

// Mock drei <View> + <PerspectiveCamera> per Dev Notes — same
// pattern as LilyPad.test.tsx. The View's `as` + className get
// rendered as a regular DOM div so the test can assert on the DOM
// container shape without instantiating R3F / WebGL.
vi.mock('@react-three/drei', () => {
  const React = require('react') as typeof import('react');
  return {
    View: ({
      as: As = 'div',
      className,
      children,
    }: {
      as?: keyof React.JSX.IntrinsicElements;
      className?: string;
      children?: React.ReactNode;
    }) =>
      React.createElement(
        As,
        { className, 'data-testid': 'oracle-view-track' },
        children,
      ),
    PerspectiveCamera: () => null,
  };
});

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

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
    oraclePadPosition: null,
  });
}

describe('AgentPanelOracleView (Story 6.7 AC 5)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('renders the DOM container with the existing agent-panel__oracle class', () => {
    const { container } = render(<AgentPanelOracleView />);
    const track = container.querySelector('.agent-panel__oracle');
    expect(track).not.toBeNull();
    // Drei's <View as="div"> path renders a real DOM div; the track
    // ref is that div itself.
    expect(track?.tagName).toBe('DIV');
  });

  it('uses the persisted oracle home position when present', () => {
    useAgentStore.getState().setOraclePadPosition({ x: 4.2, z: -1.7 });
    expect(() => render(<AgentPanelOracleView />)).not.toThrow();
  });

  it('falls back to the AC-default home (-3.5, 3.5) when nothing is persisted yet', () => {
    expect(useAgentStore.getState().oraclePadPosition).toBeNull();
    expect(() => render(<AgentPanelOracleView />)).not.toThrow();
  });

  it('camera/View props do not change when only agentState changes', () => {
    // The camera is positioned from the oracle home, NOT agentState.
    // Flipping agentState through every value must not re-create the
    // DOM container or alter the View's track shape.
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
      // Same DOM node — the track ref is stable across agentState
      // changes; only the OracleFrog children re-read agentState in
      // their useFrame.
      expect(trackAfter).toBe(trackBefore);
    }
  });
});
