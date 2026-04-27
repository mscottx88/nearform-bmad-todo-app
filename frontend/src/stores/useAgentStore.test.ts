import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ChatMessage, ChatSessionSummary, SseEvent } from '../types/agent';

// Mock the API client BEFORE importing the store so the persist
// middleware + the imports it triggers see the stub.
vi.mock('../api/agentApi', () => ({
  listSessions: vi.fn(async () => [] as ChatSessionSummary[]),
  getSession: vi.fn(),
  getMessages: vi.fn(async () => [] as ChatMessage[]),
  createSession: vi.fn(async () => ({
    id: 'session-1',
    title: null,
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  })),
  deleteSession: vi.fn(async () => {}),
  cancelChat: vi.fn(async () => {}),
}));

// Mock the SSE streamer so sendMessage doesn't try to fetch.
vi.mock('../hooks/useAgentSse', () => ({
  streamAgentChat: vi.fn(async () => ({ abort: vi.fn() })),
}));

import * as agentApi from '../api/agentApi';
import { streamAgentChat } from '../hooks/useAgentSse';
import { useAgentStore } from './useAgentStore';

const mockedAgentApi = agentApi as unknown as {
  listSessions: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  getMessages: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
  deleteSession: ReturnType<typeof vi.fn>;
  cancelChat: ReturnType<typeof vi.fn>;
};
const mockedStream = streamAgentChat as unknown as ReturnType<typeof vi.fn>;

function resetStore() {
  useAgentStore.setState({
    panelOpen: false,
    activeSessionId: null,
    // Story 6.9 — reset to the in-code default so per-test panelWidth
    // overrides don't leak between tests.
    panelWidth: 520,
    sessions: [],
    messages: [],
    inputDraft: '',
    streamingMessageId: null,
    streamingBuffer: '',
    // Story 6.7
    agentState: 'idle',
  });
}

describe('useAgentStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    mockedAgentApi.listSessions.mockResolvedValue([]);
    mockedAgentApi.getMessages.mockResolvedValue([]);
    mockedAgentApi.createSession.mockResolvedValue({
      id: 'session-new',
      title: null,
      createdAt: '2026-04-25T00:00:00Z',
      updatedAt: '2026-04-25T00:00:00Z',
    });
    mockedStream.mockResolvedValue({ abort: vi.fn() });
  });

  it('openPanel + closePanel + togglePanel mutate panelOpen', () => {
    const s = useAgentStore.getState();
    s.openPanel();
    expect(useAgentStore.getState().panelOpen).toBe(true);
    s.closePanel();
    expect(useAgentStore.getState().panelOpen).toBe(false);
    s.togglePanel();
    expect(useAgentStore.getState().panelOpen).toBe(true);
    s.togglePanel();
    expect(useAgentStore.getState().panelOpen).toBe(false);
  });

  it('switchSession sets activeSessionId and loads messages', async () => {
    const messages: ChatMessage[] = [
      {
        id: 'm1',
        sessionId: 'sess-a',
        role: 'user',
        content: 'hi',
        skill: null,
        metadata: {},
        status: 'complete',
        error: null,
        createdAt: '2026-04-25T00:00:00Z',
      },
    ];
    mockedAgentApi.getMessages.mockResolvedValueOnce(messages);

    await useAgentStore.getState().switchSession('sess-a');

    expect(useAgentStore.getState().activeSessionId).toBe('sess-a');
    expect(useAgentStore.getState().messages).toEqual(messages);
    expect(mockedAgentApi.getMessages).toHaveBeenCalledWith('sess-a');
  });

  it('sendMessage inserts optimistic user + assistant rows and starts a stream', async () => {
    useAgentStore.setState({ activeSessionId: 'sess-a' });
    await useAgentStore.getState().sendMessage('hello');

    const messages = useAgentStore.getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('hello');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('');
    expect(messages[1].status).toBe('streaming');
    expect(useAgentStore.getState().streamingMessageId).toBe(messages[1].id);
    expect(mockedStream).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-a', content: 'hello', skill: null }),
    );
  });

  it('sendMessage refuses empty / whitespace-only content', async () => {
    useAgentStore.setState({ activeSessionId: 'sess-a' });
    await useAgentStore.getState().sendMessage('   ');
    expect(useAgentStore.getState().messages).toEqual([]);
    expect(mockedStream).not.toHaveBeenCalled();
  });

  it('sendMessage creates a session if none is active', async () => {
    expect(useAgentStore.getState().activeSessionId).toBeNull();
    await useAgentStore.getState().sendMessage('hi');
    expect(mockedAgentApi.createSession).toHaveBeenCalled();
    expect(useAgentStore.getState().activeSessionId).toBe('session-new');
  });

  it('ingestSseEvent handles start/chunk/done sequence', async () => {
    useAgentStore.setState({ activeSessionId: 'sess-a' });
    await useAgentStore.getState().sendMessage('hi');
    const optimisticId = useAgentStore.getState().streamingMessageId;
    expect(optimisticId).not.toBeNull();

    const events: SseEvent[] = [
      {
        type: 'start',
        session_id: 'sess-a',
        skill: 'chat',
        message_id: 'server-msg-1',
      },
      { type: 'chunk', text: 'hello ' },
      { type: 'chunk', text: 'world' },
      { type: 'done' },
    ];
    for (const e of events) useAgentStore.getState().ingestSseEvent(e);

    const state = useAgentStore.getState();
    // Streaming flag cleared on done.
    expect(state.streamingMessageId).toBeNull();
    expect(state.streamingBuffer).toBe('');
    // Assistant row was rebound to the server-issued id and shows
    // the concatenated chunk content.
    const assistant = state.messages.find((m) => m.id === 'server-msg-1');
    expect(assistant?.content).toBe('hello world');
    expect(assistant?.status).toBe('complete');
  });

  // Story 6.3: proposal events arrive between `start` and the first
  // `chunk`. They write onto the streaming bubble's `metadata.proposal`
  // without touching content / streamingBuffer.
  it('ingestSseEvent handles proposal event by writing metadata.proposal', async () => {
    useAgentStore.setState({ activeSessionId: 'sess-a' });
    await useAgentStore.getState().sendMessage('rephrase this');
    useAgentStore.getState().ingestSseEvent({
      type: 'start',
      session_id: 'sess-a',
      skill: 'rephrase',
      message_id: 'server-msg-1',
    });
    useAgentStore.getState().ingestSseEvent({
      type: 'proposal',
      kind: 'text_rewrite',
      payload: {
        suggestions: [
          { field: 'text', original: 'old', revised: 'new', reason: 'clearer' },
        ],
        missing_fields: ['due_date'],
      },
      targets: ['todo-1'],
      reasoning: 'Made it crisper.',
    });

    const state = useAgentStore.getState();
    const assistant = state.messages.find((m) => m.id === 'server-msg-1');
    expect(assistant).toBeDefined();
    const proposal = assistant?.metadata.proposal as
      | { kind: string; targets: string[]; reasoning: string; payload: { missing_fields: string[] } }
      | undefined;
    expect(proposal?.kind).toBe('text_rewrite');
    expect(proposal?.targets).toEqual(['todo-1']);
    expect(proposal?.reasoning).toBe('Made it crisper.');
    expect(proposal?.payload.missing_fields).toEqual(['due_date']);
    // Content and streamingBuffer must NOT be clobbered by proposal
    // ingest — those are the chunk pipeline's concern.
    expect(assistant?.content).toBe('');
    expect(state.streamingBuffer).toBe('');
  });

  it('subsequent chunk after proposal still appends to content', async () => {
    useAgentStore.setState({ activeSessionId: 'sess-a' });
    await useAgentStore.getState().sendMessage('rephrase this');
    useAgentStore.getState().ingestSseEvent({
      type: 'start',
      session_id: 'sess-a',
      skill: 'rephrase',
      message_id: 'server-msg-1',
    });
    useAgentStore.getState().ingestSseEvent({
      type: 'proposal',
      kind: 'text_rewrite',
      payload: { suggestions: [], missing_fields: [] },
      targets: ['todo-1'],
      reasoning: 'Done.',
    });
    useAgentStore.getState().ingestSseEvent({ type: 'chunk', text: 'Done.' });

    const assistant = useAgentStore
      .getState()
      .messages.find((m) => m.id === 'server-msg-1');
    expect(assistant?.content).toBe('Done.');
    // Proposal metadata still present after the chunk landed.
    expect(
      (assistant?.metadata as { proposal?: { kind: string } }).proposal?.kind,
    ).toBe('text_rewrite');
  });

  it('ingestSseEvent handles error event by flipping bubble to failed state', async () => {
    useAgentStore.setState({ activeSessionId: 'sess-a' });
    await useAgentStore.getState().sendMessage('hi');

    useAgentStore.getState().ingestSseEvent({
      type: 'start',
      session_id: 'sess-a',
      skill: 'chat',
      message_id: 'server-msg-1',
    });
    useAgentStore.getState().ingestSseEvent({
      type: 'error',
      code: 'agent_crew_failed',
      message: 'boom',
      recoverable: false,
    });

    const state = useAgentStore.getState();
    expect(state.streamingMessageId).toBeNull();
    const assistant = state.messages.find((m) => m.id === 'server-msg-1');
    expect(assistant?.status).toBe('failed');
    expect(assistant?.content).toBe('Agent run failed.');
    expect(assistant?.error).toBe('boom');
  });

  it('cancelStreaming aborts the stream and marks the bubble cancelled', async () => {
    const abort = vi.fn();
    mockedStream.mockResolvedValueOnce({ abort });
    useAgentStore.setState({ activeSessionId: 'sess-a' });
    await useAgentStore.getState().sendMessage('hi');
    useAgentStore.getState().ingestSseEvent({
      type: 'start',
      session_id: 'sess-a',
      skill: 'chat',
      message_id: 'server-msg-1',
    });

    await useAgentStore.getState().cancelStreaming();

    expect(abort).toHaveBeenCalled();
    expect(mockedAgentApi.cancelChat).toHaveBeenCalledWith('sess-a');
    expect(useAgentStore.getState().streamingMessageId).toBeNull();
    const assistant = useAgentStore
      .getState()
      .messages.find((m) => m.id === 'server-msg-1');
    expect(assistant?.status).toBe('cancelled');
  });

  it('deleteSession falls back to most-recent remaining session when active is deleted', async () => {
    const sessions: ChatSessionSummary[] = [
      { id: 'a', title: 'A', createdAt: '2026-04-25T00:00:00Z', updatedAt: '2026-04-25T00:01:00Z' },
      { id: 'b', title: 'B', createdAt: '2026-04-25T00:00:00Z', updatedAt: '2026-04-25T00:00:30Z' },
    ];
    useAgentStore.setState({ sessions, activeSessionId: 'a' });

    await useAgentStore.getState().deleteSession('a');

    expect(mockedAgentApi.deleteSession).toHaveBeenCalledWith('a');
    expect(useAgentStore.getState().sessions.map((s) => s.id)).toEqual(['b']);
    expect(useAgentStore.getState().activeSessionId).toBe('b');
  });

  it('deleteSession creates a fresh session when no others remain', async () => {
    useAgentStore.setState({
      sessions: [
        {
          id: 'only',
          title: 'O',
          createdAt: '2026-04-25T00:00:00Z',
          updatedAt: '2026-04-25T00:00:00Z',
        },
      ],
      activeSessionId: 'only',
    });

    await useAgentStore.getState().deleteSession('only');

    expect(mockedAgentApi.createSession).toHaveBeenCalled();
    expect(useAgentStore.getState().activeSessionId).toBe('session-new');
  });
});

// ─── Story 6.7: Oracle-frog state machine ────────────────────────────

describe('useAgentStore — Story 6.7 agentState transitions', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    mockedAgentApi.listSessions.mockResolvedValue([]);
    mockedAgentApi.getMessages.mockResolvedValue([]);
    mockedAgentApi.createSession.mockResolvedValue({
      id: 'session-new',
      title: null,
      createdAt: '2026-04-25T00:00:00Z',
      updatedAt: '2026-04-25T00:00:00Z',
    });
    mockedStream.mockResolvedValue({ abort: vi.fn() });
  });

  it('initial agentState is "idle"', () => {
    expect(useAgentStore.getState().agentState).toBe('idle');
  });

  it('start event flips agentState to "thinking"', async () => {
    useAgentStore.setState({ activeSessionId: 'sess-a' });
    await useAgentStore.getState().sendMessage('hi');
    useAgentStore.getState().ingestSseEvent({
      type: 'start',
      session_id: 'sess-a',
      skill: 'chat',
      message_id: 'm-1',
    });
    expect(useAgentStore.getState().agentState).toBe('thinking');
  });

  it('chunk while thinking transitions to "speaking"; further chunks stay speaking', async () => {
    useAgentStore.setState({ activeSessionId: 'sess-a' });
    await useAgentStore.getState().sendMessage('hi');
    useAgentStore.getState().ingestSseEvent({
      type: 'start',
      session_id: 'sess-a',
      skill: 'chat',
      message_id: 'm-1',
    });
    expect(useAgentStore.getState().agentState).toBe('thinking');

    useAgentStore.getState().ingestSseEvent({ type: 'chunk', text: 'hi ' });
    expect(useAgentStore.getState().agentState).toBe('speaking');

    useAgentStore.getState().ingestSseEvent({ type: 'chunk', text: 'there' });
    expect(useAgentStore.getState().agentState).toBe('speaking');
  });

  it('done event sets "success" and reverts to "idle" after 1200ms', async () => {
    vi.useFakeTimers();
    try {
      useAgentStore.setState({ activeSessionId: 'sess-a' });
      await useAgentStore.getState().sendMessage('hi');
      useAgentStore.getState().ingestSseEvent({
        type: 'start',
        session_id: 'sess-a',
        skill: 'chat',
        message_id: 'm-1',
      });
      useAgentStore.getState().ingestSseEvent({ type: 'chunk', text: 'hi' });
      useAgentStore.getState().ingestSseEvent({ type: 'done' });
      expect(useAgentStore.getState().agentState).toBe('success');

      vi.advanceTimersByTime(1199);
      expect(useAgentStore.getState().agentState).toBe('success');
      vi.advanceTimersByTime(1);
      expect(useAgentStore.getState().agentState).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('error event sets "error" and reverts to "idle" after 2000ms', async () => {
    vi.useFakeTimers();
    try {
      useAgentStore.setState({ activeSessionId: 'sess-a' });
      await useAgentStore.getState().sendMessage('hi');
      useAgentStore.getState().ingestSseEvent({
        type: 'start',
        session_id: 'sess-a',
        skill: 'chat',
        message_id: 'm-1',
      });
      useAgentStore.getState().ingestSseEvent({
        type: 'error',
        code: 'agent_crew_failed',
        message: 'boom',
        recoverable: false,
      });
      expect(useAgentStore.getState().agentState).toBe('error');

      vi.advanceTimersByTime(1999);
      expect(useAgentStore.getState().agentState).toBe('error');
      vi.advanceTimersByTime(1);
      expect(useAgentStore.getState().agentState).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancelStreaming clears the pending success → idle revert and forces idle', async () => {
    vi.useFakeTimers();
    try {
      useAgentStore.setState({ activeSessionId: 'sess-a' });
      await useAgentStore.getState().sendMessage('hi');
      useAgentStore.getState().ingestSseEvent({
        type: 'start',
        session_id: 'sess-a',
        skill: 'chat',
        message_id: 'm-1',
      });
      useAgentStore.getState().ingestSseEvent({ type: 'done' });
      // The done handler scheduled a 1200ms revert; cancelStreaming
      // should clear it AND immediately set idle.
      await useAgentStore.getState().cancelStreaming();
      // Even after enough time for the original timer to have fired,
      // agentState must remain 'idle' because cancelStreaming forced
      // it and cleared the pending revert.
      vi.advanceTimersByTime(5000);
      expect(useAgentStore.getState().agentState).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a fresh start cancels the pending success-revert from the previous turn', async () => {
    vi.useFakeTimers();
    try {
      useAgentStore.setState({ activeSessionId: 'sess-a' });
      await useAgentStore.getState().sendMessage('first');
      useAgentStore.getState().ingestSseEvent({
        type: 'start',
        session_id: 'sess-a',
        skill: 'chat',
        message_id: 'm-1',
      });
      useAgentStore.getState().ingestSseEvent({ type: 'done' });
      expect(useAgentStore.getState().agentState).toBe('success');

      // 600ms in — fresh send before the 1200ms revert fires.
      vi.advanceTimersByTime(600);
      await useAgentStore.getState().sendMessage('second');
      useAgentStore.getState().ingestSseEvent({
        type: 'start',
        session_id: 'sess-a',
        skill: 'chat',
        message_id: 'm-2',
      });
      // Even after the original 1200ms timer should have expired, the
      // new turn's 'thinking' state must not have been clobbered by a
      // late `success → idle` from the previous turn.
      vi.advanceTimersByTime(2000);
      expect(useAgentStore.getState().agentState).toBe('thinking');
    } finally {
      vi.useRealTimers();
    }
  });

  it('switchSession resets agentState to "idle"', async () => {
    useAgentStore.setState({ activeSessionId: 'sess-a', agentState: 'thinking' });
    await useAgentStore.getState().switchSession('sess-b');
    expect(useAgentStore.getState().agentState).toBe('idle');
  });

  it('setAgentState directly sets the field', () => {
    useAgentStore.getState().setAgentState('listening');
    expect(useAgentStore.getState().agentState).toBe('listening');
    useAgentStore.getState().setAgentState('idle');
    expect(useAgentStore.getState().agentState).toBe('idle');
  });

  it('persist partialize excludes agentState (per-session)', () => {
    useAgentStore.setState({
      panelOpen: true,
      activeSessionId: 'sess-x',
      agentState: 'thinking',
    });
    const persisted = JSON.parse(localStorage.getItem('agent-store-v1') ?? '{}');
    expect(persisted.state).toBeDefined();
    expect(persisted.state.panelOpen).toBe(true);
    expect(persisted.state.activeSessionId).toBe('sess-x');
    // agentState is per-session; partialize must exclude it.
    expect(persisted.state.agentState).toBeUndefined();
  });
});

// ─── Story 6.9: panel width + persistence ─────────────────────────────

describe('useAgentStore — Story 6.9 panelWidth', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });

  it('initial panelWidth is 520 (default)', () => {
    expect(useAgentStore.getState().panelWidth).toBe(520);
  });

  it('setPanelWidth updates state', () => {
    useAgentStore.getState().setPanelWidth(600);
    expect(useAgentStore.getState().panelWidth).toBe(600);
  });

  it('setPanelWidth triggers persist with panelWidth in payload', () => {
    useAgentStore.getState().setPanelWidth(525);
    const persisted = JSON.parse(
      localStorage.getItem('agent-store-v1') ?? '{}',
    );
    expect(persisted.state).toBeDefined();
    expect(persisted.state.panelWidth).toBe(525);
  });

  it('rehydrate from older localStorage shape (no panelWidth) falls back to the in-code default', async () => {
    // Simulate a pre-6.9 persisted entry with only the original
    // partialized fields. zustand-persist's default merge spreads
    // currentState first then persistedState, so missing keys keep
    // their in-code default (currently 520 — see
    // AGENT_PANEL_DEFAULT_WIDTH in useAgentStore.ts).
    localStorage.setItem(
      'agent-store-v1',
      JSON.stringify({
        state: { panelOpen: true, activeSessionId: 'sess-legacy' },
        version: 0,
      }),
    );
    // Force a fresh hydrate from the stub.
    await useAgentStore.persist.rehydrate();
    const state = useAgentStore.getState();
    expect(state.panelOpen).toBe(true);
    expect(state.activeSessionId).toBe('sess-legacy');
    expect(state.panelWidth).toBe(520);
  });
});
