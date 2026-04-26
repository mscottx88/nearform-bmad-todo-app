# Story 6.8: Create-Todo Skill

Status: ready-for-dev

> **Scope note:** Second proposal-producing skill in Epic 6 ("The
> Intelligent Pond Companion"). Adds a conversational `create_todo`
> skill that gathers a single new todo's details over a multi-turn
> dialogue until the user clicks **Create** to commit. Reuses the
> existing `proposal` SSE pipeline + `metadata.proposal` persistence
> machinery from story 6.3 (rephrase). NO new tools given to the LLM
> — the LLM only PROPOSES; commit goes through the existing
> `POST /api/todos` route via the user-confirmed Accept button.
>
> **Sibling pattern:** rephrase (6.3) edits ONE existing todo; this
> skill creates ONE new todo. Both follow the
> Architecture Decision 3.5 ("Proposal envelope is contractual") and
> 3.2 ("Read-only LLM in v1") contracts.

---

## ⚠️ CRITICAL CONSTITUTIONAL CONSTRAINT

**Async/await is PROHIBITED in backend code** — see [CLAUDE.md](CLAUDE.md)
§ "CONCURRENCY MODEL — THREAD-BASED ONLY". CrewAI's `crew.kickoff()`
runs synchronously on the existing daemon thread spawned by
`api/agent.py::chat()`. JavaScript/TypeScript in `frontend/` uses
async normally (the ban is Python-only).
[Source: CLAUDE.md, also confirmed in
[architecture.md#AR6-16](_bmad-output/planning-artifacts/architecture.md)]

---

## Story

As a user,
I want to ask the agent to create a new todo via natural conversation, having it ask clarifying questions and remember what I've told it across turns until the todo is ready to commit,
So that I can capture a thought without having to format the perfect single-shot request and without restating context the agent already knows.

---

## User Experience

### Happy path

1. **User:** "remind me to talk to my mum"
2. **Assistant:** "Got it — when should I set the deadline for? Or leave it open-ended?"
   *Renders a `todo_draft` proposal block under the bubble: text="talk to my mum", due_date=(none), status=Drafting.*
3. **User:** "before next sunday"
4. **Assistant:** "Sunday May 3 at 5pm — want to refine that, or shall I create it?"
   *Proposal block updates: text="talk to my mum", due_date="2026-05-03T17:00:00…", status=Ready. **Create** button is now enabled.*
5. **User clicks Create** → `POST /api/todos` fires; on success, the
   block flips to `✓ created` with a TodoLink to the newly-created pad.

### Cancel paths

- **Implicit cancel:** the user starts a new chat session, closes the
  panel, or types something that's clearly off-topic ("never mind,
  what's the weather"). The draft is abandoned in place — the
  proposal block stays in the transcript marked un-committed but no
  mutation fires.
- **Explicit Cancel button:** the proposal renderer carries a
  **Cancel** button alongside **Create**. Clicking Cancel marks the
  block as `dismissed` (local React state, identical to rephrase's
  dismiss).
- **Per-turn cancel detection:** if the user replies "actually
  scratch that", the LLM is instructed to detect cancel intent and
  emit an envelope with `status="cancelled"` so the renderer dims
  the block on its own.

### What "no repeating yourself" looks like

The skill MUST inherit context from the immediate prior assistant
turn's `metadata.proposal.payload`, the same way the rephrase skill
inherits `resolved_target_id`. So:

- Turn 1: "remind me to talk to my mum"
- Turn 2: "before sunday"
  → the skill's task description carries the prior turn's draft as
  baseline, plus the new user input. The LLM updates `due_date`
  WITHOUT being re-told what the text is.

In addition to the inherited draft, the skill consults broader chat
history (via `GetChatHistoryTool`, already in the agent's tool list)
for context not captured in a structured field. Example: an earlier
turn where the user said "I'm planning my mum's birthday party"
should let the LLM infer "talk to my mum" is birthday-related and
proactively ask "want to tag this as #birthday?" or "want to set
this before May 15?".

---

## Acceptance Criteria

### AC 1 — Backend `create_todo` skill (single-agent crew, structured output)

**Given** the agent skill registry

**When** the create_todo skill is registered

**Then** `src/agent/skills/create_todo.py` exposes a
`build(ctx: SkillContext) -> Crew` factory matching the existing
skill contract.
[Source: [6-3-rephrase-skill.md#AC 1](6-3-rephrase-skill.md);
[architecture.md](_bmad-output/planning-artifacts/architecture.md)
"CrewAI Skills Pattern P1"]

**Crew shape:**
- **Single agent** (`Todo Drafter`) constructed via
  [`build_base_agent`](backend/src/agent/skills/base.py) so the
  project's `BASE_SYSTEM_PROMPT` (untrusted-data framing, tool-use
  guardrails) is preserved.
- **One `Task`** whose description includes:
  - the prior-turn draft (if any) as baseline — see AC 2;
  - the user's natural-language message;
  - today's date + day-of-week, via the shared helper extracted in
    Task 1 (the rephrase skill currently inlines this pattern at
    `rephrase.py::_today_anchor_line`);
  - the shared untrusted-data framing constant extracted in Task 1;
  - explicit instructions to produce a `TodoDraftEnvelope` (AC 3).
- **`output_pydantic=TodoDraftEnvelope`** — CrewAI parses + validates;
  `crew_runner` consumes `CrewOutput.pydantic` directly.
- **Tools:** `[GetTodoTool, ListTodosTool, SearchTodosTool, GetChatHistoryTool]`
  via existing `session_factory` plumbing — the same read-only set
  the chat skill uses. **NO** create/update/delete tools.
  [Source: confirmed tool class names in
  [backend/src/agent/tools/](backend/src/agent/tools/)]
- **Crew config:** `process=Process.sequential`, `verbose=False`,
  single agent, single task.

**Skill registration** — `src/agent/skills/registry.py::_register_skills()`
adds:

```python
from src.agent.skills.create_todo import build as build_create_todo

SKILL_REGISTRY["create_todo"] = SkillSpec(
    name="create_todo",
    description=(
        "Create a NEW todo via conversational dialogue. The agent "
        "asks clarifying questions across turns, building up a draft "
        "until the user clicks Create. Use this for ANY request that "
        "sounds like 'add a todo', 'remind me to X', 'I need to do Y', "
        "'capture this task', etc. Do NOT use this for editing an "
        "existing todo (that's `rephrase`)."
    ),
    proposal_kind="todo_draft",
    builder=build_create_todo,
)
```

The `proposal_kind="todo_draft"` value is what flips `crew_runner`
into the parse-and-emit-proposal pipeline (existing 6.3 machinery).
[Source: [registry.py:41,52-58](backend/src/agent/skills/registry.py)
for `SkillSpec` shape; [registry.py:94-107](backend/src/agent/skills/registry.py)
for the rephrase precedent.]

### AC 2 — Cross-turn context inheritance

**Given** a chat session where the immediate prior assistant turn was
also a `create_todo` proposal

**When** the user sends a follow-up message in the same session

**Then** the skill MUST inherit the prior draft's accumulated state
(text, due_date, color) so the user doesn't repeat themselves.

**Mechanism:** mirror story 6.3's `_resolve_from_history` —
walk `ctx.history` newest → oldest, find the immediate prior
assistant message, read `metadata_.proposal.payload.draft` if
`metadata_.proposal.kind == "todo_draft"`, and surface the draft to
the task description as the baseline.

**Scope:** ONLY the immediate prior assistant turn. If the prior
turn was a different skill (e.g. rephrase) or had no proposal, fall
through to "fresh draft" — the new turn is independent.
[Source: [6-3-rephrase-skill.md§AC 2](6-3-rephrase-skill.md);
implementation pattern at
[rephrase.py:97-153](backend/src/agent/skills/rephrase.py)]

**Defence in depth:** guard `(message.metadata_ or {}).get(...)` in
case a directly-constructed `ChatMessageResponse` (test fixture,
legacy row) carries None metadata. This was a 6.3 CR patch
([rephrase.py:123](backend/src/agent/skills/rephrase.py)) and applies
identically here.

### AC 3 — `TodoDraftEnvelope` schema

**Given** the create_todo crew kicks off

**When** the LLM produces its final output (CrewAI's `output_pydantic`
path)

**Then** the output MUST conform to `src/schemas/agent.py::TodoDraftEnvelope`:

```python
class TodoDraft(BaseModel):
    """Accumulated state of the todo being drafted. Fields are all
    optional during drafting; on commit the renderer enforces `text`
    is set (POST /api/todos requires non-empty text)."""

    model_config = ConfigDict(extra="forbid")

    text: str | None = None
    due_date: str | None = None  # ISO 8601 with tz, or None
    color: str | None = None     # "#rrggbb", or None to use server default


class TodoDraftEnvelope(BaseModel):
    """Story 6.8 — structured output contract for the `create_todo` skill.

    `reasoning` becomes the chat-bubble prose (the assistant's
    plain-text response). `draft` / `status` / `clarifications` are
    rendered as a proposal block below the bubble by
    `TodoDraftProposal.tsx`. The matching frontend type is in
    `frontend/src/types/agent.ts`'s `proposal` SSE arm; keep both in
    sync.

    `extra="forbid"` is defence in depth — the LLM produces this via
    CrewAI's `output_pydantic` path, and rejecting unknown keys means
    a hallucinated `"id"` field can't slip into the proposal envelope
    and surprise the renderer.
    """

    model_config = ConfigDict(extra="forbid")

    reasoning: str
    draft: TodoDraft
    status: Literal["drafting", "ready", "cancelled"]
    clarifications: list[str] = Field(default_factory=list)
```

**Status transitions the LLM is instructed to follow:**

- **`drafting` → `drafting`:** still gathering. `text` may or may not
  be set; `due_date` may or may not be set.
- **`drafting` → `ready`:** `draft.text` is non-empty AND the LLM has
  explicit confirmation cues from the user (e.g. "yes create it" or
  "sounds good"). The LLM MUST NOT silently flip to `ready` on the
  FIRST turn even if it could infer everything — give the user one
  chance to refine. (Exception: if the user's first message is
  unambiguous AND already commit-toned, e.g. "create a todo: buy
  milk by friday — do it", `ready` on turn 1 is allowed.)
- **anything → `cancelled`:** the LLM detects cancel intent in the
  user's message ("never mind", "scratch that", "actually no"). The
  renderer dims the block.

**Why a `cancelled` envelope status (not just the Cancel button):**
the button covers the user-clicks-Cancel case. The envelope status
covers the "user pivots conversationally" case. Without an
LLM-driven cancel signal, the proposal block would linger in
`drafting` status indefinitely after the user has clearly moved on
— visually confusing.

### AC 4 — `crew_runner._extract_proposal_envelope` generalisation

**Given** the existing function locks the shape check to
`"reasoning" not in payload or "suggestions" not in payload`
([crew_runner.py:206-209](backend/src/agent/crew_runner.py))

**When** a `TodoDraftEnvelope` (which has `draft`/`status`/
`clarifications` instead of `suggestions`) flows through

**Then** the function MUST be generalised. Add a `required_keys:
list[str]` parameter that the caller specifies per-skill:

```python
def _extract_proposal_envelope(
    crew_output: Any,
    proposal_kind: str,
    resolved_target_id: uuid.UUID | None,
    resolved_candidates: Any = None,
    required_keys: list[str] = ("reasoning",),  # <-- new
) -> dict[str, Any] | _ProposalParseError:
    ...
    for key in required_keys:
        if key not in payload:
            return _ProposalParseError(
                code="agent_invalid_proposal_shape",
                message=f"Structured output is missing required key: {key}",
            )
```

The `run_crew` site that calls `_extract_proposal_envelope` reads
the required keys from a per-`proposal_kind` table:

```python
_REQUIRED_KEYS_BY_KIND: dict[str, tuple[str, ...]] = {
    "text_rewrite": ("reasoning", "suggestions"),
    "todo_draft": ("reasoning", "draft", "status"),
}
```

**Note:** The schema-level `extra="forbid"` already catches keys
that don't belong, but the runtime guard exists for cases where the
Pydantic instance is well-formed but missing optional shape — and
to give ops a clean error code rather than a downstream `KeyError`.

**`payload["candidates"] = []` reset (existing 6.3 patch at
[crew_runner.py:231-239](backend/src/agent/crew_runner.py))** — does
NOT apply to `todo_draft`; the envelope has no `candidates` field.
Leave the existing reset gated on `text_rewrite` (it already
unconditionally writes the empty list and only branches to populate
when `resolved_candidates` is truthy, so it's harmless for
`todo_draft` but worth noting for the dev: do not refactor the
candidates-reset out without checking what other kinds need).

### AC 5 — Frontend `TodoDraftProposal.tsx` renderer

**Given** an assistant message arrives with
`metadata.proposal.kind === "todo_draft"`

**When** the message renders AND `message.status === 'complete'`
(the existing status gate from 6.3 CR patch at
[AgentMessage.tsx:294-306](frontend/src/components/agent/AgentMessage.tsx))

**Then** `frontend/src/components/agent/TodoDraftProposal.tsx`
mounts as a sibling of the bubble (column-stack pattern — root
`<div className="todo-draft-proposal">` inside `agent-message__stack`).

**Layout:**

```
SUGGESTED NEW TODO  [DRAFTING]
┌─────────────────────────────────────┐
│ Text:     talk to my mum            │
│ Due:      (none)                    │
│ Color:    (default)                 │
└─────────────────────────────────────┘

  Q: When should this be due?
  Q: How important is it?

  [ Create ]   [ Cancel ]
```

**Field rows** echo the InfoPopup's `MetaRow` visual vocabulary —
label + value, monospace, neon-cyan. Empty fields render as `(none)`
placeholder (same convention as the rephrase empty-`original` patch
at [RephraseProposal.tsx:218-220](frontend/src/components/agent/RephraseProposal.tsx)).

**Status pill** in the header (`Drafting` / `Ready` / `Cancelled` /
`Created`) so the user always knows which state the dialogue is in.

**Clarifications** (from `envelope.clarifications`) render as
chip-styled buttons. Clicking one fires
`useAgentStore.getState().sendMessage(question, { skill: 'create_todo' })`
— the user can edit before sending, and the chip prefills the
composer rather than sending immediately. (Mirror the candidate-chip
prior-message-preservation pattern from 6.3 CR patch at
[RephraseProposal.tsx:296-318](frontend/src/components/agent/RephraseProposal.tsx) —
do NOT lose conversational context.)

**Create button:**
- Disabled when `status !== 'ready'`.
- Disabled when `draft.text` is empty (defence — the LLM could emit
  `status="ready"` with empty text via a bug).
- Disabled while `useCreateTodo().isPending` (folds into
  `acceptDisabled`, mirroring the 6.3 dual-click guard).
- On click, fires `useCreateTodo().mutate({ text, color, dueDate })`.
  On success, the block flips to a `✓ created` state with a
  `TodoLink` (existing component used in chat bubbles —
  [TodoLink.tsx](frontend/src/components/agent/TodoLink.tsx)) to the
  new pad's id.

**Cancel button:**
- Always visible while the block is in `drafting` or `ready` status.
- Hidden in `cancelled` and `created` states.
- Click marks the block `dismissed` (local React state); both
  buttons hide.

**`status === 'cancelled'`** dims the block (CSS opacity 0.5) and
hides both buttons. No further interaction.

### AC 6 — Frontend SSE event extension (no new types)

The existing `proposal` SSE event in
[types/agent.ts:69-77](frontend/src/types/agent.ts) already carries
`kind: string` + `payload: Record<string, unknown>`, so no type
extension is needed — the renderer narrows by `kind`.

`AgentMessage.tsx`'s switch-on-kind block adds a third arm:
- `'text_rewrite' → RephraseProposal`
- `'todo_draft' → TodoDraftProposal` (new)

[Source: [AgentMessage.tsx:298-309](frontend/src/components/agent/AgentMessage.tsx)
for the existing switch site.]

`useAgentStore.ts::ingestSseEvent` already handles `proposal` events
generically (writes to `metadata.proposal`, doesn't touch
`content` / `streamingBuffer`). No store changes needed.
[Source: [useAgentStore.ts:417-447](frontend/src/stores/useAgentStore.ts)]

### AC 7 — Frontend `useCreateTodo` widening: `dueDate` support

**Given** the existing
[useCreateTodo](frontend/src/api/todoApi.ts) hook only accepts
`{ text, color?, positionX?, positionY? }` —
[CreateTodoInput at todoApi.ts:63-77](frontend/src/api/todoApi.ts)

**When** the create_todo skill emits a draft with `due_date` set
(common path — "remind me to call my mum by sunday")

**Then** the `CreateTodoInput` interface MUST be widened to include
`dueDate?: string | null` so the renderer can pass it through
without a follow-up PATCH call.

The backend's `TodoCreate` schema **already accepts** `due_date:
datetime | None = None`
([backend/src/schemas/todo.py:21-28](backend/src/schemas/todo.py)),
so this is a frontend-only widening — no backend change needed.

axios's request interceptor decamelizes `dueDate` → `due_date` on
the wire automatically, matching the rephrase-skill pattern at
[todoApi.ts UpdateTodoInput#dueDate](frontend/src/api/todoApi.ts).

### AC 8 — Backend safety: nothing new

The Create button fires `POST /api/todos` which is the existing
endpoint with the existing `TodoCreate` schema. No new validation,
no new field allowlists. The LLM never gets a Create tool, so an
"escaped" prompt-injection that says "create 100 todos" can't fire
— the LLM can only PROPOSE one draft per turn, and the user has to
click Create.

`TodoCreate` does NOT have `extra="forbid"` set (intentionally —
it's the legacy-permissive default; the LLM mutation surface is
TodoUpdate which DOES have `extra="forbid"` per 6.3 AC 7). Keep
this as-is; the create payload from the renderer is built from a
known-shape `TodoDraft`, so unknown keys can't slip in.

### AC 9 — Tests

**Backend (pytest):**

- `tests/agent/test_create_todo_skill.py`:
  - **build()** returns a Crew with one agent and one task; assert
    the task description includes the untrusted-data framing
    literal, today's date anchor line, and the
    `output_pydantic=TodoDraftEnvelope` is wired on the Task.
  - **Cross-turn inheritance:** a SkillContext with `history`
    containing a prior assistant message whose
    `metadata_.proposal.payload.draft` carries a partial draft →
    the new task description includes that draft as baseline.
  - **History inheritance ignores prior turns from OTHER skills:**
    the loop walks immediate-prior only and bails on
    non-`todo_draft` proposals.
  - **None-metadata guard:** a directly-constructed
    `ChatMessageResponse` with `metadata_=None` (or empty dict)
    must not crash the inheritance walker.
  - **Empty history / fresh session:** skill produces a "fresh
    draft" task description (no inherited fields).
  - **Empty user message edge:** `ctx.user_message=""` → handled
    gracefully (don't crash the kickoff).

- `tests/agent/test_crew_runner_proposal.py`:
  - **`_extract_proposal_envelope` accepts a `TodoDraftEnvelope`**
    and produces `kind="todo_draft"` + payload with `draft`,
    `status`, `clarifications` round-tripped, and `reasoning`
    hoisted to the top level.
  - **Per-kind required-keys table:** missing `draft` key on a
    `todo_draft` envelope returns `agent_invalid_proposal_shape`
    with the specific missing-key in the message.
  - **Regression guard:** the existing rephrase shape-error tests
    still pass after the generalisation.

- `tests/api/test_agent.py`:
  - **End-to-end POST** to the chat endpoint with `skill="create_todo"`
    and a "remind me to..." message → SSE stream contains a
    `proposal` event with `kind="todo_draft"` and a sensible draft
    payload. (Mock the LLM to deterministically return a known
    envelope.)
  - **Intent classifier** routes "remind me to call my mum" to
    `create_todo` (mock LLM to return that classification).

- `tests/schemas/test_agent_schemas.py` (or wherever schema tests
  live):
  - `TodoDraftEnvelope.model_validate({"reasoning": "x", "draft":
    {}, "status": "drafting", "extra_key": 1})` raises
    `ValidationError` with `extra_forbidden`.

**Frontend (vitest):**

- `TodoDraftProposal.test.tsx`:
  - Renders `(none)` for unset fields.
  - Status pill reflects `envelope.status`.
  - Create button disabled when `status="drafting"`, enabled when
    `status="ready"`.
  - Create button disabled when `draft.text` is empty even at
    `status="ready"`.
  - Create button disabled while `useCreateTodo().isPending`.
  - Clicking Create fires `useCreateTodo().mutate({ text, dueDate, color })`
    with the right camelCase payload.
  - Clicking Cancel hides the buttons; mutate not called.
  - `status="cancelled"` dims the block (class assertion); both
    buttons hidden.
  - Clarification chips fire `sendMessage` with the question text
    and `skill: 'create_todo'`.
  - On mutation success, block flips to `✓ created` and renders a
    `TodoLink` for the newly-created todo id.

- `useAgentStore.test.ts`:
  - `ingestSseEvent` handles a `todo_draft` proposal event the same
    way it handles `text_rewrite` (writes to `metadata.proposal`,
    leaves `content` / `streamingBuffer` alone). (Existing test for
    `text_rewrite` covers the generic path; one parallel test for
    `todo_draft` is enough — they go through the same code branch.)

- `AgentMessage.test.tsx`:
  - Renders `TodoDraftProposal` sibling when
    `metadata.proposal.kind === 'todo_draft'` AND
    `status === 'complete'`.
  - Does NOT render any proposal renderer when `status === 'cancelled'`
    even if `metadata.proposal` is set (existing 6.3 status-gate
    test covers this generically; mirror it for `todo_draft`).

- `todoApi.test.ts`:
  - `useCreateTodo({ text, dueDate })` fires a POST with the
    decamelized body containing `due_date`. (Asserts the new
    field threads through correctly.)

### AC 10 — Definition of Done gates

- All ACs satisfied with code + tests.
- Lint clean: `cd backend && uv run ruff check .` + `ruff format --check .`
- Types clean: `cd backend && uv run mypy .` and `cd frontend && npx tsc --noEmit`
- Tests green: full pytest + vitest suites.
- No async/await in backend.
- A short manual smoke test recorded in Dev Notes: dev runs the
  panel, types "remind me to call my mum" + "by next sunday" + clicks
  Create, sees a new pad appear in the pond.
- Pre-commit hooks pass (ruff, mypy, pytest, conventional-commit).

---

## Tasks / Subtasks

### Task 1 — Backend: shared helper extraction (AC 1, AC 2)

The rephrase skill currently inlines two helpers that the new skill
needs identical access to. Extract them into a shared module so the
two skills don't drift.

- [ ] Create `backend/src/agent/skills/_helpers.py` (private
  underscore-prefixed module to flag it as "shared inside the
  skills package").
- [ ] Move `_today_anchor_line(today: date) -> str` from
  `rephrase.py` to `_helpers.py` as public `today_anchor_line`.
  Update `rephrase.py` to import it. Existing rephrase tests
  (especially `test_normal_path_includes_today_date_anchor`) MUST
  still pass without modification — keep the function signature
  identical.
- [ ] Move the `_REPHRASE_UNTRUSTED_DATA_FRAMING` constant pattern
  to a single canonical `UNTRUSTED_DATA_FRAMING` constant in
  `_helpers.py` covering the full text. Update `rephrase.py`,
  `chat.py`, and `intent_classifier.py` to import the SAME constant
  if their existing variants are textually equivalent (verify
  before merging — the rephrase / chat / classifier framings are
  similar but not byte-identical; if any has skill-specific text,
  leave it local).
- [ ] DO NOT extract `_resolve_from_history` from rephrase.py — the
  read path is skill-specific (rephrase reads
  `proposal.targets[0]`; create_todo reads `proposal.payload.draft`).
  Each skill keeps its own resolver.

### Task 2 — Backend: schema (AC 3)

- [ ] Add `TodoDraft` and `TodoDraftEnvelope` to `src/schemas/agent.py`.
  Both with `model_config = ConfigDict(extra="forbid")`.
- [ ] Schema-level test asserting the envelope rejects unknown keys
  with `extra_forbidden`.

### Task 3 — Backend: `create_todo` skill module (AC 1, AC 2)

- [ ] Create `src/agent/skills/create_todo.py` mirroring the
  rephrase shape:
  - `_resolve_draft_from_history(ctx) -> TodoDraft | None` —
    inherits from prior turn's `metadata_.proposal.payload.draft`,
    None-guarded.
  - `_build_task_description(user_message, prior_draft, today)` —
    composes the prompt with framing + today-anchor + prior draft
    + new user input.
  - `build(ctx) -> Crew` — wires the agent (via `build_base_agent`),
    the task (with `output_pydantic=TodoDraftEnvelope`), and the
    crew. Tools: `[GetTodoTool, ListTodosTool, SearchTodosTool,
    GetChatHistoryTool]`.
- [ ] No `object.__setattr__` on `ctx` is needed for this skill —
  the inherited draft is consumed in `_build_task_description` and
  the LLM emits the new draft directly. (The frozen-dataclass
  publish channel rephrase uses for `resolved_target_id` doesn't
  apply.)

### Task 4 — Backend: registry (AC 1)

- [ ] Register `create_todo` in `src/agent/skills/registry.py` with
  the description text from AC 1 (directive enough that the intent
  classifier picks it up for "remind me to..." / "I need to..." /
  "add a task..." phrases).

### Task 5 — Backend: crew_runner generalisation (AC 4)

- [ ] In `src/agent/crew_runner.py`, add a `_REQUIRED_KEYS_BY_KIND`
  table at module scope with `text_rewrite` and `todo_draft`
  entries.
- [ ] Add `required_keys: tuple[str, ...] = ("reasoning",)`
  parameter to `_extract_proposal_envelope`. Replace the hardcoded
  `"reasoning" not in payload or "suggestions" not in payload`
  check with a loop over `required_keys`.
- [ ] In the `run_crew` call site, look up the required keys via
  `_REQUIRED_KEYS_BY_KIND.get(spec.proposal_kind, ("reasoning",))`
  and pass to `_extract_proposal_envelope`.
- [ ] Tests in `test_crew_runner_proposal.py` per AC 9.

### Task 6 — Backend: intent classifier description (AC 1)

- [ ] The intent classifier prompt is built from `SkillSpec.description`
  fields ([intent_classifier.py](backend/src/agent/skills/intent_classifier.py))
  — the registry change in Task 4 automatically makes the new
  skill discoverable. Verify by test that "remind me to call my
  mum" routes to `create_todo` (Task 9 below).

### Task 7 — Frontend: `useCreateTodo` widening (AC 7)

- [ ] In `frontend/src/api/todoApi.ts`, extend `CreateTodoInput`
  with `dueDate?: string | null`. The axios request interceptor
  already handles the camel→snake decamelization.
- [ ] Add a test in `todoApi.test.ts` that
  `useCreateTodo({ text, dueDate })` fires a POST whose body
  contains `due_date`.

### Task 8 — Frontend: `TodoDraftProposal.tsx` renderer (AC 5, AC 6)

- [ ] Create `frontend/src/components/agent/TodoDraftProposal.tsx`
  mirroring `RephraseProposal.tsx`'s structure.
- [ ] Field rows reuse the InfoPopup's `MetaRow`-style styling.
- [ ] Status pill in the header.
- [ ] Clarification chips fire
  `useAgentStore.getState().sendMessage(question, { skill: 'create_todo' })`.
  (The chip prefills the composer rather than auto-sending — match
  the candidate-chip preserve-prior-message pattern from rephrase.)
- [ ] Create button: gated on
  `status === 'ready' && draft.text && !createTodo.isPending`.
  Click fires `useCreateTodo().mutate(...)`. On success, render a
  `TodoLink` for the new id.
- [ ] Cancel button: local dismiss state; hides both buttons.
- [ ] `status === 'cancelled'` → dim the block (`opacity: 0.5`),
  hide both buttons.
- [ ] CSS at `TodoDraftProposal.css` matching the agent panel
  vocabulary (var(--neon-cyan), monospace, glow-on-hover for
  buttons).
- [ ] Component tests per AC 9.

### Task 9 — Frontend: AgentMessage proposal switch (AC 5)

- [ ] Add `'todo_draft' → TodoDraftProposal` arm to the kind-switch
  in `AgentMessage.tsx`. Keep the existing
  `message.status === 'complete'` gate.
- [ ] Component test per AC 9.

### Task 10 — Polish + run all gates (AC 10)

- [ ] Format + lint + type-check + full test suites.
- [ ] Manual smoke test: open panel, type "remind me to call my
  mum" + "by next sunday", click Create, see a new pad appear.
  Record outcome in Dev Notes.
- [ ] Story flipped to `review`; sprint-status.yaml synced.

---

## Dev Notes

### Patches to bake in upfront (lessons from 6.3 code review)

These were all surfaced in the 6.3 CR and patched after-the-fact;
this story is the moment to bake them in preemptively.

1. **Inject today's date into the task prompt.** Without this, the
   LLM anchors date phrases like "May 1" to its training-data prior
   (off-by-one year). [Source: 6.3 CR — `rephrase.py:_build_task_description`
   patch.] **Mitigation:** use the shared `today_anchor_line` helper
   from Task 1.

2. **Strip reasoning prose before stream / persist.** The proposal
   path doesn't pass through `str(result).strip()` like the chat
   path; trailing whitespace creates empty chunks. [Source: 6.3 CR —
   `crew_runner.py:reasoning.strip()` patch at line 220.] **Mitigation:**
   the existing `_extract_proposal_envelope` already does this since
   the 6.3 fix landed; verify it covers the new envelope.

3. **Status-gate the renderer on `message.status === 'complete'`.**
   A cancel that fires after the proposal SSE emit otherwise leaves
   clickable Accept buttons on a cancelled bubble. [Source: 6.3 CR —
   `AgentMessage.tsx:294-306` patch.] **Mitigation:** Task 9 explicitly
   keeps this gate.

4. **Null-guard `message.metadata` in `readProposalMetadata`.** Older
   chat_messages rows with `metadata=null` would crash the cast.
   [Source: 6.3 CR — `AgentMessage.tsx:309-340` patch.] **Mitigation:**
   reuse the existing helper (already null-guarded) — Task 9's
   kind-switch sits AFTER the helper call.

5. **Disable Accept while mutation pending.** Dual-clicks
   double-mutate without this. [Source: 6.3 CR —
   `RephraseProposal.tsx:122-148` patch.] **Mitigation:** Task 8's
   gate explicitly includes `useCreateTodo().isPending`.

6. **Reset payload-array fields the resolver owns to `[]`
   unconditionally before stamping.** Prevents an LLM-supplied
   `candidates` list (or other server-owned field) from leaking.
   [Source: 6.3 CR — `crew_runner.py:_extract_proposal_envelope`
   patch.] **Note:** `TodoDraftEnvelope` has no server-owned
   payload field, so this discipline is moot for this story —
   but if a future enhancement adds one, follow the pattern.

### File locations summary (AT LAW: do not place files elsewhere)

**New backend files:**
- `backend/src/agent/skills/_helpers.py` — shared helpers (Task 1)
- `backend/src/agent/skills/create_todo.py` — the skill (Task 3)
- `backend/tests/agent/test_create_todo_skill.py` — unit tests
- `backend/tests/schemas/test_agent_schemas.py` — schema tests
  (only if it doesn't already exist; otherwise extend)

**Modified backend files:**
- `backend/src/agent/skills/rephrase.py` — import shared helpers
- `backend/src/agent/skills/chat.py` — import shared framing constant
  (only if textually equivalent — verify first)
- `backend/src/agent/skills/intent_classifier.py` — same caveat
- `backend/src/agent/skills/registry.py` — register create_todo
- `backend/src/agent/crew_runner.py` — required-keys table +
  parameter
- `backend/src/schemas/agent.py` — add TodoDraft / TodoDraftEnvelope
- `backend/tests/agent/test_crew_runner_proposal.py` —
  generalisation tests
- `backend/tests/api/test_agent.py` — E2E + classifier routing
- `backend/tests/agent/test_rephrase_skill.py` — verify
  helper-extraction didn't regress (no new tests — existing should
  still pass unmodified)

**New frontend files:**
- `frontend/src/components/agent/TodoDraftProposal.tsx` (Task 8)
- `frontend/src/components/agent/TodoDraftProposal.test.tsx`
- `frontend/src/components/agent/TodoDraftProposal.css`

**Modified frontend files:**
- `frontend/src/api/todoApi.ts` — `CreateTodoInput.dueDate` (Task 7)
- `frontend/src/api/todoApi.test.ts` — dueDate threading test
- `frontend/src/components/agent/AgentMessage.tsx` — kind-switch arm
  (Task 9)
- `frontend/src/components/agent/AgentMessage.test.tsx` —
  todo_draft render test
- `frontend/src/stores/useAgentStore.test.ts` — todo_draft proposal
  ingest test (one parallel test, not a new branch)

### What v1 explicitly does NOT do

- **No bulk creation.** "Create three todos for groceries: bread,
  milk, eggs" should be rejected by the prompt with a "v1 supports
  one todo at a time — want me to start with the first?" reply.
  Bulk creation is a possible follow-up story.
- **No position selection.** The new todo gets the server's default
  positioning (random within the pond). The user can drag it after
  creation.
- **No tags / labels / projects.** The data model has no tag column;
  out of scope.
- **No rich-text formatting in the draft text.** Plain string only.
- **No undo button on the proposal.** Once Created, the user uses
  the pad's existing Delete affordance to remove a regretted todo.

### Integration with rephrase chip-dispatch (post-create polish)

A possible UX win: after a successful create, the `✓ created` block
could render a small "rephrase this?" chip that fires the rephrase
skill with `context.todo_ids=[new.id]`. **Out of scope for v1** but
worth noting — the plumbing already exists.

### Constitutional-compliance reminders

- No `async def`, no `await`, no `asyncio` anywhere in this story's
  backend diff. CrewAI's kickoff is synchronous; `useCreateTodo` is
  the existing thread-safe React Query hook firing `POST /api/todos`.
- The new `_helpers.py` module is pure functions — zero async, zero
  state.

### Project Structure Notes

Aligns with the unified BMad project structure
([architecture.md](_bmad-output/planning-artifacts/architecture.md)):
all backend skill files live under `backend/src/agent/skills/`; all
proposal renderers live under `frontend/src/components/agent/`. No
new top-level directories.

**Detected variance:** the architecture document calls for skills to
live in `src\agent\skills\<skill>.py` (Pattern P1, line 1451). The
codebase uses the same path. Helper extraction adds a private
`_helpers.py` peer — no architectural conflict; it's an internal
implementation detail of the skills package.

### References

- [6-3-rephrase-skill.md](6-3-rephrase-skill.md) — closest sibling
  pattern; mirror its skill-module / schema / renderer structure
  exactly. Especially see § Review Findings for the patches this
  story bakes in upfront.
- [architecture.md](_bmad-output/planning-artifacts/architecture.md)
  Decision 3.2 ("Read-only LLM in v1") and 3.5 ("Proposal envelope
  contractual"); CrewAI Skills Pattern P1–P7 (line 1451+); AR6-16
  (thread-based concurrency).
- [epics.md](_bmad-output/planning-artifacts/epics.md) Epic 6 —
  "The Intelligent Pond Companion" (lines 199-212). Note: the
  original epic does NOT enumerate a `create_todo` skill (it lists
  rephrase, plan, organize, reformat). This story adds the
  conversational-create capability per user request 2026-04-26.
  Plan skill (story 6.4, backlog) takes a related but distinct path
  (multi-todo plan creation); the two skills will coexist.
- [CLAUDE.md](CLAUDE.md) § "CONCURRENCY MODEL — THREAD-BASED ONLY"
  — applies in full to this story's backend code.
- [backend/src/agent/skills/rephrase.py](backend/src/agent/skills/rephrase.py)
  — implementation reference.
- [backend/src/agent/crew_runner.py:171-243](backend/src/agent/crew_runner.py)
  — `_extract_proposal_envelope` to generalise.
- [backend/src/schemas/todo.py:21-28](backend/src/schemas/todo.py)
  — `TodoCreate` already accepts `due_date: datetime | None`.
- [frontend/src/components/agent/RephraseProposal.tsx](frontend/src/components/agent/RephraseProposal.tsx)
  — renderer reference.
- [frontend/src/api/todoApi.ts](frontend/src/api/todoApi.ts) —
  `useCreateTodo` widening point.

---

## Story DoD (Definition of Done)

- [ ] All ACs (1-10) satisfied.
- [ ] All Tasks (1-10) checked off.
- [ ] Backend tests green (target: existing 249 + ~12 new).
- [ ] Frontend tests green (target: existing 560 + ~12 new).
- [ ] `ruff check`, `ruff format --check`, `mypy` clean.
- [ ] `npx tsc --noEmit` clean (no eslint regressions introduced;
  pre-existing eslint warnings in unrelated files are acceptable).
- [ ] Manual smoke test passes ("remind me to call my mum" →
  multi-turn refinement → Create → pad appears in pond).
- [ ] No async/await in backend code (constitutional).
- [ ] Story status flipped to `review`; sprint-status.yaml synced.
- [ ] Code review run (bmad-code-review skill) and review findings
  triaged before flipping to `done`.

---

## Dev Agent Record

### Agent Model Used

(populated by Dev agent on implementation)

### Debug Log References

(populated by Dev agent)

### Completion Notes List

(populated by Dev agent)

### File List

(populated by Dev agent)

### Change Log

| Date | Change |
|---|---|
| 2026-04-26 | Story drafted in conversation by Michael; v1 captured at backlog. Mirrors 6.3 proposal-envelope architecture; LLM stays read-only; commits via existing POST /api/todos. Cross-turn draft inheritance via metadata.proposal; three-way envelope status (drafting/ready/cancelled); clarification-chip dispatch. |
| 2026-04-26 | v2 — bmad-create-story workflow run. Added: (a) AC 4 explicitly generalising `crew_runner._extract_proposal_envelope` with a per-kind required-keys table; (b) AC 7 widening `CreateTodoInput.dueDate` (frontend hook only — backend `TodoCreate` already accepts the field); (c) Task 1 shared-helper extraction (`today_anchor_line` + `UNTRUSTED_DATA_FRAMING`) so 6.3 and this story stop diverging on prompt machinery; (d) "Patches to bake in upfront" Dev Note enumerating the 6.3 review findings that apply preemptively to a sibling skill (today-date inject, status-gate render, null-guard metadata, disable-while-pending Accept, payload-reset discipline); (e) explicit references with file paths + line numbers throughout. Status flipped backlog → ready-for-dev. |
