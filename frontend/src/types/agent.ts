/**
 * Agent / chat types — shared by the AgentPanel UI, the Zustand store,
 * the SSE streaming hook, and the typed API wrappers.
 *
 * Wire format note: backend responses pass through `apiClient`'s
 * `camelcase-keys` interceptor, so all JSON fields arrive as camelCase
 * on the client. SSE event payloads from `useAgentSse` are NOT routed
 * through axios — they're parsed by hand from the response body — and
 * therefore keep their snake_case server keys (`session_id`,
 * `message_id`). Keep that distinction in mind when reading the union
 * below.
 */

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';
export type ChatStatus =
  | 'pending'
  | 'streaming'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface ChatSessionSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  skill: string | null;
  metadata: Record<string, unknown>;
  status: ChatStatus;
  error: string | null;
  createdAt: string;
}

/**
 * Story 6.3: structured proposal envelope persisted on the assistant
 * row's `metadata.proposal` field and emitted live via the `proposal`
 * SSE event. Skills whose `SkillSpec.proposal_kind` is non-None
 * produce these (rephrase → `text_rewrite`; future
 * organize → `position_deltas`; etc.).
 *
 * `payload` is intentionally `Record<string, unknown>` here — each
 * `kind` has its own per-renderer payload shape (defined alongside
 * the renderer, e.g. `RephraseProposal.tsx`'s prop type for
 * `text_rewrite`). The renderer registration in `AgentMessage.tsx`
 * narrows by `kind` before passing payload through.
 */
export interface ProposalEnvelope {
  kind: string;
  payload: Record<string, unknown>;
  targets: string[];
  reasoning: string;
}

/**
 * SSE events emitted by `crew_runner.py` over `/api/agent/sessions/{id}/chat`.
 * The keys are snake_case because they arrive directly from the server
 * stream, bypassing the axios camelcase interceptor.
 */
export type SseEvent =
  | { type: 'start'; session_id: string; skill: string; message_id: string }
  | { type: 'chunk'; text: string }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string; recoverable: boolean }
  | {
      type: 'proposal';
      kind: string;
      payload: Record<string, unknown>;
      targets: string[];
      reasoning: string;
    };
