import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

vi.mock('../../api/agentApi', () => ({
  listSessions: vi.fn(async () => []),
  getSession: vi.fn(),
  getMessages: vi.fn(async () => []),
  createSession: vi.fn(async () => ({
    id: 'sess-new',
    title: null,
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  })),
  deleteSession: vi.fn(async () => {}),
  cancelChat: vi.fn(async () => {}),
}));

vi.mock('../../hooks/useAgentSse', () => ({
  streamAgentChat: vi.fn(async () => ({ abort: vi.fn() })),
}));

// Story 6.7: mock @react-three/drei's <View> + <PerspectiveCamera>
// so the AgentPanel test doesn't try to instantiate R3F. We render
// the View as a plain div with the same className/track shape so
// existing assertions on `.agent-panel__oracle` still pass.
vi.mock('@react-three/drei', () => {
  const React = require('react') as typeof import('react');
  return {
    View: ({
      as: As = 'div',
      className,
      style,
      children,
    }: {
      as?: keyof React.JSX.IntrinsicElements;
      className?: string;
      style?: React.CSSProperties;
      children?: React.ReactNode;
    }) => React.createElement(As, { className, style }, children),
    PerspectiveCamera: () => null,
  };
});

// Sub the @react-three/fiber pieces too — OracleFrog uses useFrame.
vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

import { AgentPanel } from './AgentPanel';
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
  });
}

describe('AgentPanel', () => {
  beforeEach(() => {
    resetStore();
  });

  it('renders nothing while panelOpen is false', () => {
    const { container } = render(<AgentPanel />);
    expect(container.querySelector('.agent-panel')).toBeNull();
  });

  it('renders the three-section drawer when panelOpen is true', () => {
    useAgentStore.setState({ panelOpen: true });
    render(<AgentPanel />);
    expect(document.querySelector('.agent-panel')).not.toBeNull();
    expect(document.querySelector('.agent-panel__section--oracle')).not.toBeNull();
    expect(document.querySelector('.agent-panel__section--chat')).not.toBeNull();
    expect(
      document.querySelector('.agent-panel__section--composer'),
    ).not.toBeNull();
    // Two divider rules between the three sections.
    expect(document.querySelectorAll('.agent-panel__divider')).toHaveLength(2);
  });

  it('renders the AgentPanelOracleView (replaces 6.2 placeholder per Story 6.7)', () => {
    useAgentStore.setState({ panelOpen: true });
    render(<AgentPanel />);
    // The mocked drei View renders as a div with the same
    // agent-panel__oracle className the placeholder used. The
    // surrounding section--oracle wrapper still drives the 16:10
    // aspect-ratio rule.
    expect(document.querySelector('.agent-panel__section--oracle')).not.toBeNull();
    expect(document.querySelector('.agent-panel__oracle')).not.toBeNull();
  });

  it('Escape closes the panel when the composer is unfocused', () => {
    useAgentStore.setState({ panelOpen: true });
    render(<AgentPanel />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(useAgentStore.getState().panelOpen).toBe(false);
  });

  it('Escape with focused composer + draft clears the draft (does NOT close)', () => {
    useAgentStore.setState({ panelOpen: true, inputDraft: 'half a thought' });
    render(<AgentPanel />);
    const composer = document.querySelector('textarea.agent-composer');
    expect(composer).not.toBeNull();
    (composer as HTMLTextAreaElement).focus();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(useAgentStore.getState().panelOpen).toBe(true);
    expect(useAgentStore.getState().inputDraft).toBe('');
  });

  it('Escape with focused composer but EMPTY draft closes the panel', () => {
    useAgentStore.setState({ panelOpen: true, inputDraft: '' });
    render(<AgentPanel />);
    const composer = document.querySelector('textarea.agent-composer');
    (composer as HTMLTextAreaElement).focus();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(useAgentStore.getState().panelOpen).toBe(false);
  });

  it('close button calls closePanel', () => {
    useAgentStore.setState({ panelOpen: true });
    render(<AgentPanel />);
    const closeBtn = document.querySelector('.agent-btn--close') as HTMLButtonElement;
    fireEvent.click(closeBtn);
    expect(useAgentStore.getState().panelOpen).toBe(false);
  });
});
