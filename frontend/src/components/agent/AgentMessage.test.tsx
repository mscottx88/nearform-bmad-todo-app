import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AgentMessage } from './AgentMessage';
import type { ChatMessage } from '../../types/agent';

function makeMessage(role: ChatMessage['role'], overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    sessionId: 'sess-1',
    role,
    content: 'hello world',
    skill: null,
    metadata: {},
    status: 'complete',
    error: null,
    createdAt: '2026-04-25T00:00:00Z',
    ...overrides,
  };
}

describe('AgentMessage', () => {
  it('renders a user bubble with the user variant class', () => {
    const { container } = render(
      <AgentMessage message={makeMessage('user')} isStreaming={false} />,
    );
    const root = container.firstElementChild;
    expect(root?.className).toContain('agent-message--user');
    expect(root?.getAttribute('data-role')).toBe('user');
  });

  it('renders an assistant bubble with the assistant variant class', () => {
    const { container } = render(
      <AgentMessage message={makeMessage('assistant')} isStreaming={false} />,
    );
    const root = container.firstElementChild;
    expect(root?.className).toContain('agent-message--assistant');
  });

  it('uses the meta variant for system role', () => {
    const { container } = render(
      <AgentMessage message={makeMessage('system')} isStreaming={false} />,
    );
    const root = container.firstElementChild;
    expect(root?.className).toContain('agent-message--meta');
  });

  it('uses the meta variant for tool role', () => {
    const { container } = render(
      <AgentMessage message={makeMessage('tool')} isStreaming={false} />,
    );
    const root = container.firstElementChild;
    expect(root?.className).toContain('agent-message--meta');
  });

  it('shows the thinking indicator while assistant is streaming and content is empty', () => {
    const { container } = render(
      <AgentMessage
        message={makeMessage('assistant', { content: '' })}
        isStreaming
      />,
    );
    expect(container.querySelector('.agent-thinking')).not.toBeNull();
    expect(container.querySelector('.agent-thinking__dot')).not.toBeNull();
  });

  it('hides the thinking indicator once content arrives', () => {
    const { container } = render(
      <AgentMessage
        message={makeMessage('assistant', { content: 'first chunk' })}
        isStreaming
      />,
    );
    expect(container.querySelector('.agent-thinking')).toBeNull();
    expect(container.textContent).toContain('first chunk');
  });

  it('flips to failed visual state for status="failed"', () => {
    const { container } = render(
      <AgentMessage
        message={makeMessage('assistant', { content: 'Agent run failed.', status: 'failed' })}
        isStreaming={false}
      />,
    );
    expect(container.firstElementChild?.className).toContain('agent-message--failed');
  });
});
