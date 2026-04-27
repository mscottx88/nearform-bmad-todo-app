import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ChatMessage } from '../../types/agent';

// Mock the RephraseProposal renderer so this test file doesn't need
// to wire up React Query for the underlying useTodos / useUpdateTodo
// hooks. We only assert the dispatch — the renderer's own behaviour
// has its own test file.
vi.mock('./RephraseProposal', () => ({
  RephraseProposal: ({ targets }: { targets: string[] }) => (
    <div data-testid="rephrase-proposal-stub" data-targets={targets.join(',')} />
  ),
}));

// Importing AgentMessage AFTER the mock so the mocked module resolves.
import { AgentMessage } from './AgentMessage';

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

  // Story 6.3: when an assistant message carries
  // metadata.proposal.kind === 'text_rewrite', the rephrase renderer
  // mounts as a sibling of the bubble (NOT inside it).
  it('renders RephraseProposal sibling when metadata.proposal.kind is text_rewrite', () => {
    const { getByTestId } = render(
      <AgentMessage
        message={makeMessage('assistant', {
          content: 'Made it crisper.',
          metadata: {
            proposal: {
              kind: 'text_rewrite',
              payload: { suggestions: [], missing_fields: [] },
              targets: ['todo-1'],
              reasoning: 'Made it crisper.',
            },
          },
        })}
        isStreaming={false}
      />,
    );
    const stub = getByTestId('rephrase-proposal-stub');
    expect(stub.getAttribute('data-targets')).toBe('todo-1');
  });

  it('does not render any proposal renderer when metadata.proposal is missing', () => {
    const { queryByTestId } = render(
      <AgentMessage
        message={makeMessage('assistant', { metadata: {} })}
        isStreaming={false}
      />,
    );
    expect(queryByTestId('rephrase-proposal-stub')).toBeNull();
  });

  it('skips unknown proposal kinds', () => {
    const { queryByTestId } = render(
      <AgentMessage
        message={makeMessage('assistant', {
          metadata: {
            proposal: {
              kind: 'unknown_kind',
              payload: {},
              targets: ['todo-1'],
              reasoning: 'x',
            },
          },
        })}
        isStreaming={false}
      />,
    );
    expect(queryByTestId('rephrase-proposal-stub')).toBeNull();
  });

  // 2026-04-26: chat bubbles tag themselves with data-cursor="firefly"
  // so plain prose text doesn't trigger the I-beam glyph from the
  // global cursor-mode hook's selectable-text fallthrough. Interactive
  // children (TodoLink buttons, RephraseProposal accept/dismiss) still
  // infer 'point' because the ancestor walk hits them before this
  // attribute.
  it('marks the chat bubble with data-cursor="firefly" so prose stays on the firefly cursor', () => {
    const { container } = render(
      <AgentMessage message={makeMessage('assistant')} isStreaming={false} />,
    );
    const bubble = container.querySelector('.agent-message__bubble');
    expect(bubble).not.toBeNull();
    expect(bubble?.getAttribute('data-cursor')).toBe('firefly');
  });

  // Markdown tables in assistant prose render inside a NeonScrollbar
  // wrapper so a wide table scrolls horizontally with the project's
  // neon thumb instead of the OS default scrollbar. Functional check:
  // both the table element AND a NeonScrollbar track render.
  it('renders markdown tables wrapped in a NeonScrollbar', () => {
    const md = '| col1 | col2 |\n|------|------|\n| a    | b    |';
    const { container } = render(
      <AgentMessage
        message={makeMessage('assistant', { content: md })}
        isStreaming={false}
      />,
    );
    expect(container.querySelector('.agent-message__table')).not.toBeNull();
    // NeonScrollbar always renders its track DOM (visibility is
    // overflow-driven via CSS); presence proves the wrapper mounted.
    expect(container.querySelector('.neon-scrollbar')).not.toBeNull();
  });

  // Skill-handoff meta line (e.g. "↳ rephrase skill") surfaces
  // above the bubble when a turn routed to a non-default skill.
  // The chat skill is the default; its turns suppress the line.
  describe('skill-handoff meta line', () => {
    it('renders for an assistant turn from the rephrase skill', () => {
      const { container } = render(
        <AgentMessage
          message={makeMessage('assistant', { skill: 'rephrase' })}
          isStreaming={false}
        />,
      );
      const handoff = container.querySelector('.agent-message__skill-handoff');
      expect(handoff).not.toBeNull();
      expect(handoff?.textContent).toContain('rephrase');
    });

    it('replaces underscores with spaces (create_todo → "create todo")', () => {
      const { container } = render(
        <AgentMessage
          message={makeMessage('assistant', { skill: 'create_todo' })}
          isStreaming={false}
        />,
      );
      const handoff = container.querySelector('.agent-message__skill-handoff');
      expect(handoff?.textContent).toContain('create todo');
      // Underscore must NOT appear in the display.
      expect(handoff?.textContent).not.toContain('_');
    });

    it('does NOT render for the default chat skill', () => {
      const { container } = render(
        <AgentMessage
          message={makeMessage('assistant', { skill: 'chat' })}
          isStreaming={false}
        />,
      );
      expect(
        container.querySelector('.agent-message__skill-handoff'),
      ).toBeNull();
    });

    it('does NOT render when skill is null (e.g. legacy / pre-skill rows)', () => {
      const { container } = render(
        <AgentMessage
          message={makeMessage('assistant', { skill: null })}
          isStreaming={false}
        />,
      );
      expect(
        container.querySelector('.agent-message__skill-handoff'),
      ).toBeNull();
    });

    it('does NOT render for user turns even if skill is set', () => {
      // User turns don't have a routed skill in practice, but
      // defence in depth — the handoff line is for the assistant.
      const { container } = render(
        <AgentMessage
          message={makeMessage('user', { skill: 'rephrase' })}
          isStreaming={false}
        />,
      );
      expect(
        container.querySelector('.agent-message__skill-handoff'),
      ).toBeNull();
    });
  });
});
