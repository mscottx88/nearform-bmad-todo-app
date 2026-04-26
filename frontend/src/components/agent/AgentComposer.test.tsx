import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

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

import { AgentComposer } from './AgentComposer';
import { useAgentStore } from '../../stores/useAgentStore';
import type { ChatMessage } from '../../types/agent';

function makeUserMsg(id: string, content: string): ChatMessage {
  return {
    id,
    sessionId: 'sess-1',
    role: 'user',
    content,
    skill: null,
    metadata: {},
    status: 'complete',
    error: null,
    createdAt: '2026-04-25T00:00:00Z',
  };
}

function resetStore(messages: ChatMessage[] = []) {
  useAgentStore.setState({
    panelOpen: true,
    activeSessionId: 'sess-1',
    sessions: [],
    messages,
    inputDraft: '',
    streamingMessageId: null,
    streamingBuffer: '',
  });
}

describe('AgentComposer history navigation (Up/Down at first character)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('Up at position 0 recalls the most recent user message', () => {
    resetStore([
      makeUserMsg('m1', 'first message'),
      makeUserMsg('m2', 'second message'),
      makeUserMsg('m3', 'third message'),
    ]);
    const { container } = render(<AgentComposer onSubmit={() => {}} />);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    expect(useAgentStore.getState().inputDraft).toBe('third message');
  });

  it('Up walks BACK one message per press', () => {
    resetStore([
      makeUserMsg('m1', 'first'),
      makeUserMsg('m2', 'second'),
      makeUserMsg('m3', 'third'),
    ]);
    const { container } = render(<AgentComposer onSubmit={() => {}} />);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(useAgentStore.getState().inputDraft).toBe('third');
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(useAgentStore.getState().inputDraft).toBe('second');
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(useAgentStore.getState().inputDraft).toBe('first');
    // Cap at the oldest message — pressing Up again is a no-op.
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(useAgentStore.getState().inputDraft).toBe('first');
  });

  it('Down walks FORWARD and exits history into the stashed draft', () => {
    resetStore([
      makeUserMsg('m1', 'first'),
      makeUserMsg('m2', 'second'),
    ]);
    // User typed something but didn't send.
    useAgentStore.setState({ inputDraft: 'in progress' });
    const { container } = render(<AgentComposer onSubmit={() => {}} />);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    // Up: stashes the draft, recalls 'second'.
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(useAgentStore.getState().inputDraft).toBe('second');
    textarea.setSelectionRange(0, 0);
    // Up again: 'first'.
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(useAgentStore.getState().inputDraft).toBe('first');
    // Down: back to 'second'.
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(useAgentStore.getState().inputDraft).toBe('second');
    // Down again: exits history, restores the stashed draft.
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(useAgentStore.getState().inputDraft).toBe('in progress');
  });

  it('Up at non-zero cursor position is NOT captured (native caret movement)', () => {
    resetStore([makeUserMsg('m1', 'previous')]);
    useAgentStore.setState({ inputDraft: 'mid-line' });
    const { container } = render(<AgentComposer onSubmit={() => {}} />);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    // Cursor in the middle of the existing draft.
    textarea.setSelectionRange(3, 3);

    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    // Draft unchanged — the recall path didn't fire.
    expect(useAgentStore.getState().inputDraft).toBe('mid-line');
  });

  it('typing resets the history pointer so the next Up starts at most-recent', () => {
    resetStore([
      makeUserMsg('m1', 'first'),
      makeUserMsg('m2', 'second'),
    ]);
    const { container } = render(<AgentComposer onSubmit={() => {}} />);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(useAgentStore.getState().inputDraft).toBe('second');
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(useAgentStore.getState().inputDraft).toBe('first');

    // User starts typing — change handler resets the pointer.
    fireEvent.change(textarea, { target: { value: 'something new' } });
    expect(useAgentStore.getState().inputDraft).toBe('something new');

    // Next Up at position 0 starts from the most recent again.
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(useAgentStore.getState().inputDraft).toBe('second');
  });

  it('does nothing when there is no user-message history', () => {
    resetStore([]);
    const { container } = render(<AgentComposer onSubmit={() => {}} />);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    expect(useAgentStore.getState().inputDraft).toBe('');
  });
});

// ─── Story 6.7: 'listening' state wiring ───────────────────────────────

describe('AgentComposer — Story 6.7 listening state', () => {
  beforeEach(() => {
    resetStore();
    useAgentStore.setState({ agentState: 'idle' });
  });

  it('focus + non-empty draft + no in-flight stream → "listening"', () => {
    useAgentStore.setState({ inputDraft: 'hello' });
    const { container } = render(<AgentComposer onSubmit={() => {}} />);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.focus(textarea);
    expect(useAgentStore.getState().agentState).toBe('listening');
  });

  it('blur reverts "listening" → "idle"', () => {
    useAgentStore.setState({ inputDraft: 'hello' });
    const { container } = render(<AgentComposer onSubmit={() => {}} />);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.focus(textarea);
    expect(useAgentStore.getState().agentState).toBe('listening');
    fireEvent.blur(textarea);
    expect(useAgentStore.getState().agentState).toBe('idle');
  });

  it('clearing the draft while focused reverts "listening" → "idle"', () => {
    useAgentStore.setState({ inputDraft: 'hi' });
    const { container } = render(<AgentComposer onSubmit={() => {}} />);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.focus(textarea);
    expect(useAgentStore.getState().agentState).toBe('listening');
    fireEvent.change(textarea, { target: { value: '' } });
    expect(useAgentStore.getState().agentState).toBe('idle');
  });

  it('focus + non-empty draft does NOT transition to "listening" while a stream is in flight', () => {
    useAgentStore.setState({
      inputDraft: 'mid-stream typing',
      streamingMessageId: 'in-flight',
      agentState: 'speaking',
    });
    const { container } = render(<AgentComposer onSubmit={() => {}} />);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.focus(textarea);
    // 'speaking' must not be clobbered by the listening branch.
    expect(useAgentStore.getState().agentState).toBe('speaking');
  });

  it('unmount clears a lingering "listening" state', () => {
    useAgentStore.setState({ inputDraft: 'typing' });
    const { container, unmount } = render(<AgentComposer onSubmit={() => {}} />);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.focus(textarea);
    expect(useAgentStore.getState().agentState).toBe('listening');
    unmount();
    expect(useAgentStore.getState().agentState).toBe('idle');
  });
});
