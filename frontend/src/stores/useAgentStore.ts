/**
 * Story 6.2: Zustand store for the agent chat panel.
 *
 * Holds the panel's open/close state, the active session, message list,
 * draft composer text, and the in-flight streaming message id.
 *
 * Only `panelOpen` and `activeSessionId` survive page reloads (via
 * Zustand's `persist` middleware) — the message list is refetched on
 * panel open / session switch, and the streaming buffer is by
 * definition transient.
 *
 * The store is the single mutation surface for SSE events:
 * `useAgentSse`'s `onEvent` callback dispatches into `ingestSseEvent`,
 * which mutates the active streaming message in place. No React state
 * for individual chunks — Zustand handles the high-frequency updates
 * without re-rendering parents.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as agentApi from '../api/agentApi';
import { streamAgentChat, type AgentChatStreamHandle } from '../hooks/useAgentSse';
import type {
  ChatMessage,
  ChatSessionSummary,
  SseEvent,
} from '../types/agent';

export interface AgentState {
  panelOpen: boolean;
  activeSessionId: string | null;
  sessions: ChatSessionSummary[];
  messages: ChatMessage[];
  inputDraft: string;
  /**
   * In-flight assistant message id; `null` when idle. The id is the
   * UUID returned by the backend in the `start` SSE event payload — so
   * the store can match server-side ordering even if the optimistic
   * client-side id was different.
   */
  streamingMessageId: string | null;
  /** Accumulated chunks for the streaming message (mirror of `messages[i].content`). */
  streamingBuffer: string;

  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  setDraft: (draft: string) => void;

  refreshSessions: () => Promise<void>;
  newSession: () => Promise<void>;
  switchSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  loadActiveMessages: () => Promise<void>;

  sendMessage: (content: string) => Promise<void>;
  ingestSseEvent: (event: SseEvent) => void;
  cancelStreaming: () => Promise<void>;
}

interface PersistedShape {
  panelOpen: boolean;
  activeSessionId: string | null;
}

/** Stable client-side id used for the optimistic assistant placeholder
 *  inserted before the first SSE `start` event arrives. The server's
 *  real assistant_message_id replaces this on `start`. */
const OPTIMISTIC_ASSISTANT_PREFIX = 'optimistic-assistant-';

function makeOptimisticId(): string {
  return `${OPTIMISTIC_ASSISTANT_PREFIX}${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/** Outside of state because abort handles aren't serialisable; we only
 *  need them for the lifetime of one stream. */
let activeStreamHandle: AgentChatStreamHandle | null = null;
/** The optimistic id that the next `start` event should rebind. */
let pendingOptimisticAssistantId: string | null = null;

export const useAgentStore = create<AgentState>()(
  persist(
    (set, get) => ({
      panelOpen: false,
      activeSessionId: null,
      sessions: [],
      messages: [],
      inputDraft: '',
      streamingMessageId: null,
      streamingBuffer: '',

      openPanel: () => set({ panelOpen: true }),
      closePanel: () => set({ panelOpen: false }),
      togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
      setDraft: (draft) => set({ inputDraft: draft }),

      refreshSessions: async () => {
        const sessions = await agentApi.listSessions();
        set({ sessions });
      },

      newSession: async () => {
        const session = await agentApi.createSession();
        set((s) => ({
          sessions: [session, ...s.sessions],
          activeSessionId: session.id,
          messages: [],
          inputDraft: '',
          streamingMessageId: null,
          streamingBuffer: '',
        }));
      },

      switchSession: async (id) => {
        set({
          activeSessionId: id,
          messages: [],
          streamingMessageId: null,
          streamingBuffer: '',
        });
        const messages = await agentApi.getMessages(id);
        set({ messages });
      },

      deleteSession: async (id) => {
        await agentApi.deleteSession(id);
        const remaining = get().sessions.filter((s) => s.id !== id);
        const wasActive = get().activeSessionId === id;
        set({ sessions: remaining });
        if (!wasActive) return;
        // Active session was deleted: fall back to most-recent remaining
        // session, or create a fresh one if none are left.
        if (remaining.length > 0) {
          await get().switchSession(remaining[0].id);
        } else {
          await get().newSession();
        }
      },

      loadActiveMessages: async () => {
        const id = get().activeSessionId;
        if (id === null) return;
        const messages = await agentApi.getMessages(id);
        set({ messages });
      },

      sendMessage: async (content) => {
        const trimmed = content.trim();
        if (!trimmed) return;
        let sessionId = get().activeSessionId;
        if (sessionId === null) {
          await get().newSession();
          sessionId = get().activeSessionId;
          if (sessionId === null) return;
        }

        const nowIso = new Date().toISOString();
        const optimisticUserId = `optimistic-user-${Date.now()}`;
        const optimisticAssistantId = makeOptimisticId();
        pendingOptimisticAssistantId = optimisticAssistantId;

        const userMsg: ChatMessage = {
          id: optimisticUserId,
          sessionId,
          role: 'user',
          content: trimmed,
          skill: null,
          metadata: {},
          status: 'complete',
          error: null,
          createdAt: nowIso,
        };
        const assistantMsg: ChatMessage = {
          id: optimisticAssistantId,
          sessionId,
          role: 'assistant',
          content: '',
          skill: null,
          metadata: {},
          status: 'streaming',
          error: null,
          createdAt: nowIso,
        };

        set((s) => ({
          messages: [...s.messages, userMsg, assistantMsg],
          inputDraft: '',
          streamingMessageId: optimisticAssistantId,
          streamingBuffer: '',
        }));

        try {
          activeStreamHandle = await streamAgentChat({
            sessionId,
            content: trimmed,
            skill: null,
            onEvent: (event) => get().ingestSseEvent(event),
            onClose: (reason, err) => {
              activeStreamHandle = null;
              pendingOptimisticAssistantId = null;
              if (reason === 'error' && err) {
                // Graceful fallback if the stream failed before `error`
                // reached us (e.g. network drop): finalise the bubble
                // with the generic failure copy from Story 6.1 P28.
                set((s) => {
                  const id = s.streamingMessageId;
                  if (id === null) return {};
                  return {
                    messages: s.messages.map((m) =>
                      m.id === id
                        ? {
                            ...m,
                            content: 'Agent run failed.',
                            status: 'failed',
                            error: err.message,
                          }
                        : m,
                    ),
                    streamingMessageId: null,
                    streamingBuffer: '',
                  };
                });
                return;
              }
              // 'done' or 'aborted' — clear streaming state. The
              // message content has already been appended via chunks
              // (or replaced with a failure body via the `error`
              // event), so we don't touch `messages` here.
              set({ streamingMessageId: null, streamingBuffer: '' });
            },
          });
        } catch (err) {
          activeStreamHandle = null;
          pendingOptimisticAssistantId = null;
          const message = err instanceof Error ? err.message : String(err);
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === optimisticAssistantId
                ? {
                    ...m,
                    content: 'Agent run failed.',
                    status: 'failed',
                    error: message,
                  }
                : m,
            ),
            streamingMessageId: null,
            streamingBuffer: '',
          }));
        }
      },

      ingestSseEvent: (event) => {
        if (event.type === 'start') {
          // Replace the optimistic assistant id with the canonical
          // server-issued id so subsequent `chunk` / `done` events
          // address the same row when the optimistic id collides.
          const optimisticId = pendingOptimisticAssistantId;
          if (optimisticId === null) return;
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === optimisticId ? { ...m, id: event.message_id } : m,
            ),
            streamingMessageId: event.message_id,
          }));
          pendingOptimisticAssistantId = null;
          return;
        }
        if (event.type === 'chunk') {
          set((s) => {
            const id = s.streamingMessageId;
            if (id === null) return {};
            const nextBuffer = s.streamingBuffer + event.text;
            return {
              streamingBuffer: nextBuffer,
              messages: s.messages.map((m) =>
                m.id === id ? { ...m, content: nextBuffer } : m,
              ),
            };
          });
          return;
        }
        if (event.type === 'done') {
          set((s) => {
            const id = s.streamingMessageId;
            if (id === null) return { streamingMessageId: null, streamingBuffer: '' };
            return {
              messages: s.messages.map((m) =>
                m.id === id ? { ...m, status: 'complete' } : m,
              ),
              streamingMessageId: null,
              streamingBuffer: '',
            };
          });
          return;
        }
        if (event.type === 'error') {
          set((s) => {
            const id = s.streamingMessageId;
            if (id === null) return { streamingMessageId: null, streamingBuffer: '' };
            return {
              messages: s.messages.map((m) =>
                m.id === id
                  ? {
                      ...m,
                      content: 'Agent run failed.',
                      status: 'failed',
                      error: event.message,
                    }
                  : m,
              ),
              streamingMessageId: null,
              streamingBuffer: '',
            };
          });
        }
      },

      cancelStreaming: async () => {
        const sessionId = get().activeSessionId;
        // Abort the local fetch so the bubble stops appending chunks
        // immediately — the server-side cancel is best-effort.
        activeStreamHandle?.abort();
        activeStreamHandle = null;
        set((s) => {
          const id = s.streamingMessageId;
          if (id === null) return { streamingMessageId: null, streamingBuffer: '' };
          return {
            messages: s.messages.map((m) =>
              m.id === id ? { ...m, status: 'cancelled' } : m,
            ),
            streamingMessageId: null,
            streamingBuffer: '',
          };
        });
        if (sessionId !== null) {
          // Story 6.1 deferred: the server's cancel_event isn't fully
          // plumbed into run_crew yet, so the worker keeps running and
          // finalises the assistant row to `complete`. The frontend
          // already stopped reading via abort(); this server call is
          // a forward-compatibility hook for when the plumb lands.
          try {
            await agentApi.cancelChat(sessionId);
          } catch {
            // Best-effort — don't block the UI on cancel-side failures.
          }
        }
      },
    }),
    {
      name: 'agent-store-v1',
      partialize: (s): PersistedShape => ({
        panelOpen: s.panelOpen,
        activeSessionId: s.activeSessionId,
      }),
    },
  ),
);
