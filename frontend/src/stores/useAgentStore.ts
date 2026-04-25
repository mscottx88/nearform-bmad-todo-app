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
const OPTIMISTIC_USER_PREFIX = 'optimistic-user-';

function makeOptimisticId(prefix: string): string {
  // Story 6.2 Group B CR P10: include a random suffix on BOTH user and
  // assistant optimistic ids — two sends within the same millisecond
  // would otherwise collide as React keys (assistant id already had a
  // random suffix; user id used to be timestamp-only).
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Outside of state because abort handles aren't serialisable; we only
 *  need them for the lifetime of one stream. */
let activeStreamHandle: AgentChatStreamHandle | null = null;
/** The optimistic id that the next `start` event should rebind. */
let pendingOptimisticAssistantId: string | null = null;
/**
 * Story 6.2 Group B CR P3: monotonically increasing token. Each
 * `sendMessage` call captures `myStreamId = ++activeStreamId`. SSE
 * callbacks for that stream gate on `myStreamId === activeStreamId` —
 * if the token has been bumped (by a newer send, by `cancelStreaming`,
 * or by `switchSession`), the callback bails. Solves the race where
 * a previous stream's events leak into a new session/send.
 *
 * Also closes Group B CR P2 (start-after-cancel reanimation): cancel
 * bumps the token, so any late-arriving `start` event from the
 * cancelled stream is dropped at the gate before it can rebind the
 * optimistic id and re-enter streaming state.
 */
let activeStreamId = 0;

/** Story 6.2 Group B CR P5: monotonically increasing token for
 *  message-list loads. `switchSession` and `loadActiveMessages` each
 *  capture a token; the response is applied only if the token still
 *  matches. Without this, rapid A → B switches where A's getMessages
 *  resolves last would paint A's messages while `activeSessionId === 'b'`. */
let activeMessagesLoadId = 0;

function abortActiveStream(): void {
  // Story 6.2 Group B CR P1: pulled out so `switchSession` can call
  // it too. Bumps the token to invalidate any in-flight callbacks
  // from the prior stream.
  activeStreamId++;
  activeStreamHandle?.abort();
  activeStreamHandle = null;
  pendingOptimisticAssistantId = null;
}

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
        set((s) => {
          // Story 6.2 Group B CR P6: if a persisted `activeSessionId`
          // points at a session that's been deleted server-side, drop
          // it so `loadActiveMessages` doesn't 404. Falls back to
          // null; `AgentPanel` mount-effect creates a fresh session
          // on first send.
          const activeStillExists =
            s.activeSessionId !== null &&
            sessions.some((sess) => sess.id === s.activeSessionId);
          if (!activeStillExists && s.activeSessionId !== null) {
            return { sessions, activeSessionId: null, messages: [] };
          }
          return { sessions };
        });
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
        // Story 6.2 Group B CR P1: the old code cleared messages and
        // streaming flags but did NOT abort the active stream — the
        // previous session's reader kept running, leaking chunks into
        // a `streamingMessageId` that no longer pointed at any
        // visible message. Abort up front + invalidate the token so
        // the prior stream's callbacks bail at their first event.
        abortActiveStream();

        // Story 6.2 Group B CR P5: capture a request token so a
        // late-arriving `getMessages` from a SUPERSEDED switch can't
        // overwrite the new session's messages.
        const requestId = ++activeMessagesLoadId;
        set({
          activeSessionId: id,
          messages: [],
          streamingMessageId: null,
          streamingBuffer: '',
        });
        const messages = await agentApi.getMessages(id);
        if (requestId !== activeMessagesLoadId) return;
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
        // P5: same token gate as `switchSession` — a rehydrate that
        // races with a switch shouldn't paint the wrong session.
        const requestId = ++activeMessagesLoadId;
        try {
          const messages = await agentApi.getMessages(id);
          if (requestId !== activeMessagesLoadId) return;
          if (get().activeSessionId !== id) return;
          set({ messages });
        } catch {
          // P6: if the session vanished between rehydrate and load
          // (e.g. deleted in another tab), don't bubble — let the
          // panel remain empty and the next `refreshSessions` will
          // clear `activeSessionId`.
        }
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

        // P3: capture per-stream token. SSE callbacks compare against
        // the global `activeStreamId`; if a newer send / cancel /
        // switch has bumped the token, this stream's callbacks bail.
        const myStreamId = ++activeStreamId;

        const nowIso = new Date().toISOString();
        const optimisticUserId = makeOptimisticId(OPTIMISTIC_USER_PREFIX);
        const optimisticAssistantId = makeOptimisticId(OPTIMISTIC_ASSISTANT_PREFIX);
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
            onEvent: (event) => {
              // P3 + P2 token gate: drop any event whose stream has
              // been superseded (newer send, cancel, or switch).
              if (myStreamId !== activeStreamId) return;
              get().ingestSseEvent(event);
            },
            onClose: (reason, err) => {
              if (myStreamId !== activeStreamId) return;
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
          // If the token was bumped during the await (cancel / switch
          // landed before fetch resolved), abort the freshly-returned
          // handle instead of letting it leak.
          if (myStreamId !== activeStreamId) {
            activeStreamHandle?.abort();
          }
        } catch (err) {
          if (myStreamId !== activeStreamId) return;
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
          set((s) => {
            // Story 6.2 Group B CR P2: don't rebind a bubble that's
            // already in a terminal state (cancelled / failed). A
            // late-arriving `start` from a cancelled stream would
            // otherwise undo the cancel by re-entering streaming.
            const target = s.messages.find((m) => m.id === optimisticId);
            if (target && target.status !== 'streaming') {
              return {};
            }
            return {
              messages: s.messages.map((m) =>
                m.id === optimisticId ? { ...m, id: event.message_id } : m,
              ),
              streamingMessageId: event.message_id,
            };
          });
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
        // Story 6.2 Group B CR P12: short-circuit if there's nothing
        // to cancel. Without this, clicking Stop after `done` already
        // cleared streaming state still fires a server-side cancel —
        // spamming the backend for completed runs.
        if (activeStreamHandle === null && get().streamingMessageId === null) {
          return;
        }
        const sessionId = get().activeSessionId;
        // Abort the local fetch + bump the token so any late-arriving
        // events from the cancelled stream bail at the onEvent gate.
        abortActiveStream();
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
          // Group A CR P1 wired cancel_event into run_crew so this
          // call now actually short-circuits the worker thread; the
          // assistant row reaches DB status='cancelled' rather than
          // streaming on through to 'complete'.
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
