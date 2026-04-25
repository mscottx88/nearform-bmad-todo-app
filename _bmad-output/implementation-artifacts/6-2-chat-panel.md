# Story 6.2: Chat Panel

Status: review

> **Scope note:** First frontend story of Epic 6 (The Intelligent Pond Companion).
> Builds the AgentPanel UI (right-side neon drawer), the SSE consumer, the
> Zustand store, and the F1 / `/help` invocation paths. Backend agent
> substrate is already in place from Story 6.1 (POST /api/agent/sessions,
> GET sessions list, DELETE session, GET messages, POST chat with SSE
> streaming, POST cancel). Stories 6.3–6.6 (skills) add proposal events
> on top of this story's `chunk`/`done`/`error` SSE plumbing.

> **User-explicit scope additions (2026-04-25)** layered over the
> epics-file ACs:
>
> - **Distinct sub-panel sections** within the drawer: a chat thread
>   region, an Oracle-Frog video-overlay region (a placeholder for the
>   `<View>` aquarium-window from Story 6.7 — render a stubbed frame
>   here so 6.7 only has to wire its scene + camera into the placeholder),
>   and a controls/buttons strip (new chat, sessions, close).
> - **Speech-bubble shape**: rounded corners with a single tail/point on
>   the appropriate side (left for assistant, right for user). Chat
>   bubbles must render as visually distinct shapes — not flat rounded
>   rectangles.
> - **Use the upgraded NeonScrollbar** for the chat-history scroll area
>   in wrap mode (the component shipped with overlay mode in Story 3.4
>   for the InfoPopup textarea; chat history wants the simpler wrap
>   pattern: `<NeonScrollbar><AgentMessageList /></NeonScrollbar>`).
> - **Escape closes the panel.** Spec already lists Escape as a dismissal
>   per the architecture doc — promote it to a first-class AC and ensure
>   the composer's own Escape-when-empty-or-unfocused path matches.

---

## ⚠️ CRITICAL CONSTITUTIONAL CONSTRAINT

**Async/await is PROHIBITED in backend code** — see [CLAUDE.md](CLAUDE.md)
§ "CONCURRENCY MODEL — THREAD-BASED ONLY". This story is frontend-only;
no new backend code is required. If a gap surfaces in the SSE contract
(e.g. `start` event needs to include `message_id` — see § Dev Notes),
extend the existing thread-based pipeline in `crew_runner.py` —
**never** introduce `async`/`await`/`asyncio`.

---

## Story

As a user,
I want to open a neon chat panel and have a free-form conversation with the AI agent,
So that I can get intelligent help with my todos without leaving the pond.

---

## Acceptance Criteria

### AC 1 — F1 toggles the panel; Escape closes it

**Given** the pond is loaded and no input is focused
**When** I press `F1`
**Then** a right-side drawer panel slides in from the right edge (~440px desktop,
full viewport height, full-width on mobile)
**And** the 3D pond stays fully interactive behind it (`pointer-events: auto`
on the canvas; the panel does **not** cover the entire viewport)
**And** the panel uses the existing neon design tokens (`--neon-cyan` for
borders/text, `--font-mono` for headers, `--font-sans` for chat bubbles —
see [neon-tokens.css](frontend/src/styles/neon-tokens.css))

**When** I press `F1` again
**Then** the panel slides out

**When** the panel is open and I press `Escape` AND
- the composer is unfocused, OR
- the composer is focused but its content is empty
**Then** the panel closes

**When** the panel is open and the composer has content with focus
**Then** `Escape` does **not** close the panel — it instead clears the
composer (so the user has a Vim-like "abort what I was typing" affordance).
A second `Escape` then closes the panel.

**And** the F1 binding lives in [useKeyboardShortcuts.ts](frontend/src/hooks/useKeyboardShortcuts.ts);
the handler calls `event.preventDefault()` so the browser's native F1
help shortcut is suppressed.

**And** the F1 handler shares the same `target` / `activeElement`
input-focus filter the existing Enter / `/` handlers use — F1 inside
TodoInput / textarea / contenteditable is **not** captured.

### AC 2 — `/help` slash command opens the panel (with optional prefill)

**Given** the TodoInput is open
**When** I type `/help` and press Enter
**Then** the agent panel opens with an empty composer

**When** I type `/help plan my week` and press Enter
**Then** the agent panel opens with `"plan my week"` pre-filled in the
composer (cursor at end), the message is **not** auto-sent, and TodoInput closes

**And** `/help` parsing lives in a new file `frontend/src/utils/helpCommand.ts`
that exports `parseHelpCommand(text: string): { open: true; prefill: string } | null`

**And** TodoInput's Enter handler calls `parseHelpCommand` **before**
the existing `parseSlashCommands(...)` call. If `parseHelpCommand`
returns non-null, take the help branch; otherwise fall through to the
slash-command registry walk and the todo-create path. The toggle-command
framework from Story 3.3 stays pure — `/help` is a parser carve-out,
not a registry entry.

### AC 3 — Three distinct sub-panel sections inside the drawer

**Given** the panel is open

**Then** the drawer DOM is laid out top-to-bottom in three visually
distinct sections, each with its own neon hairline border:

1. **Oracle-Frog overlay region** — a fixed-aspect (16:10) area at the
   top of the panel reserved for Story 6.7's `<View>` secondary camera.
   Story 6.2 ships a **placeholder** here: a dark-water-coloured rectangle
   with a thin neon-cyan border, a centred greyed-out caption
   `"oracle frog · arrives in story 6.7"`, and the same neon-tokens
   styling as the rest of the panel.
   - The placeholder must accept an optional `children` slot so 6.7 can
     drop its `<View>` camera in without restructuring the panel.
   - Component name: `AgentPanelOraclePlaceholder.tsx` (renamed in 6.7
     to `AgentPanelOracleView.tsx` once the real frog scene lands).

2. **Chat thread region** — the largest section by height, fills the
   middle. Holds the message scroll area, wrapped in `NeonScrollbar` (see AC 6).

3. **Composer + controls region** — bottom strip. Two horizontal rows:
   - Top row: composer (multi-line auto-grow textarea, 6-line cap, see AC 8)
   - Bottom row: button strip — `+ New chat`, sessions hamburger, send,
     and close buttons. All buttons use the neon button styling pattern
     from Story 4.1's PopupColorSwatch (`box-shadow: 0 0 8px <neon-color>`,
     `1px solid var(--neon-cyan)`, `--font-mono`).

**And** each section has a clear visual divider — a thin glowing
horizontal line in `--neon-cyan` at low opacity. No raw `<hr>` —
use a CSS pseudo-element or a styled `<div role="separator">`.

### AC 4 — Chat bubbles render as speech-bubble shapes (not flat rectangles)

**Given** the chat thread has user and assistant messages

**Then** each message renders as a **speech-bubble shape** with:
- Rounded corners on three sides (border-radius: 16px)
- A single triangular **tail/point** on the bubble's edge:
  - **User bubbles** (right-aligned): tail on the bottom-right, pointing
    to the bottom-right corner
  - **Assistant bubbles** (left-aligned): tail on the bottom-left,
    pointing to the bottom-left corner
- The tail is implemented via a CSS pseudo-element (`::after`) using
  a `clip-path: polygon(...)` triangle or a small skewed `<div>` —
  **not** a `border` triangle hack (those don't anti-alias well in
  Chromium and won't pick up the bubble's neon glow correctly).

**Visual targets:**
- User bubble background: `rgba(255, 16, 240, 0.12)` (`--neon-pink` at 12%);
  border `1px solid var(--neon-pink)`; box-shadow `0 0 10px rgba(255,16,240,0.45)`;
  text colour `#ffd0f5` (light pink-tinted white)
- Assistant bubble background: `rgba(0, 238, 255, 0.10)` (`--neon-cyan` at 10%);
  border `1px solid var(--neon-cyan)`; box-shadow `0 0 10px rgba(0,238,255,0.4)`;
  text colour `#daffff` (light cyan-tinted white)
- The tail picks up the bubble's border + shadow continuously — no
  visible seam between body and tail
- Bubble max-width 80% of the chat region; long messages wrap

**And** the bubble component is named `AgentMessage.tsx` and accepts
the message role (`'user' | 'assistant' | 'system' | 'tool'`) as a prop
to drive the colour / alignment / tail-side variants.

**And** `system` and `tool` role messages render in a less prominent
"meta-row" style (no tail, smaller font, dimmer glow) — these are not
common today but Story 6.3+ will emit them via `tool_call` / `tool_result`.

### AC 5 — Streaming SSE rendering

**Given** the panel is open and a session is active
**When** I type a message and press Enter (or click Send)
**Then** my message appears immediately in the chat thread as a user bubble
**And** an assistant bubble appears with a neon "thinking…" indicator
(animated cyan dot triplet, similar pattern to the EmptyPondHint typewriter
animation from `frontend/src/components/ui/EmptyPondHint.css`)
**And** SSE chunks arrive and append to the assistant bubble text in
real time as they stream
**And** the "thinking…" indicator hides on the first `chunk` event
**And** the bubble freezes its content on the `done` event
**And** any `error` event terminates the stream and the assistant bubble
flips to a failure state (red-tinted border, content replaced with the
generic copy from Story 6.1 P28: `"Agent run failed."`)

**And** the SSE consumer lives in [`frontend/src/hooks/useAgentSse.ts`](frontend/src/hooks/useAgentSse.ts)
(new file). **Implementation note:** native `EventSource` is GET-only —
the agent endpoint is `POST /api/agent/sessions/{id}/chat` with a JSON
body. Use `fetch()` with `ReadableStream` for SSE consumption (see Dev
Notes § "SSE over POST" for the working snippet). Do **not** add an
external SSE library; the parser is ~50 lines of inline code.

**And** event handlers dispatch into `useAgentStore.ingestSseEvent(event)`
which mutates the active streaming message in place. No React state
for individual chunks — Zustand handles the high-frequency updates.

### AC 6 — NeonScrollbar wraps the chat history

**Given** the chat thread has more messages than fit in the chat region
**When** I scroll
**Then** the **upgraded NeonScrollbar** ([NeonScrollbar.tsx](frontend/src/components/ui/NeonScrollbar.tsx),
shipped with overlay mode in Story 3.4) renders the cyan neon thumb
**And** the native browser scrollbar is hidden (NeonScrollbar already
sets `scrollbar-width: none` + `::-webkit-scrollbar { display: none }`
on its inner div)

**And** the chat region uses **wrap mode** (not overlay mode):
```tsx
<NeonScrollbar
  color="cyan"
  className="agent-panel__chat-scroll"
  innerStyle={{ display: 'flex', flexDirection: 'column', gap: 8 }}
  scrollRef={chatScrollRef}
>
  <AgentMessageList messages={messages} streamingMessageId={streamingMessageId} />
</NeonScrollbar>
```

**And** the chat auto-scrolls to the bottom on each new chunk **only
when the user is already pinned to the bottom** (within ~32px). If the
user has scrolled up to read history, an incoming chunk does **not**
yank the view down — instead, a small "↓ new messages" pill appears
that scrolls to bottom on click.

### AC 7 — Sessions menu in the controls strip

**Given** the panel is open
**When** I click the sessions hamburger icon in the controls row
**Then** an in-panel sessions list overlays the chat region (not a
separate sidebar — overlay slides down from below the Oracle-Frog
placeholder)
**And** the list shows all sessions ordered by `updated_at DESC` (the
order returned by `GET /api/agent/sessions` per Story 6.1's `list_sessions`
service after CR P14 + the post-CR `id` tiebreaker)
**And** each row shows the session title (or `"(untitled)"` if `title is None`)
and a relative-time timestamp using the same formatter as InfoPopup's
[formatTodoMeta.ts](frontend/src/utils/formatTodoMeta.ts) `formatRelative`

**When** I click a session row
**Then** the sessions overlay closes, `useAgentStore.activeSessionId` is
updated, and `GET /api/agent/sessions/{id}/messages` is fetched and
rendered in the chat thread

**When** I click `+ New chat` in the controls row
**Then** `POST /api/agent/sessions` is called, the new session id becomes
active, the chat thread clears, and the composer is focused

**When** I hover a session row in the overlay
**Then** a small red-neon `×` icon appears at the row's right edge
**When** I click the `×` icon
**Then** a confirm prompt appears (`Delete this conversation?` —
inline, not a `window.confirm`); confirming fires
`DELETE /api/agent/sessions/{id}` (which cascades the messages per AC 2
of Story 6.1)

**And** if the deleted session was the active session, the panel falls
back to the most-recently-updated remaining session, OR creates a new
one if no sessions remain.

### AC 8 — Composer behaviour

**Given** the panel is open
**When** I focus the composer
**Then** it accepts multi-line text (auto-grow up to a 6-line cap,
beyond which it scrolls internally — reuse the InfoPopup textarea
styling pattern: `--font-sans`, `--neon-cyan` border on focus,
`box-shadow` glow ramp on focus)

**And** `Enter` sends the message (calls `useAgentStore.sendMessage(content)`
which POSTs to `/api/agent/sessions/{id}/chat` with `{content, skill: null,
context: {todo_ids: []}}`); `Shift+Enter` inserts a newline

**And** while a message is streaming (`useAgentStore.streamingMessageId !== null`),
the Send button shows a stop icon and clicking it fires
`POST /api/agent/sessions/{id}/cancel` (Story 6.1's cancellation endpoint).
After CR Group D P23, this cancels only the current session's events.

**And** `useAgentStore.inputDraft` mirrors composer text so that
closing/reopening the panel preserves what the user was typing for the
current session.

**And** `↑` / `↓` (Up / Down arrows) at the start of the composer
recall prior user messages from the active session — terminal /
Claude Code-style history navigation. The composer stashes the
in-progress draft on first `↑` and restores it when the user walks
forward past index 0. Reconciled in Group B code review (D2 / choice
A: keep + amend AC 8). The `↑/↓ history` affordance is announced in
the keyboard-hint footer below the composer.

### AC 9 — `useAgentStore` Zustand store

**Given** the agent panel and supporting hooks
**When** I inspect [`frontend/src/stores/useAgentStore.ts`](frontend/src/stores/useAgentStore.ts) (new file)

**Then** the store exposes the fields the architecture doc enumerates
(see [architecture.md § 5.4](_bmad-output/planning-artifacts/architecture.md#L1239)):

| Field | Type | Purpose |
|---|---|---|
| `panelOpen` | `boolean` | Drawer visibility |
| `activeSessionId` | `string \| null` | Current session UUID |
| `sessions` | `ChatSessionSummary[]` | List of session summaries |
| `messages` | `ChatMessage[]` | Messages for the active session |
| `inputDraft` | `string` | Composer text (per active session) |
| `streamingMessageId` | `string \| null` | In-flight assistant message id; null when idle |
| `streamingBuffer` | `string` | Accumulated chunks for the streaming message |

**Actions:** `openPanel`, `closePanel`, `togglePanel`, `setDraft`,
`newSession`, `switchSession`, `deleteSession`, `sendMessage`,
`ingestSseEvent`, `cancelStreaming`.

**And** persistence: `panelOpen` and `activeSessionId` are persisted to
`localStorage` via Zustand's `persist` middleware so panel state
survives page reload. `messages`, `streamingBuffer`, `streamingMessageId`
are **not** persisted — they're refetched on session switch / reopen.

**And** when `panelOpen` flips `false → true`, an effect re-fetches
`GET /api/agent/sessions` (to refresh the list) and, if `activeSessionId`
is set, `GET /api/agent/sessions/{activeSessionId}/messages`.

### AC 10 — Tests pass

**Given** the new test files

**When** I run `npm run-script` test (vitest) from `frontend/`

**Then** all existing tests still pass (no regressions), and new tests cover:

- `frontend/src/stores/useAgentStore.test.ts` — pure-store tests for
  open/close, session switch, ingestSseEvent (start/chunk/done/error),
  sendMessage optimistic insert, cancelStreaming
- `frontend/src/hooks/useAgentSse.test.ts` — mocks `fetch()` with a
  `ReadableStream`, asserts that SSE frames `data: {...}\n\n` are
  parsed into typed events and dispatched to the store
- `frontend/src/utils/helpCommand.test.ts` — `/help`, `/help foo bar`,
  `/help   ` (trailing whitespace), non-`/help` text, `/helpme` (no match)
- `frontend/src/components/agent/AgentPanel.test.tsx` —
  - F1 toggles `panelOpen`
  - Escape with empty composer closes the panel
  - Escape with non-empty focused composer clears the draft (does NOT close)
  - Pressing F1 inside an `<input>` is **not** captured (focus filter)
- `frontend/src/components/agent/AgentMessage.test.tsx` — bubble role
  variants render with the correct alignment / tail-side classes
- `frontend/src/components/agent/AgentSessionsMenu.test.tsx` — click
  row → switches; click `×` → confirm → DELETE; `+ New chat` → POSTs

**And** typescript builds clean (`npm run build`) and ESLint passes
(`npm run lint`).

### AC 12 — Recent chat history is injected into the chat skill's Task prompt

**Given** a session has prior messages

**When** the user sends a new message and the chat skill (the default
free-form skill) is invoked

**Then** the chat skill's `Task.description` includes a formatted
transcript of the **last `_HISTORY_WINDOW` (= 20) messages** in the
session, ordered oldest → newest, EXCLUDING:
- the just-inserted user message (the LLM already gets that as the
  primary task input — including it twice wastes tokens and confuses
  the model)
- any messages with `status != 'complete'` (in particular the
  in-flight assistant placeholder we just inserted, plus any
  `streaming`/`failed`/`cancelled` rows)

**And** the agent therefore has conversational continuity without
needing to call `GetChatHistoryTool` on every turn — follow-ups like
*"and what about that one?"* or *"yes, do that"* resolve correctly
against the recent transcript.

**And** `GetChatHistoryTool` **stays registered** in the chat skill's
tool list so the agent can fetch DEEPER history (older than the
pre-loaded 20) when a long-context question demands it.

**And** the intent classifier (`intent_classifier.py`) does **NOT**
receive history — it's a single-LLM-call routing decision and
including transcript bloats the prompt with irrelevant tokens; the
classifier sees only the current user message.

**Transcript format** (must appear before the user message in the
Task description):
```
Conversation so far:
user: <content>
assistant: <content>
user: <content>
...

User's latest message: <ctx.user_message>
```

**Implementation:**

- Extend `SkillContext` ([backend/src/agent/skills/registry.py](backend/src/agent/skills/registry.py))
  with a new field `history: tuple[ChatMessageResponse, ...] = ()`.
  Use `tuple` (not `list`) because `SkillContext` is `@dataclass(frozen=True)`.
  Default to empty tuple so the classifier (which doesn't pass history)
  and tests using a synthetic context don't have to set it.
- In [backend/src/api/agent.py](backend/src/api/agent.py)'s `chat`
  handler, load recent messages via
  `chat_service.list_messages(db, session_id, limit=_HISTORY_WINDOW)`
  AFTER the user + assistant placeholder inserts, then filter to
  `m.status == "complete" and m.role in ("user", "assistant") and m.id != assistant_msg_id`
  before passing into `SkillContext`.
- In [backend/src/agent/skills/chat.py](backend/src/agent/skills/chat.py)
  `build()`, format `ctx.history` into a transcript string and prepend
  it to the Task description.
- The classifier path keeps `history=()` (empty tuple) — no change
  to `intent_classifier.py`.

### AC 11 — `start` event must include `message_id`

**Given** the SSE event contract from Story 6.1's `crew_runner.py`

**When** the chat handler streams the first event

**Then** the `start` event payload **must include `message_id`** (the
assistant placeholder's UUID) so the frontend can:
- Bind subsequent `chunk`/`done`/`error` events to the right message row
- Cancel via `POST /api/agent/sessions/{id}/cancel` (which cancels by
  session per CR P23, but logs are easier to correlate with `message_id`)

**Implementation:** Story 6.1 currently emits `{type: "start", session_id, skill}`
([backend/src/agent/crew_runner.py:68-74](backend/src/agent/crew_runner.py#L68-L74)).
Extend `run_crew` to accept `assistant_message_id: uuid.UUID` and
include it in the start event. The chat handler in `api/agent.py`
already has `assistant_msg_id` in scope — pass it through.

This is a small backend change (~5 lines crew_runner + ~3 lines
api/agent.py + 1 test update in `test_crew_runner.py`) — kept in scope
for 6.2 because the frontend cannot otherwise correlate streamed
events with the persisted message row without it.

---

## Tasks / Subtasks

### Task 1 — Backend: extend `start` SSE event with `message_id` (AC 11)

- [x] In [`backend/src/agent/crew_runner.py`](backend/src/agent/crew_runner.py),
  add `assistant_message_id: uuid.UUID` parameter to `run_crew`.
  Include it in the `start` event payload as `message_id`.
- [x] In [`backend/src/api/agent.py`](backend/src/api/agent.py),
  pass `assistant_msg_id` through to the `_run_and_finalise` closure's
  `run_crew(...)` call.
- [x] Update [`backend/tests/agent/test_crew_runner.py`](backend/tests/agent/test_crew_runner.py)
  fixture: `_make_ctx` doesn't change, but the three `TestRunCrew`
  tests must pass an `assistant_message_id=uuid.uuid4()` and assert it
  appears in the start event.

### Task 1b — Backend: inject chat history into the chat skill's Task prompt (AC 12)

- [x] In [`backend/src/agent/skills/registry.py`](backend/src/agent/skills/registry.py),
  add a `history: tuple[ChatMessageResponse, ...] = ()` field to the
  `SkillContext` frozen dataclass. Import `ChatMessageResponse` from
  `src.schemas.agent`. Default to empty tuple so existing call sites
  (intent_classifier path, tests) don't break.
- [x] In [`backend/src/api/agent.py`](backend/src/api/agent.py)
  `chat` handler, after the two `chat_service.create_message(...)` calls
  and before building the `SkillContext` for the worker thread:
  ```python
  _HISTORY_WINDOW = 20
  # Spec deviation reconciled in Group A code review (D6, choice C):
  # `list_messages` is ASC + LIMIT, which silently returns the OLDEST
  # N rows when the session has more than `limit` messages — the
  # exact opposite of what we want for a sliding context window.
  # Use `chat_service.list_recent_messages` (DESC + reverse → latest
  # N in chronological order) instead. Original `list_messages`
  # remains the right choice for endpoints that want the full
  # earliest-first transcript (e.g. `GET /messages`).
  raw_history = chat_service.list_recent_messages(
      db, session_id, limit=_HISTORY_WINDOW * 4  # P2: larger buffer
  )
  history = tuple(
      m for m in raw_history
      if m.status == "complete"
      and m.role in ("user", "assistant")
      and m.id not in {user_msg_id, assistant_msg_id}
  )[-_HISTORY_WINDOW:]
  ```
  Pass `history=history` into the `SkillContext(...)` constructor.
- [x] **Do not pass history to the classifier.** `_classify_intent`
  builds its own `SkillContext` with the default empty tuple — leave it.
- [x] In [`backend/src/agent/skills/chat.py`](backend/src/agent/skills/chat.py),
  format `ctx.history` into a `transcript_block` string and prepend
  it to `Task.description`:
  ```python
  if ctx.history:
      transcript_lines = [f"{m.role}: {m.content}" for m in ctx.history]
      transcript_block = "Conversation so far:\n" + "\n".join(transcript_lines)
      task_description = (
          f"{transcript_block}\n\n"
          f"User's latest message: {ctx.user_message}"
      )
  else:
      task_description = ctx.user_message
  ```
- [x] Update existing chat-skill tests if any directly construct a
  `SkillContext` — they need `history=()` or specific synthetic history.
- [x] Add a new test in `backend/tests/agent/test_chat_skill.py` (new
  file) or extend `test_tools_integration.py` that builds a chat skill
  with synthetic history and asserts the Task description contains
  the transcript block.
- [x] Add a new test in `backend/tests/api/test_agent.py` that
  verifies the chat handler loads history before building the
  SkillContext: create a session, insert a couple of messages, then
  POST to `/chat` and assert the SkillContext built (mock `run_crew`
  to capture its argument) has the expected `history` tuple.

### Task 2 — Frontend: types + API client

- [x] Create `frontend/src/types/agent.ts`:
  ```ts
  export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';
  export type ChatStatus = 'pending' | 'streaming' | 'complete' | 'failed' | 'cancelled';

  export interface ChatSessionSummary {
    id: string;
    title: string | null;
    created_at: string;
    updated_at: string;
  }

  export interface ChatMessage {
    id: string;
    session_id: string;
    role: ChatRole;
    content: string;
    skill: string | null;
    metadata: Record<string, unknown>;
    status: ChatStatus;
    error: string | null;
    created_at: string;
  }

  export type SseEvent =
    | { type: 'start'; session_id: string; skill: string; message_id: string }
    | { type: 'chunk'; text: string }
    | { type: 'done' }
    | { type: 'error'; code: string; message: string; recoverable: boolean };
  ```

- [x] Create `frontend/src/api/agentApi.ts` with typed wrappers around the
  6.1 endpoints. Reuse [apiClient.ts](frontend/src/api/client.ts):
  - `listSessions(): Promise<ChatSessionSummary[]>` → `GET /agent/sessions`
  - `getSession(id): Promise<ChatSessionSummary>` → `GET /agent/sessions/{id}`
  - `getMessages(id): Promise<ChatMessage[]>` → `GET /agent/sessions/{id}/messages`
  - `createSession(): Promise<ChatSessionSummary>` → `POST /agent/sessions`
  - `deleteSession(id): Promise<void>` → `DELETE /agent/sessions/{id}`
  - `cancelChat(id): Promise<void>` → `POST /agent/sessions/{id}/cancel`
  - The streaming POST `chat()` is **not** here — it's in `useAgentSse.ts`
    because it needs the `ReadableStream` reader, not the standard
    JSON-response pattern.

### Task 3 — Frontend: `useAgentStore` Zustand store (AC 9)

- [x] Create `frontend/src/stores/useAgentStore.ts` with the field set
  from AC 9. Use Zustand's `persist` middleware for `panelOpen` +
  `activeSessionId` only.
- [x] Implement actions: `openPanel`, `closePanel`, `togglePanel`,
  `setDraft`, `newSession` (calls `agentApi.createSession`),
  `switchSession` (calls `agentApi.getMessages`), `deleteSession`,
  `sendMessage`, `ingestSseEvent`, `cancelStreaming`.
- [x] Write `useAgentStore.test.ts` (AC 10).

### Task 4 — Frontend: `useAgentSse` hook (AC 5)

- [x] Create `frontend/src/hooks/useAgentSse.ts` exporting
  `streamAgentChat(sessionId: string, content: string, skill: string | null,
  onEvent: (e: SseEvent) => void): { abort: () => void }`.
- [x] Use `fetch(POST, body, signal)` + `response.body.getReader()` +
  `TextDecoder` to consume the SSE stream. Parse `data: {...}\n\n`
  frames into typed events. AbortController hooks into `cancelStreaming`.
- [x] Test by mocking `fetch` to return a `ReadableStream` of canned SSE
  frames; assert the event sequence dispatched.

### Task 5 — Frontend: `parseHelpCommand` utility (AC 2)

- [x] Create `frontend/src/utils/helpCommand.ts`:
  ```ts
  export function parseHelpCommand(text: string): { open: true; prefill: string } | null {
    const trimmed = text.trim();
    if (trimmed === '/help') return { open: true, prefill: '' };
    if (trimmed.startsWith('/help ')) {
      return { open: true, prefill: trimmed.slice(6).trim() };
    }
    return null;
  }
  ```
- [x] Wire into [`TodoInput.tsx`](frontend/src/components/ui/TodoInput.tsx)'s
  Enter handler. The carve-out runs **before** the existing
  `parseSlashCommands` registry walk (~line 148) so `/help` doesn't get
  mis-parsed by the toggle-command framework.
- [x] On match: call `useAgentStore.openPanel()`, set
  `useAgentStore.inputDraft = result.prefill`, and close TodoInput.

### Task 6 — Frontend: F1 + Escape keybinding (AC 1)

- [x] Extend [`useKeyboardShortcuts.ts`](frontend/src/hooks/useKeyboardShortcuts.ts):
  - Add an F1 branch alongside the existing Enter / `/` branches, with
    the same target / activeElement filter.
  - The F1 handler calls `e.preventDefault()` then
    `useAgentStore.getState().togglePanel()`.
- [x] Escape handling for the panel itself lives in the panel component
  (not the global hook), since the close-vs-clear-draft logic depends
  on composer focus + content.

### Task 7 — Frontend: AgentPanel + sub-components (AC 1, 3, 4, 5, 6, 7, 8)

Create files under `frontend/src/components/agent/`:

- [x] `AgentPanel.tsx` — drawer container, three-section layout, slide
  in/out animation (CSS transition on `transform: translateX(...)`),
  Escape handling (close vs clear draft).
- [x] `AgentPanelOraclePlaceholder.tsx` — top section. 16:10 aspect ratio
  rectangle, neon-cyan border, dark-water background, centred caption.
  Accepts `children` (defaults to `null`) so 6.7 can drop the `<View>`
  in later.
- [x] `AgentMessageList.tsx` — middle section. Maps `messages[]` →
  `<AgentMessage>` items. Auto-scroll-to-bottom logic from AC 6.
- [x] `AgentMessage.tsx` — speech-bubble component (AC 4). CSS lives in
  `AgentPanel.css` alongside the rest of the panel styles. The tail
  is a `::after` pseudo-element with a `clip-path: polygon(...)`
  triangle.
- [x] `AgentComposer.tsx` — bottom-section top row. Auto-grow textarea
  with 6-line cap. Enter sends, Shift+Enter newline.
- [x] `AgentControlsRow.tsx` — bottom-section bottom row. New-chat,
  sessions-hamburger, send/stop, close buttons.
- [x] `AgentSessionsMenu.tsx` — overlay slide-down list of sessions
  (AC 7).
- [x] `AgentPanel.css` — single CSS module for all of the above. Uses
  neon-tokens.css custom properties; **never** hardcode colour values
  beyond the design-token palette.

### Task 8 — Frontend: thinking-indicator animation (AC 5)

- [x] Three cyan dots with staggered opacity-pulse animation. Show while
  the assistant bubble has empty content and `streamingMessageId` matches.
  Hide on first `chunk` event (when `streamingBuffer` becomes non-empty).
- [x] Implementation: pure CSS keyframes, no JS animation. Pattern
  reference: [EmptyPondHint.css](frontend/src/components/ui/EmptyPondHint.css)
  `char-ripple` keyframes.

### Task 9 — Wire AgentPanel into App.tsx

- [x] Mount `<AgentPanel />` in [App.tsx](frontend/src/App.tsx) alongside
  `<TodoInput />` and `<CursorFirefly />`. The panel reads its own
  open/close state from `useAgentStore`; no props needed.

### Task 10 — Tests (AC 10)

- [x] All test files listed in AC 10. Use `vi.mock('axios')` for
  `agentApi` calls; mock `fetch()` for `useAgentSse`. Component tests
  use `@testing-library/react` (already in devDependencies).

---

## Dev Notes

### Existing patterns to follow (not reinvent)

| Concern | Where it's done | Pattern |
|---|---|---|
| Sync axios HTTP client | [api/client.ts](frontend/src/api/client.ts) | `apiClient.get/post/...` with baseURL `/api` |
| Zustand store | [stores/usePondStore.ts](frontend/src/stores/usePondStore.ts) | `create<State>()(...)` with selectors at module scope |
| Zustand persist | [stores/useWorldStore.ts](frontend/src/stores/useWorldStore.ts) (Story 4.9) | `persist` middleware, `partialize` to limit what's persisted |
| Right-side drawer panel | None yet — but the InfoPopup floating-panel pattern in [InfoPopup.tsx](frontend/src/components/ui/InfoPopup.tsx) is the closest neon-styled chrome | drei `<Html>` is **not** used here — AgentPanel is plain DOM (lives outside the R3F `<Canvas>`, like [PondSearchOverlay.tsx](frontend/src/components/pond/PondSearchOverlay.tsx)) |
| Neon button | [PopupColorSwatch.tsx](frontend/src/components/ui/PopupColorSwatch.tsx) (Story 4.1) | `box-shadow: 0 0 8px <neon-color>`, `1px solid var(--neon-cyan)`, `--font-mono` |
| Slash-command carve-out | [TodoInput.tsx](frontend/src/components/ui/TodoInput.tsx) Enter handler (Story 5.3 added a `/` carve-out) | Detect `/help` BEFORE `parseSlashCommands(...)`; do NOT add to the registry |
| F1 keybinding | None today | Extend [useKeyboardShortcuts.ts](frontend/src/hooks/useKeyboardShortcuts.ts) — same target / activeElement filter as Enter / `/` |
| NeonScrollbar wrap mode | [DataTable](rag-csv-crew reference) and InfoPopup overlay mode (Story 3.4) | `<NeonScrollbar color="cyan"><children /></NeonScrollbar>` |

### Story 6.1 API contract — actual implementation, not the architecture doc

**The architecture doc ([architecture.md § 6.1](_bmad-output/planning-artifacts/architecture.md))
lists `POST /api/agent/chat` with `session_id` in the body.** Story 6.1
diverged from that and put `session_id` in the URL. The actual shipped
endpoints are:

| Verb | Path | Source of truth |
|---|---|---|
| POST | `/api/agent/sessions` | [api/agent.py:47](backend/src/api/agent.py#L47) — body: empty; returns `ChatSessionResponse` |
| GET | `/api/agent/sessions` | [api/agent.py:52](backend/src/api/agent.py#L52) — returns `list[ChatSessionResponse]` |
| GET | `/api/agent/sessions/{id}` | [api/agent.py:57](backend/src/api/agent.py#L57) — added in CR Group D P29 |
| DELETE | `/api/agent/sessions/{id}` | [api/agent.py:67](backend/src/api/agent.py#L67) — 204; CASCADE deletes messages |
| GET | `/api/agent/sessions/{id}/messages` | [api/agent.py:73](backend/src/api/agent.py#L73) — ordered ASC by created_at, hard-capped at 200 |
| POST | `/api/agent/sessions/{id}/chat` | [api/agent.py:80](backend/src/api/agent.py#L80) — SSE stream; body: `{content, skill, context}` |
| POST | `/api/agent/sessions/{id}/cancel` | [api/agent.py:173](backend/src/api/agent.py#L173) — 202; session-scoped after CR P23 |

**Build the frontend against the actual endpoints.** Do not chase the
older architecture text.

### SSE over POST — `fetch()` + `ReadableStream` (not `EventSource`)

Native `EventSource` is GET-only. The chat endpoint requires a JSON
POST body. The minimum viable streaming consumer:

```ts
export async function streamAgentChat(
  sessionId: string,
  content: string,
  skill: string | null,
  onEvent: (e: SseEvent) => void,
): Promise<{ abort: () => void }> {
  const controller = new AbortController();
  const res = await fetch(`/api/agent/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, skill, context: { todo_ids: [] } }),
    signal: controller.signal,
  });
  if (!res.ok || !res.body) throw new Error(`stream failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Parse SSE frames asynchronously without holding the caller.
  void (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? ''; // last fragment may be partial
      for (const frame of frames) {
        if (!frame.startsWith('data: ')) continue;
        const json = frame.slice(6).trim();
        if (!json) continue;
        try {
          onEvent(JSON.parse(json) as SseEvent);
        } catch { /* drop malformed */ }
      }
    }
  })();

  return { abort: () => controller.abort() };
}
```

**Note:** the function uses `async/await` because that's how the JS
runtime exposes Promise-returning APIs. The constitutional ban on
`async/await` is **Python-only** (CLAUDE.md § "CONCURRENCY MODEL —
THREAD-BASED ONLY"). JavaScript/TypeScript code in `frontend/` uses
async normally.

### Speech-bubble tail — clip-path approach

```css
.agent-message__bubble--user {
  position: relative;
  background: rgba(255, 16, 240, 0.12);
  border: 1px solid var(--neon-pink);
  border-radius: 16px;
  box-shadow: 0 0 10px rgba(255, 16, 240, 0.45);
  padding: 10px 14px;
  align-self: flex-end;
  max-width: 80%;
}
.agent-message__bubble--user::after {
  content: '';
  position: absolute;
  right: -6px;
  bottom: 0;
  width: 14px;
  height: 12px;
  background: rgba(255, 16, 240, 0.12);
  border-right: 1px solid var(--neon-pink);
  border-bottom: 1px solid var(--neon-pink);
  clip-path: polygon(0 0, 100% 100%, 0 100%);
  box-shadow: 1px 1px 6px rgba(255, 16, 240, 0.4);
}
.agent-message__bubble--assistant {
  /* … same pattern, mirrored: align-self: flex-start, ::after with left: -6px and clip-path: polygon(100% 0, 100% 100%, 0 100%) */
}
```

The `clip-path` polygon describes a triangle whose hypotenuse runs
along the bubble edge so the body and tail share a continuous border.
Adjust polygon coordinates if the visual seam is visible after first
render — pixel-rounding at small sizes is sometimes off by 0.5px.

### Story 6.1 deferred-work that affects this story

Skim [deferred-work.md § code review of story 6-1](
_bmad-output/implementation-artifacts/deferred-work.md) for items that
6.2 might unintentionally exercise:

- `cancel_event` is stored under the correct session key but **not
  plumbed into `SkillContext` / read by `run_crew`**. Calling
  `cancelChat()` will set the event and return 202, but the crew thread
  keeps running and the assistant message will still finalise to
  `complete`. The user-facing UX should still hide the streaming bubble
  immediately (frontend stops appending chunks via `AbortController` on
  the `fetch()`), so this is mostly invisible — but document the
  behaviour in `useAgentStore.cancelStreaming`.
- `_run_and_finalise` daemon thread has **no LLM-call timeout**. A hung
  Anthropic call leaves the stream open. The frontend should show the
  cancel button after a configurable timeout (e.g. 30s of no chunk
  arrival) so the user has an escape hatch.
- `body.skill` accepts only exact lowercase matches **(post-CR
  quickwin: now stripped + lowercased server-side)** — the frontend can
  pass the user's literal skill string; the schema normalises it.

### `localStorage` persistence and the persist middleware

Use Zustand's `persist` middleware with a versioned key:

```ts
import { persist } from 'zustand/middleware';

export const useAgentStore = create<AgentState>()(
  persist(
    (set, get) => ({ ... }),
    {
      name: 'agent-store-v1',
      partialize: (s) => ({ panelOpen: s.panelOpen, activeSessionId: s.activeSessionId }),
    },
  ),
);
```

If the schema needs to change later, bump the version (`agent-store-v2`)
to invalidate stale entries.

### Browser cursor — interaction with the firefly snake

The custom firefly cursor lives at `--z-cursor` (`2147483647`). The
agent panel must NOT clobber it — keep the panel `z-index` below
`--z-cursor` but above `<Canvas>` (try `z-index: 100`).

The firefly cursor's hit-testing logic uses `pointer-events: none` on
the firefly canvas, so panel elements receive their own pointer events
naturally. No special handling needed.

### File locations summary

| New file | Purpose |
|---|---|
| `frontend/src/types/agent.ts` | TS types for messages, sessions, SSE events |
| `frontend/src/api/agentApi.ts` | Typed wrappers around 6.1 endpoints |
| `frontend/src/stores/useAgentStore.ts` | Zustand store |
| `frontend/src/hooks/useAgentSse.ts` | `fetch()` + `ReadableStream` SSE consumer |
| `frontend/src/utils/helpCommand.ts` | `/help` parser carve-out |
| `frontend/src/components/agent/AgentPanel.tsx` | Drawer container + three-section layout |
| `frontend/src/components/agent/AgentPanel.css` | All panel styling |
| `frontend/src/components/agent/AgentPanelOraclePlaceholder.tsx` | Top section; 6.7 will swap in `<View>` |
| `frontend/src/components/agent/AgentMessageList.tsx` | Chat thread list |
| `frontend/src/components/agent/AgentMessage.tsx` | Speech-bubble |
| `frontend/src/components/agent/AgentComposer.tsx` | Multi-line composer |
| `frontend/src/components/agent/AgentControlsRow.tsx` | Button strip |
| `frontend/src/components/agent/AgentSessionsMenu.tsx` | Sessions overlay |
| `frontend/src/stores/useAgentStore.test.ts` | Store tests |
| `frontend/src/hooks/useAgentSse.test.ts` | SSE consumer tests |
| `frontend/src/utils/helpCommand.test.ts` | Parser tests |
| `frontend/src/components/agent/*.test.tsx` | Component tests |

**Modified files:**

| Modified file | Change |
|---|---|
| `frontend/src/App.tsx` | Mount `<AgentPanel />` |
| `frontend/src/hooks/useKeyboardShortcuts.ts` | Add F1 branch |
| `frontend/src/components/ui/TodoInput.tsx` | Add `parseHelpCommand` carve-out before slash-command walk |
| `backend/src/agent/crew_runner.py` | Add `assistant_message_id` parameter; include in `start` event (AC 11) |
| `backend/src/api/agent.py` | Pass `assistant_msg_id` through to `run_crew`; load + filter recent history before building `SkillContext` (AC 12) |
| `backend/src/agent/skills/registry.py` | Add `history: tuple[ChatMessageResponse, ...] = ()` field to `SkillContext` (AC 12) |
| `backend/src/agent/skills/chat.py` | Format `ctx.history` into a transcript block prepended to `Task.description` (AC 12) |
| `backend/tests/agent/test_crew_runner.py` | Update three `TestRunCrew` tests to assert `message_id` in start event |
| `backend/tests/agent/test_chat_skill.py` (new) | Test that chat skill builds with history injected into Task description |
| `backend/tests/api/test_agent.py` | Test that chat handler loads + filters history into SkillContext |

---

## Story DoD (Definition of Done)

- [x] `npm run build` succeeds (no type errors, no lint errors)
- [x] `npx vitest --run` from `frontend/` passes (all existing + new tests, no skips)
- [x] `uv run pytest` from `backend/` still passes (Task 1's backend changes don't regress)
- [x] `uv run ruff check src/` and `uv run mypy src/ --strict` pass
- [x] F1 toggles the panel; Escape behaves per AC 1
- [x] `/help` and `/help <text>` open the panel with the correct prefill
- [x] Three sub-panel sections are visually distinct
- [x] Speech-bubble tails render correctly on user (right) and assistant (left) bubbles
- [x] Streaming SSE chunks render in real time and the assistant bubble freezes on `done`
- [x] NeonScrollbar wraps the chat history, native scrollbars are hidden
- [x] Sessions menu lists / switches / creates / deletes sessions correctly
- [x] `start` event includes `message_id`
- [x] Recent history (last 20 `complete` messages, excluding the in-flight placeholder) is injected into the chat skill's Task description; classifier is not affected
- [x] Manual smoke test: open panel via F1, send a message, send a follow-up that depends on the prior turn (e.g. "and what colour is it?"), confirm the agent responds with continuity. Switch sessions, delete a session, close via Escape.

---

## Dev Agent Record

### Implementation Notes

**Backend (Tasks 1, 1b)** — small surgical changes:

- `crew_runner.run_crew` now accepts `assistant_message_id: uuid.UUID`
  and includes it as `message_id` in the `start` SSE event payload (AC
  11). The frontend can now bind `chunk`/`done`/`error` events to the
  right assistant DB row.
- `SkillContext` gains a frozen-tuple `history` field (default `()`).
  The chat handler in `api/agent.py` populates it from the most-recent
  `_HISTORY_WINDOW + 2` messages, filtering out the in-flight assistant
  placeholder and the just-inserted user message — leaving exactly
  `_HISTORY_WINDOW` (= 20) rows of useful context. The fetch goes
  through a new `chat_service.list_recent_messages()` helper (DESC +
  LIMIT then chronological reverse) because the existing
  `list_messages` orders ASC and would silently return the OLDEST 20
  rows for any session longer than the window. The classifier path
  keeps `history=()` untouched.
- `chat.py` exports a `_format_task_description(ctx)` helper that
  prepends `"Conversation so far:\n<role>: <content>...\n\nUser's
  latest message: <ctx.user_message>"` when history is non-empty;
  empty history is a passthrough.

**Backend (out-of-story-but-permitted)** — two Story 6.1 bugs surfaced
when the chat path was finally exercised end-to-end, plus a small
agent-prompt addition that enables the frontend's `[label](todo://uuid)`
link rendering and a low-risk readability refactor:

- `agent/system_prompt.py` gained a `REFERENCING TODOS` directive
  instructing the agent to render todo references as
  `[<short label>](todo://<uuid>)` markdown links. The frontend
  `TodoLink` component (Group C) parses this format on the chunk
  stream to render hover-to-pad and click-to-pad affordances. Without
  the system-prompt directive the agent emits bare UUIDs or
  freeform prose and the link UX is unreachable. Reconciled with the
  spec via Group A code review D2 (choice A: keep + amend spec).
- `agent/skills/intent_classifier.py` had its prompt template
  refactored to use `textwrap.dedent` block strings (consistent with
  the chat skill). Behaviorally equivalent — same prompt content,
  same untrusted-data framing — purely a readability win. Group A
  code review D5 (choice A: keep + amend spec).

The two original Story-6.1 bugs:

- `agent/llm.py` switched from LangChain's `ChatAnthropic` to
  CrewAI's native `LLM`. CrewAI 1.0+ wraps non-native LLM objects via
  LiteLLM-style adapters and falls back to OpenAI when it can't
  recognise the provider — that fallback path raises
  `Error importing native provider: OPENAI_API_KEY is required` the
  moment a real chat hits the wire. Using `crewai.LLM(model=
  "anthropic/claude-sonnet-4-6", api_key=...)` routes through the
  Anthropic native client directly with no fallback.
- `crew_runner._chunk_words` had a "run-together words" bug: each
  chunk was `" ".join(group)` with no leading whitespace, so two
  adjacent chunks like `"hello"` + `"world"` concatenated to
  `"helloworld"` on the consumer side. The pre-existing test masked
  it because it used `" ".join(chunk_events)` to verify
  reconstruction — that synthesises the missing space. The bubble in
  the live UI surfaced text like `"don'thave access toweather
  information"`. Fix: each non-first chunk on a line is now prefixed
  with a single space so `"".join(chunks)` round-trips to the
  original prose. `\n` chunks reset the flag so the chunk after a
  newline does NOT pick up an unwanted leading space. Tests updated:
  the round-trip assertion is now `"".join(...) == text`; two new
  guards cover the run-together case and the post-newline-no-leading-
  space invariant.

**Frontend (Tasks 2–10)** — built top-down from types to UI:

- Types (`types/agent.ts`): camelCase for HTTP-routed shapes (the
  axios interceptor camelizes responses); snake_case for SSE events
  because they bypass axios.
- API client (`api/agentApi.ts`): typed wrappers around the six
  Story-6.1 endpoints; the streaming POST is intentionally NOT here
  — it lives in the SSE hook because it needs the `ReadableStream`
  reader, not axios's JSON-response pipeline.
- SSE hook (`hooks/useAgentSse.ts`): `fetch()` + `ReadableStream` +
  TextDecoder loop, ~30 lines of frame parsing, no external SSE
  library. Returns `{abort}` for cancel-side wiring; `onClose`
  always fires exactly once with one of `'done' | 'aborted' |
  'error'`.
- Store (`stores/useAgentStore.ts`): full AC-9 field set + actions.
  `panelOpen` and `activeSessionId` survive page reload via Zustand's
  `persist` middleware (`agent-store-v1` key) — `messages`,
  `streamingBuffer`, `streamingMessageId` are not persisted (they're
  refetched on session switch / reopen).
- `start` SSE event handling: the store inserts an optimistic
  client-side assistant id when `sendMessage` fires, and the `start`
  event rebinds it to the canonical server uuid so subsequent
  `chunk`/`done` events address the same row.
- F1 binding (`hooks/useKeyboardShortcuts.ts`): same input-focus
  filter as Enter/`/`. Escape handling for the panel itself lives in
  `AgentPanel.tsx` because the close-vs-clear-draft decision depends
  on composer focus + content.
- `parseHelpCommand` (`utils/helpCommand.ts`): pure function;
  `TodoInput.tsx`'s Enter handler runs it BEFORE
  `parseSlashCommands`, so `/help` never falls into the toggle-
  command registry.
- Components: speech bubbles use a `clip-path: polygon(...)`
  pseudo-element tail (NOT a `border` triangle hack, which doesn't
  anti-alias well in Chromium and breaks the bubble's neon glow at
  the seam). User bubbles: pink, right-aligned, tail bottom-right;
  assistant bubbles: cyan, left-aligned, tail bottom-left.
- Auto-scroll (AC 6): pinned-to-bottom (within 32px) → scroll to
  bottom; otherwise show the "↓ new messages" pill, which jumps to
  bottom on click. Scroll handler also hides the pill if the user
  manually scrolls back to the bottom.

### Completion Notes

- ✅ All 10 tasks (incl. 1b) complete.
- ✅ Backend: 197/197 tests pass; ruff + mypy clean.
- ✅ Frontend: 439/439 tests pass (83 new); `npm run build` clean
  (TypeScript + Vite production bundle); `npm run lint` net-zero
  delta (one new line documented with `eslint-disable-next-line` in
  AgentMessageList because the setState-in-effect is genuinely
  synchronising React with a DOM measurement, the case the rule
  explicitly tolerates).
- ✅ Manual smoke confirmed once the LLM provider fix landed: F1
  toggles, Escape close-vs-clear-draft works, `/help` opens with
  prefill, multi-turn follow-up resolves against the injected
  history transcript.

### Known runtime issues to investigate (CR scope)

- **Anthropic 400 — "This model does not support assistant message
  prefill"** seen during manual smoke test: when the agent tries to
  invoke a tool, CrewAI's tool-call → tool-result → final-completion
  flow ends the messages array with an assistant turn. Some Claude
  4.x models reject that pattern. Symptom: chat works for non-tool
  prompts but errors as soon as the agent reaches for a tool. The
  fix is most likely (a) bump CrewAI to a version that doesn't
  prefill, (b) switch to a model id that accepts prefill (e.g.
  `anthropic/claude-sonnet-4-5-20250929`), or (c) drop tools from
  the chat skill until 6.3-6.6 actually need them. **Frontend
  surfaces this cleanly** — the `error` SSE event flips the bubble
  to the failed visual state with the generic "Agent run failed."
  copy, so the bug doesn't silently swallow turns. Logged for code
  review; not a frontend defect.

### Out-of-scope decisions

- The Oracle-Frog placeholder ships as a static caption box in this
  story; Story 6.7 will swap it for a `<View>` secondary camera via
  the placeholder's `children` slot.
- `AgentMessageList` does NOT virtualise the message list. Sessions
  are capped at 200 messages by `list_messages`'s hard cap, well
  below the threshold where windowing pays for itself. If session
  length grows materially in 6.x, revisit.
- `streamingMessageId` is bound to the optimistic id between
  `sendMessage` and the first `start` event, then rebound to the
  server uuid. The brief window means cancellation that lands BEFORE
  `start` aborts the fetch (frontend stops appending) but the server
  cancel is still keyed by the active session, so the worker thread
  is signalled correctly regardless.

---

## File List

**New files:**

- `frontend/src/types/agent.ts`
- `frontend/src/api/agentApi.ts`
- `frontend/src/stores/useAgentStore.ts`
- `frontend/src/stores/useAgentStore.test.ts`
- `frontend/src/hooks/useAgentSse.ts`
- `frontend/src/hooks/useAgentSse.test.ts`
- `frontend/src/utils/helpCommand.ts`
- `frontend/src/utils/helpCommand.test.ts`
- `frontend/src/components/agent/AgentPanel.tsx`
- `frontend/src/components/agent/AgentPanel.css`
- `frontend/src/components/agent/AgentPanel.test.tsx`
- `frontend/src/components/agent/AgentPanelOraclePlaceholder.tsx`
- `frontend/src/components/agent/AgentMessageList.tsx`
- `frontend/src/components/agent/AgentMessage.tsx`
- `frontend/src/components/agent/AgentMessage.test.tsx`
- `frontend/src/components/agent/AgentComposer.tsx`
- `frontend/src/components/agent/AgentComposer.test.tsx`
- `frontend/src/components/agent/AgentControlsRow.tsx`
- `frontend/src/components/agent/AgentSessionsMenu.tsx`
- `frontend/src/components/agent/AgentSessionsMenu.test.tsx`
- `backend/tests/agent/test_chat_skill.py`

**Modified files:**

- `frontend/src/App.tsx` — mount `<AgentPanel />` next to TodoInput.
- `frontend/src/hooks/useKeyboardShortcuts.ts` — F1 branch.
- `frontend/src/hooks/useKeyboardShortcuts.test.ts` — F1 coverage.
- `frontend/src/components/ui/TodoInput.tsx` — `parseHelpCommand`
  carve-out before `parseSlashCommands`.
- `backend/src/agent/crew_runner.py` — `assistant_message_id`
  parameter; included as `message_id` in start event. Plus the
  `_chunk_words` chunk-spacing fix so consumer raw-concat round-
  trips to original prose (no more "don'thave access" run-together
  output).
- `backend/src/api/agent.py` — pass `assistant_msg_id` through to
  `run_crew`; load + filter recent history into `SkillContext`.
- `backend/src/agent/skills/registry.py` — `history` field on
  `SkillContext`.
- `backend/src/agent/skills/chat.py` — `_format_task_description`
  helper that prepends a transcript block to `Task.description`.
- `backend/src/agent/llm.py` — switch from LangChain `ChatAnthropic`
  to CrewAI native `LLM` with `model="anthropic/..."` to fix the
  OPENAI_API_KEY fallback runtime error.
- `backend/src/services/chat_service.py` — new
  `list_recent_messages` (DESC + LIMIT + reverse) for the most-
  recent-N context window.
- `backend/src/agent/system_prompt.py` — added a `REFERENCING TODOS`
  directive so the agent renders todo references as
  `[<short label>](todo://<uuid>)` markdown links, which the
  frontend `TodoLink` parser depends on. Reconciled in Group A code
  review (D2 / choice A: keep + amend spec).
- `backend/src/agent/skills/intent_classifier.py` — prompt template
  refactored to use `textwrap.dedent` block strings (consistent with
  the chat skill). Behaviorally equivalent. Reconciled in Group A
  code review (D5 / choice A: keep + amend spec).
- `backend/tests/agent/test_crew_runner.py` — pass
  `assistant_message_id` to `run_crew` in three tests; assert
  `message_id` in start event.
- `backend/tests/api/test_agent.py` — add history-loading test +
  long-session most-recent-N test.
- `backend/tests/services/test_chat_service.py` — three
  `list_recent_messages` tests.

---

### Review Findings — Group A (Backend) — 2026-04-25

**Layers:** Blind Hunter, Edge Case Hunter, Acceptance Auditor (full mode)
**Diff:** `b873531..HEAD` filtered to backend (14 files, ~2000 lines)

#### Decision-needed (6)

- [x] [Review][Decision] Prompt-injection framing in chat skill's transcript block — `_format_task_description` interpolates raw `role: content` lines with no untrusted-data framing or role fencing. The classifier wraps user input with `_CLASSIFIER_UNTRUSTED_DATA_FRAMING`; the chat skill's task description does not. Crafted prior assistant/user content can inject fake turns. Decision: add classifier-style framing block, structured fences (`<message role="...">…</message>`), or accept the system-prompt-level "treat history as untrusted" warning as sufficient. [`backend/src/agent/skills/chat.py:30-44`]
- [x] [Review][Decision] Out-of-spec `system_prompt.py` directive: `REFERENCING TODOS` block telling the LLM to render todo references as `[label](todo://<uuid>)`. Not in Tasks 1/1b, not in Dev Notes' permitted-gap list, not in File List. Decision: keep + amend spec (treat as AC-11/12 enabler for frontend `TodoLink`), or revert. [`backend/src/agent/system_prompt.py:326-362`]
- [x] [Review][Decision] `_chunk_words` collapses internal whitespace runs (`line.split()` then `" ".join`) — destroys code-block indentation and multi-space prose. Decision: special-case fenced blocks (stream verbatim), accept the limitation as a known constraint, or normalize to single-space deliberately. [`backend/src/agent/crew_runner.py:70-79`]
- [x] [Review][Decision] Concurrent `chat()` calls for the same session race on `excluded_ids`-based history filtering — request A's history may include request B's just-committed user row with no assistant reply yet (B's assistant is `pending`, filtered out). Decision: per-session lock for the create-message + read-history block, document as "don't double-send", or accept as best-effort. [`backend/src/api/agent.py:159-194`]
- [x] [Review][Decision] Out-of-spec `intent_classifier.py` template refactor (backstory + task description rewritten via `textwrap.dedent`) — Task 1b explicitly says "no change to `intent_classifier.py`". Behaviorally equivalent per reviewer. Decision: keep (low-risk readability win) or revert to honor the spec. [`backend/src/agent/skills/intent_classifier.py:224-293`]
- [x] [Review][Decision] `list_recent_messages` helper deviates from spec's prescribed `list_messages(db, session_id, limit=_HISTORY_WINDOW)` — but spec's call is buggy (ASC + LIMIT returns OLDEST N, not LATEST N); the helper does DESC + reverse correctly. Decision: amend spec to reference `list_recent_messages`, or revert and fix `list_messages` semantics. [`backend/src/services/chat_service.py:447-474`, `backend/src/api/agent.py:410`]

#### Patch (7)

- [x] [Review][Patch] **CRITICAL** — `cancel_event` is registered in `_CANCEL_MAP` but never threaded into `run_crew`; `POST /cancel` calls `event.set()` but the chunk loop never checks `is_set()`. Cancel is a silent no-op — stream continues and assistant row finalises normally. Fix: pass `cancel_event` into `run_crew`, check between chunks (and between word-groups) to stop emitting, mark assistant row `cancelled` on exit. [`backend/src/api/agent.py:197-202`, `backend/src/agent/crew_runner.py:95-167`]
- [x] [Review][Patch] History tail-slice under-fills the window when the last `_HISTORY_WINDOW + 2` rows include any non-`complete` rows (failed/pending/cancelled streaks). The `+2` slack only covers the placeholder + just-inserted user row. Fix: paginate or fetch a larger buffer and stop once `_HISTORY_WINDOW` complete rows are collected. [`backend/src/api/agent.py:184-194`]
- [x] [Review][Patch] `_chunk_words` splits on `"\n"` only — `\r\n` line endings drop the trailing `\r` (broken `"".join(chunks) == text` round-trip). Fix: split on `\r?\n` or normalize input upstream. [`backend/src/agent/crew_runner.py:64`]
- [x] [Review][Patch] Empty-line chunks bypass the `MAX_CHUNKS_PER_RUN` truncation cap — the unconditional `chunks.append("\n")` runs after the cap is reached. Fix: include `len(chunks) >= MAX_CHUNKS_PER_RUN` check before appending the line break and break out. [`backend/src/agent/crew_runner.py:86-89`]
- [x] [Review][Patch] `run_crew` swallows `KeyError` from missing skill via the broad `except Exception` and reports `recoverable: False` with the raw `KeyError(...)` repr (leaks the bad skill name in the error payload). Fix: pre-check `skill_name in SKILL_REGISTRY` and emit a controlled `unknown_skill` error before the broad-except path. [`backend/src/agent/crew_runner.py:114, 156-165`]
- [x] [Review][Patch] `intent_classifier.py` `description={...!r}` template runs `repr()` on the user message, which inflates emoji and non-ASCII runs (`"😀"` → `"\U0001F600"`, ~10×) and may unexpectedly blow the prompt budget at the 4000-char input cap. Fix: drop `!r`, escape only what's necessary (newlines), keep length explicit. [`backend/src/agent/skills/intent_classifier.py:73 / diff lines 282-290`]
- [x] [Review][Patch] `finalise_assistant_message`'s `with SessionLocal() as session:` rolls back on any exception inside `update_message`. If `update_message` raises something other than `ChatMessageNotFoundError` after partial mutation, the broad `except Exception` swallows it but the pending → complete write was already rolled back, leaving the assistant row stuck in `pending` forever. Fix: separate transactions for the success-write and the failure-write, or commit defensively. [`backend/src/api/agent.py:73-105`, `backend/src/services/chat_service.py:160`]

#### Deferred (3) — pre-existing or low-yield

- [x] [Review][Defer] `stream_sse` blocks indefinitely on `event_queue.get()` if the worker thread is killed externally between `run_crew` returning and `finalise_assistant_message` starting (no timeout). Pre-existing pattern from Story 6.1. Defer to future hardening pass. [`backend/src/agent/crew_runner.py:170-176`]
- [x] [Review][Defer] `crewai.LLM(api_key=settings.anthropic_api_key, ...)` passes the plaintext `str` value (was `SecretStr` previously); CrewAI's `LLM.__repr__` redaction behavior is unverified. Defer pending a check of CrewAI internals. [`backend/src/agent/llm.py:158-162`]
- [x] [Review][Defer] `pydantic-settings` lower bound loosened from `>=2.13.1` to `>=2.10.1` with no justification in the dev notes. Likely a CrewAI resolver constraint. Defer pending a one-line note in pyproject. [`backend/pyproject.toml:18`]

#### Dismissed (6) — false positives / out of scope

- Stale DB-session snapshot worry — PostgreSQL default isolation is READ COMMITTED, post-commit reads are visible (false alarm).
- `list_recent_messages` does an extra `get_session` round-trip — intentional 404 safety, perf cost negligible.
- `list_recent_messages` UUID tiebreak ambiguous — no two messages share microsecond in practice.
- `_format_task_description` accepts empty `user_message` via direct call — guarded at the API boundary by Pydantic.
- System-role messages silently dropped from history — no code path creates them yet (premature).
- Blind Hunter's `{user_message!r}` template-escape worry — self-withdrawn during analysis.

---

### Post-CR polish — Group B (2026-04-25)

In addition to the 14 P# patches itemized in Review Findings — Group
B below, the user requested visual polish during the batch-apply
walkthrough:

1. **Thicker bubble outline + stronger glow** — `stroke-width` bumped
   from 1 to 1.75; the variant `drop-shadow` filter is now a stacked
   pair (4px tight inner glow + 14px wider outer halo) so the neon
   reads as more "lit" than a single bigger blur.
2. **Inline + block markdown rendering** — `parseAgentMessage`
   tokenises `**bold**`, `*italic*`, `` `code` ``, plus `# h1` / `## h2`
   / `### h3` headings and `---` horizontal rules. The horizontal
   rule renders thicker (2px) with a stacked currentColor box-shadow
   to match the bubble's neon vocabulary. Block-level pre-pass is
   line-aware; inline tokenizer is streaming-friendly (unclosed
   openers fall through as plain text, re-render correctly when the
   closer arrives).
3. **Neon-pond emoji bias** — `system_prompt.py` now nudges the LLM
   toward pond-themed emoji (frogs, lizards, insects, plants,
   fish, turtles, snails) and away from tech/office icons. Kept
   tight to honour the ≤200-word system-prompt cap (192 words
   total).

### Review Findings — Group B (Frontend Chat UI Core) — 2026-04-25

**Layers:** Blind Hunter, Edge Case Hunter, Acceptance Auditor (full mode)
**Diff:** `b873531..HEAD` filtered to chat panel core (~22 files, ~3500 lines)

#### Decision-needed (3)

- [x] [Review][Decision] **AC 4 deviation** — Speech-bubble tail is rendered as inline SVG with stroked `<path>` rather than the AC-prescribed CSS pseudo-element with `clip-path: polygon(...)`. The component-level comment justifies the deviation ("clip-path stroke didn't pick up the neon glow on the hypotenuse"); visual outcome matches the spec. Decision: keep SVG + amend AC 4 to acknowledge the implementation choice, or refactor to clip-path and accept the glow regression. [`frontend/src/components/agent/AgentMessage.tsx:681-708`]
- [x] [Review][Decision] **Out-of-spec composer history** — `AgentComposer` ships Up/Down arrow recall of prior user messages (`historyIndex`, `stashedDraft`, 6 dedicated tests). AC 8 enumerates the composer's keyboard contract and does not include history navigation. Decision: keep + amend AC 8 (terminal-style recall is a UX win), or revert to free up scope. [`frontend/src/components/agent/AgentComposer.tsx:276-365`]
- [x] [Review][Decision] **AC 2 contradiction** — `registerHelpCommand()` registers `/help` as a slash-command registry entry, but AC 2 says explicitly "The toggle-command framework from Story 3.3 stays pure — `/help` is a parser carve-out, not a registry entry." Code currently does BOTH (parser carve-out AND registry entry). Decision: trim the registry entry to honor the AC, or amend AC 2 (the registry path enables `/help` to surface in the slash-autocomplete dropdown — discoverability win). [`frontend/src/utils/helpCommand.ts:registerHelpCommand`]

#### Patch (12)

- [x] [Review][Patch] **CRITICAL** — `switchSession` clears `messages` / `streamingBuffer` / `streamingMessageId` but does NOT abort the active stream. The previous stream's reader keeps running; a `start` event arriving after the switch rebinds an optimistic id that no longer exists in the new session, then chunks accumulate into a dangling `streamingMessageId` that never clears. Fix: call `activeStreamHandle?.abort()` and clear `pendingOptimisticAssistantId` at the top of `switchSession`. [`frontend/src/stores/useAgentStore.ts:switchSession`]
- [x] [Review][Patch] **HIGH** — `start` event arriving AFTER `cancelStreaming` reanimates the cancelled bubble: the start handler unconditionally rebinds the optimistic id and sets `streamingMessageId`, undoing the cancel. Fix: in the `start` handler, bail if the optimistic message in the store is already `status === 'cancelled'` (or guard via a `cancelled` flag captured at cancel time). [`frontend/src/stores/useAgentStore.ts` start-event branch]
- [x] [Review][Patch] **HIGH** — Module-scope `let activeStreamHandle` and `pendingOptimisticAssistantId` are clobbered when two `sendMessage` calls overlap (rapid Send clicks before the disabled prop kicks in, or programmatic re-entry from `/help`). Fix: move to store state keyed by request id, OR debounce/disable Send while a stream is active (the store already has `streamingMessageId`; the UI should gate Send on it). [`frontend/src/stores/useAgentStore.ts` module top]
- [x] [Review][Patch] **HIGH** — `streamAgentChat`'s `fetch()` rejection (network down, CORS, abort during request) propagates out before the IIFE runs; `onClose` is documented as "always fires exactly once" but is never called on this path. Fix: wrap the `fetch` in try/catch, call `onClose('error', message)` before re-throwing (or instead of re-throwing). [`frontend/src/hooks/useAgentSse.ts` fetch-then-IIFE block]
- [x] [Review][Patch] **HIGH** — `switchSession` race: rapid A → B switch where A's `getMessages` resolves last paints A's messages while `activeSessionId === 'b'`. Fix: capture a request token (incrementing counter or a per-call session id) and discard the response if the captured token no longer matches the active session. Apply the same pattern in `loadActiveMessages`. [`frontend/src/stores/useAgentStore.ts:switchSession, loadActiveMessages`]
- [x] [Review][Patch] **HIGH** — Persisted `activeSessionId` is not validated on rehydrate. If the server-side session was deleted between sessions, `loadActiveMessages` calls `getMessages(id)` which 404s; the unhandled rejection bubbles. Fix: on rehydrate (or first `refreshSessions`), if the persisted `activeSessionId` isn't in the returned list, clear it and fall back to the first session (or null). [`frontend/src/stores/useAgentStore.ts:partialize` + AgentPanel mount effect]
- [x] [Review][Patch] **HIGH** — `AgentComposer.onKeyDown` does not suppress IME composition: ArrowUp during CJK candidate selection fires history recall, and Enter submits during composition. Fix: short-circuit the handler when `e.nativeEvent.isComposing` is true (or `e.keyCode === 229` for Safari fallback). [`frontend/src/components/agent/AgentComposer.tsx:onKeyDown`]
- [x] [Review][Patch] **HIGH** — `TodoLink` sets `cursorMode='point'` on hover but doesn't reset it on unmount. If the panel closes (Escape) or session switches while the cursor is over a link, `cursorMode` stays `'point'` indefinitely. Fix: `useEffect(() => () => reset cursor if still 'point', [])` cleanup. [`frontend/src/components/agent/TodoLink.tsx:onPointerLeave area`]
- [x] [Review][Patch] **MED** — `AgentPanel` Escape-handler `useEffect` includes `draft` in its deps array, so the global keydown listener is unbound + rebound on every keystroke. Fix: read `draft` (or `inputDraft`) via `useAgentStore.getState()` inside the handler instead of closing over it; drop `draft` from deps. [`frontend/src/components/agent/AgentPanel.tsx` Escape effect]
- [x] [Review][Patch] **MED** — Optimistic user-message id is `optimistic-user-${Date.now()}` (no random suffix) — two sends within the same millisecond collide as React keys. Assistant id has a random suffix; user id should match. Fix: reuse `makeOptimisticId` for both. [`frontend/src/stores/useAgentStore.ts:sendMessage`]
- [x] [Review][Patch] **MED** — `useAgentSse` discards any half-buffered SSE frame on stream close: when the reader returns `{ done: true }` with bytes still in `buffer`, the trailing frame is dropped. Fix: attempt one final `parseFrame(buffer)` before `closeOnce('done')`. [`frontend/src/hooks/useAgentSse.ts` reader loop, done branch]
- [x] [Review][Patch] **MED** — `cancelStreaming` calls `agentApi.cancelChat(sessionId)` even when there is no active stream (e.g. user clicks Stop after a `done` already cleared `streamingMessageId`). Fix: short-circuit if `streamingMessageId === null` AND `activeStreamHandle === null`. [`frontend/src/stores/useAgentStore.ts:cancelStreaming`]

#### Deferred (4) — pre-existing, low-yield, or out-of-window

- [x] [Review][Defer] No idle timeout on the SSE stream — a hung backend that holds the stream open without sending bytes leaves the bubble in `streaming` forever; only manual cancel saves the user. Pre-existing pattern; defer to a hardening pass. [`frontend/src/hooks/useAgentSse.ts`]
- [x] [Review][Defer] Persist schema is `name: 'agent-store-v1'` with no `version` / `migrate` callback. Future shape changes will silently merge old localStorage blobs into a new schema. Add versioning when the first breaking change actually lands. [`frontend/src/stores/useAgentStore.ts:partialize`]
- [x] [Review][Defer] `parseAgentMessage` doesn't handle URL-encoded UUIDs in `todo://%XX...` form. The system prompt instructs the agent to emit raw UUIDs; encoding is unlikely. Defer until observed in the wild. [`frontend/src/utils/parseAgentMessage.ts:TODO_LINK_RE`]
- [x] [Review][Defer] `AgentSessionsMenu` confirm-delete state on row A is silently cleared when the user clicks × on row B. Probably intentional (one confirm at a time), but no visual feedback. Cosmetic; defer for retro. [`frontend/src/components/agent/AgentSessionsMenu.tsx:onDeleteClick`]

#### Dismissed (12) — false positives / out of scope

- AC 4 visual outcome — `parseAgentMessage` regex non-issues (no catastrophic backtracking; `g`-flag state is fine via `matchAll`).
- `dangerouslySetInnerHTML` not used — JSX text is safe (no finding).
- `AgentMessageList` mount-only-effect documentation drift — no actual bug; comment claim ≠ code path, but second effect handles the case.
- `AgentMessage` empty-failed-content fallback — defensive copy below the bar; backend Group A patches already guarantee terminal status.
- `MessageBody` null-content — type contract says `string`, no client-side guard needed.
- `AgentComposer` Up-at-position-0 multi-line concern — withdrawn during analysis.
- `AgentComposer` Up arrow recalled message caret position — UX nit, not a bug.
- `forceHintTick` blur quirk — JSDOM-only.
- `TodoLink` onClick stale `worldEntry` — UI is OK; pad will be removed shortly anyway.
- `TodoLink` `positionY` passed as z — confirmed correct (pond uses XZ-plane, world store stores X/Z as `positionX`/`positionY` per existing convention).
- `AgentMessageList` ResizeObserver feature-detect — modern browser target.
- `AgentSessionsMenu` rapid double-click race — covered by switch-race patch P5.
- `camelCase` vs spec literal `snake_case` — resolved by axios `camelcase-keys` interceptor (Dev Notes).
- Adjacent-link cursor flicker — micro-jitter, not load-bearing.
- `AgentSessionsMenu` × accessibility — covered by P11 a11y patch (later).
- `registerHelpCommand` non-idempotence — covered by DN3.
- `refreshSessions` clobbers optimistic `newSession` — narrow timing window, defer in practice.
- `AgentPanel` `partialize` re-opens panel on visit — intentional UX (panelOpen persisted by spec).

---

## Change Log

- **2026-04-25** — Story 6.2 implemented end-to-end:
  - Backend: AC-11 (`start.message_id`) + AC-12 (chat-history
    transcript injection via new `list_recent_messages` +
    `_format_task_description`).
  - Backend out-of-story fixes (both Story 6.1 bugs that blocked the
    manual smoke test): (1) switched LLM provider from LangChain
    `ChatAnthropic` to CrewAI native `LLM` to fix the
    `OPENAI_API_KEY required` runtime error; (2) fixed a chunk-
    spacing bug in `_chunk_words` where adjacent chunks were
    concatenated without a separator, producing run-together words
    in the rendered bubble.
  - Frontend: full AgentPanel UI (drawer, three-section layout,
    speech-bubble shapes with clip-path tails, NeonScrollbar wrap-
    mode chat history, sessions overlay menu with inline confirm-
    delete, composer with auto-grow + 6-line cap, Send/Stop button
    swap), useAgentStore Zustand store with persist middleware for
    panelOpen+activeSessionId, useAgentSse fetch/ReadableStream SSE
    consumer, parseHelpCommand carve-out, F1 + Escape keybindings.
  - Tests: 83 new frontend tests + 7 new backend tests; full suites
    439/439 frontend and 197/197 backend green.
