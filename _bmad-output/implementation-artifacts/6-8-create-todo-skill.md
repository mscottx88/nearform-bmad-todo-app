# Story 6.8: Create-Todo Skill

Status: backlog

> **Scope note:** Second proposal-producing skill in Epic 6 ("The
> Intelligent Pond Companion"). Adds a conversational `create_todo`
> skill that gathers the todo's details over a multi-turn dialogue
> until the user clicks **Create** to commit. Reuses the existing
> `proposal` SSE pipeline + `metadata.proposal` persistence (story 6.3
> machinery) so the renderer pattern is unchanged. NO new tools given
> to the LLM — the LLM only PROPOSES; commit goes through the existing
> `POST /api/todos` route via the user-confirmation Accept button.
>
> **Sibling pattern:** rephrase (6.3) edits ONE existing todo; this
> skill creates ONE new todo. Both follow the
> Architecture Decision 3.2 read-only-LLM contract.

---

## ⚠️ CRITICAL CONSTITUTIONAL CONSTRAINT

**Async/await is PROHIBITED in backend code** — see [CLAUDE.md](CLAUDE.md)
§ "CONCURRENCY MODEL — THREAD-BASED ONLY". CrewAI's `crew.kickoff()`
runs synchronously on the existing daemon thread. JavaScript/TypeScript
in `frontend/` uses async normally (the ban is Python-only).

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
  panel, or simply types something that's clearly off-topic ("never
  mind, what's the weather"). The draft is abandoned — the proposal
  block stays in the transcript marked as un-committed but no
  mutation fires.
- **Explicit cancel button:** the proposal renderer carries a
  **Cancel** button alongside **Create**. Clicking Cancel marks the
  draft block as `dismissed` (local-only — server-side draft state
  doesn't exist; "draft" is purely the metadata.proposal envelope on
  the assistant row).
- **Per-turn:** if the user replies "actually scratch that", the LLM
  is instructed to detect cancel intent and emit an envelope with
  `status="cancelled"` so the renderer dims the block.

### What "no repeating yourself" looks like

The skill MUST inherit context from the immediate prior assistant
turn's `metadata.proposal.payload`, the same way the rephrase skill
inherits `resolved_target_id`. So:

- Turn 1: "remind me to talk to my mum"
- Turn 2: "before sunday"
  → the skill's task description carries the prior turn's draft as
  baseline, plus the new user input. The LLM updates `due_date`
  WITHOUT being re-told what the text is.

---

## Acceptance Criteria

### AC 1 — Backend `create_todo` skill (single-agent crew, structured output)

**Given** the agent skill registry

**When** the create_todo skill is registered

**Then** `src/agent/skills/create_todo.py` exposes a
`build(ctx: SkillContext) -> Crew` factory matching the existing skill
contract (see [skills/rephrase.py](backend/src/agent/skills/rephrase.py) for the closest precedent).

**Crew shape:**
- **Single agent** (`Todo Drafter`) constructed via `build_base_agent`
  so the project's `BASE_SYSTEM_PROMPT` (untrusted-data framing,
  tool-use guardrails) is preserved.
- **One `Task`** whose description includes:
  - the prior-turn draft (if any) so the model can incrementally
    refine it (see AC 2 — context inheritance);
  - the user's natural-language message;
  - today's date + day-of-week (same anchor line story 6.3 added,
    extracted to a shared helper if practical) so date phrasing
    anchors to the calendar;
  - the same untrusted-data framing block other skills use;
  - explicit instructions to produce a `TodoDraftEnvelope` (see AC 3).
- **`output_pydantic=TodoDraftEnvelope`** — CrewAI parses + validates;
  `crew_runner` consumes `CrewOutput.pydantic` directly.
- **Tools:** `[GetTodoTool, ListTodosTool, SearchTool, GetChatHistoryTool]`
  — the same read-only set the chat skill uses. **NO** `CreateTodoTool`,
  `UpdateTodoTool`, etc. Mutations are out of scope per Architecture
  Decision 3.2.
- **Crew config:** `process=Process.sequential`, `verbose=False`,
  single agent, single task.

**Skill registration** — `_register_skills()` adds:

```python
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

### AC 2 — Cross-turn context inheritance

**Given** a chat session where the immediate prior assistant turn was
also a `create_todo` proposal

**When** the user sends a follow-up message in the same session

**Then** the skill MUST inherit the prior draft's accumulated state so
the user doesn't repeat themselves.

**Mechanism:** mirror story 6.3's `_resolve_from_history` —
walk `ctx.history` newest → oldest, find the immediate prior assistant
message, read `metadata_.proposal.payload` if `metadata_.proposal.kind == "todo_draft"`,
and surface it to the task description as the baseline.

**Scope:** ONLY the immediate prior assistant turn. If the prior turn
was a different skill (e.g. rephrase) or had no proposal, fall through
to "fresh draft" — the new turn is independent.

**Conversation-context awareness:** in addition to the inherited
draft, the skill should consult the chat history (via `GetChatHistoryTool`,
already in the agent's tool list) for additional context that wasn't
captured in a structured field. Example: an earlier turn where the
user said "I'm planning my mum's birthday party" should let the LLM
infer that "talk to my mum" is birthday-related and proactively ask
"want to tag this as #birthday or set it before May 15 (her birthday)?".

### AC 3 — `TodoDraftEnvelope` schema

**Given** the create_todo crew kicks off

**When** the LLM produces its final output (CrewAI's `output_pydantic`
path)

**Then** the output MUST conform to `src/schemas/agent.py::TodoDraftEnvelope`:

```python
class TodoDraftEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reasoning: str   # 1-2 sentences, becomes the assistant chat-bubble prose
    draft: TodoDraft # accumulated todo state
    status: Literal["drafting", "ready", "cancelled"]
    # When `status="ready"`, the LLM is signalling that the draft is
    # complete enough to commit (renderer enables the Create button).
    # When `status="drafting"`, the LLM is still gathering details
    # (renderer keeps Create disabled, shows "fill in more details" hint).
    # When `status="cancelled"`, the user signalled abort; renderer
    # dims the block and shows no action buttons.
    clarifications: list[str] = []
    # Optional list of one-line questions the LLM wants the user to
    # answer next (e.g. ["When should this be due?", "How important is it?"]).
    # The renderer can show them as inline tappable suggestions to
    # keep the interaction tight.
```

```python
class TodoDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str | None = None
    # Required on commit; optional during drafting because turn 1
    # might just be "I want to add a todo".
    due_date: str | None = None  # ISO 8601 with tz, or None
    color: str | None = None     # "#rrggbb", or None to use server default
```

The wire shape mirrors the rephrase envelope's two-layer structure
(top-level `reasoning` + `kind`-specific `payload`) so the existing
`crew_runner._extract_proposal_envelope` works without modification —
`reasoning` is hoisted out, the rest becomes `payload`.

**Status transitions the LLM is instructed to follow:**

- **`drafting` → `drafting`:** still gathering. `text` may or may not
  be set; `due_date` may or may not be set.
- **`drafting` → `ready`:** all required fields are set AND the LLM
  has confirmation cues from the user (e.g. "yes create it" or no
  more questions). The LLM should NOT silently flip to `ready` on
  the FIRST turn even if it could infer everything — give the user
  one chance to refine.
- **anything → `cancelled`:** the LLM detects cancel intent in the
  user's message ("never mind", "scratch that", "actually no"). The
  renderer dims the block.

### AC 4 — `crew_runner` reuse (no changes needed)

The existing `_extract_proposal_envelope` + `proposal` SSE event
pipeline (landed in story 6.3) handles `todo_draft` envelopes
unchanged — the function takes `proposal_kind` as a parameter and
shape-checks for `reasoning` + the rest of the payload generically.

**Verify by test, not by code change.** A test in
`test_crew_runner_proposal.py` should drive a mock crew that returns
a `TodoDraftEnvelope` and assert the `proposal` event payload carries
`kind="todo_draft"` and the draft fields round-trip.

If `_extract_proposal_envelope` turns out to need a per-kind
adjustment (e.g. its current shape-check requires `suggestions` —
looking at line 206 it does), that's a generalisation to land in
this story, NOT a new code path. Replace the hardcoded
`"suggestions" not in payload` check with a per-kind required-keys
table or just drop it (the Pydantic schema already enforces shape
via `extra="forbid"`).

### AC 5 — Frontend `TodoDraftProposal.tsx` renderer

**Given** an assistant message arrives with `metadata.proposal.kind === "todo_draft"`

**When** the message renders

**Then** `frontend/src/components/agent/TodoDraftProposal.tsx`
mounts as a sibling of the bubble (same column-stack pattern as
`RephraseProposal`).

**Layout:**

```
SUGGESTED NEW TODO
┌─────────────────────────────────────┐
│ Text:     talk to my mum            │
│ Due:      2026-05-03 17:00 (in 7d)  │
│ Color:    #00eeff                   │
└─────────────────────────────────────┘

  Q: When should this be due?
  Q: How important is it?

  [ Create ]   [ Cancel ]
```

**Field rows** echo the InfoPopup's MetaRow visual vocabulary —
label + value, monospace, neon-cyan. Empty fields render as
`(none)` placeholder (same convention as the rephrase
empty-`original` patch).

**Clarifications** (from `envelope.clarifications`) render as
chip-styled buttons. Clicking one fires `sendMessage(question, ...)`
with the question prefilled — the user can edit before sending.
This makes the back-and-forth tighter without robbing the user of
agency.

**Create button** is disabled when `status !== "ready"`. On click,
fires `useCreateTodo().mutate({ text, dueDate, color })` which is
the existing hook (no new mutation surface). On success, the block
flips to a `✓ created` state with a `TodoLink` (the existing
component used in chat bubbles) to the new pad's id; the user can
click it to focus the camera on the new pad.

**Cancel button** marks the block as `dismissed` (local React state,
identical to rephrase's dismiss). Both buttons are then hidden.

**Status pill** (Drafting / Ready / Cancelled / Created) sits in the
header so the user always knows which state the dialogue is in.

### AC 6 — Frontend SSE event extension (no changes needed)

The existing `proposal` SSE event in `types/agent.ts` (story 6.3)
already carries `kind: string` + `payload: Record<string, unknown>`,
so no type extension is needed — the renderer narrows by `kind`.

`AgentMessage.tsx`'s switch-on-kind block adds a third arm:
`'text_rewrite' → RephraseProposal`, `'todo_draft' → TodoDraftProposal`.

### AC 7 — Backend safety: nothing new

The Create button fires `POST /api/todos` which is the existing
endpoint with the existing `TodoCreate` schema. No new validation,
no new field allowlists. The LLM never gets a Create tool, so an
"escaped" prompt-injection that says "create 100 todos" can't fire
— the LLM can only PROPOSE one draft per turn, and the user has to
click Create.

### AC 8 — Tests

**Backend (pytest):**
- `tests/agent/test_create_todo_skill.py`:
  - `build()` returns a Crew with one agent and one task; assert the
    task description includes the untrusted-data framing literal,
    today's date anchor line, AND the `output_pydantic` is wired to
    `TodoDraftEnvelope`.
  - Cross-turn inheritance: a SkillContext with `history` containing
    a prior assistant message whose `metadata_.proposal.payload`
    carries a partial draft → the new task description includes that
    draft as baseline.
  - History inheritance ignores prior turns from OTHER skills (e.g.
    rephrase) — the loop walks immediate-prior only and bails on
    non-`todo_draft` proposals.
  - Empty history / fresh session: skill produces a "fresh draft"
    task description (no inherited fields).
  - Empty user message edge: `ctx.user_message=""` → handled
    gracefully (don't crash the kickoff).
- `tests/agent/test_crew_runner_proposal.py`:
  - `_extract_proposal_envelope` accepts a `TodoDraftEnvelope`
    instance and produces `kind="todo_draft"` + payload with
    `draft`, `status`, `clarifications` round-tripped.
  - Generalisation guard: if the existing `"suggestions" not in payload`
    check is replaced with a per-kind table or dropped, the
    rephrase shape-error tests must still pass.
- `tests/api/test_agent.py`:
  - End-to-end POST to the chat endpoint with `skill="create_todo"`
    (or `skill=null` and a "remind me to..." message that the intent
    classifier routes to `create_todo`) → SSE stream contains a
    `proposal` event with `kind="todo_draft"`.

**Frontend (vitest):**
- `TodoDraftProposal.test.tsx`:
  - Renders `(none)` for unset fields.
  - Create button disabled when `status="drafting"`, enabled when
    `status="ready"`.
  - Clicking Create fires `useCreateTodo().mutate({ text, dueDate, color })`
    with the right payload.
  - Clicking Cancel hides the buttons; mutate not called.
  - `status="cancelled"` dims the block; both buttons hidden.
  - Clarification chips fire `sendMessage` with the question text.
  - On mutation success, block flips to `✓ created` and renders a
    `TodoLink` for the newly-created todo id.
- `useAgentStore.test.ts`:
  - `ingestSseEvent` handles a `todo_draft` proposal event the same
    way it handles `text_rewrite` (writes to `metadata.proposal`,
    leaves `content` / `streamingBuffer` alone).

### AC 9 — Definition of done gates

- All ACs satisfied with code + tests.
- Lint clean: `cd backend && uv run ruff check .` + `ruff format --check`
- Types clean: `cd backend && uv run mypy .` and `cd frontend && npx tsc --noEmit`
- Tests green: full pytest + vitest suites.
- No async/await in backend.
- A short manual smoke-test recorded in Dev Notes: dev runs the
  panel, types "remind me to call my mum" + "by next sunday" + clicks
  Create, sees a new pad appear in the pond.

---

## Tasks / Subtasks

### Task 1 — Backend: schemas (AC 3)
- [ ] Add `TodoDraft` and `TodoDraftEnvelope` to `src/schemas/agent.py`.
- [ ] `extra="forbid"` on both for defence in depth.
- [ ] Schema-level test that the envelope rejects unknown keys.

### Task 2 — Backend: `create_todo` skill module (AC 1, AC 2, AC 8)
- [ ] `src/agent/skills/create_todo.py` mirroring the rephrase shape:
  `build()`, `_resolve_draft_from_history()`, `_build_task_description()`.
- [ ] Extract the today-anchor line from `rephrase.py` into a shared
  helper module (e.g. `src/agent/skills/_prompt_helpers.py`) since
  this is now the second skill that needs it. Both skills import
  from there.
- [ ] Tools list: `[GetTodoTool, ListTodosTool, SearchTool, GetChatHistoryTool]`
  via existing `session_factory` plumbing.
- [ ] Tests in `tests/agent/test_create_todo_skill.py`.

### Task 3 — Backend: registry + crew_runner verification (AC 1, AC 4)
- [ ] Register `create_todo` in `src/agent/skills/registry.py`.
- [ ] Verify (and adjust if necessary) `crew_runner._extract_proposal_envelope`
  handles `kind="todo_draft"` — see AC 4 note about generalising the
  `"suggestions" not in payload` check.
- [ ] Tests in `tests/agent/test_crew_runner_proposal.py`.

### Task 4 — Backend: intent classifier description (AC 1)
- [ ] Add `create_todo` to the intent classifier's known-skills list
  with the directive description from AC 1 so phrases like "remind me
  to..." / "I need to..." / "add a task..." route to this skill.
- [ ] Test: "remind me to call my mum" → classifier returns
  `create_todo`.

### Task 5 — Frontend: `TodoDraftProposal.tsx` renderer (AC 5, AC 6)
- [ ] New component at `frontend/src/components/agent/TodoDraftProposal.tsx`
  mirroring `RephraseProposal.tsx`'s structure (sibling of bubble,
  column-stack wrapper).
- [ ] Field rows reuse InfoPopup's `MetaRow`-style styling.
- [ ] Clarification chips fire `useAgentStore.getState().sendMessage(question, {})`.
- [ ] Create button → `useCreateTodo().mutate(...)`; Cancel button →
  local dismiss.
- [ ] On mutation success, render `TodoLink` to the new id.
- [ ] CSS at `TodoDraftProposal.css` matching the agent panel
  vocabulary.

### Task 6 — Frontend: AgentMessage proposal switch (AC 5)
- [ ] Add `'todo_draft' → TodoDraftProposal` arm to the kind-switch
  in `AgentMessage.tsx`. Keep the existing `status === 'complete'`
  gate.

### Task 7 — Polish + run all gates (AC 9)
- [ ] Format + lint + type-check + test.
- [ ] Manual smoke test recorded in Dev Notes.
- [ ] Story flipped to `review`; sprint-status synced.

---

## Dev Notes

### Existing patterns to follow (not reinvent)

This story is largely a clone-and-modify of 6.3. Where the rephrase
skill resolved a target todo from `todo_ids[0]` / UUID-extraction /
history / search, the create_todo skill resolves an inherited DRAFT
from history only (or starts fresh). The proposal envelope shape is
new but lands in the same `crew_runner` pipeline.

**Files to mirror:**
- `backend/src/agent/skills/rephrase.py` → `create_todo.py`
- `backend/src/schemas/agent.py` (RephraseEnvelope section) →
  TodoDraftEnvelope
- `frontend/src/components/agent/RephraseProposal.tsx` →
  `TodoDraftProposal.tsx`
- `frontend/src/components/agent/RephraseProposal.css` →
  `TodoDraftProposal.css`

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
- **No undo button on the proposal.** Once Created, the user uses the
  pad's existing Delete affordance to remove a regretted todo.

### Why a `cancelled` envelope status (not just the Cancel button)

The button covers the user-clicks-Cancel case. The envelope status
covers the "user pivots conversationally" case ("never mind, what's
the weather?"). Without an LLM-driven cancel signal, the proposal
block would linger in `drafting` status indefinitely — visually
confusing because the user has clearly moved on. The LLM detecting
"user pivoted" and emitting `status="cancelled"` lets the renderer
self-clean.

### Integration with rephrase chip-dispatch

A possible UX win: when the user creates a todo via this skill, the
"✓ created" success state can render a small "rephrase this?" chip
that fires the rephrase skill with `context.todo_ids=[new.id]`. Out
of scope for v1 but worth noting — the plumbing already exists.

### Constitutional-compliance reminders

- No `async def`, no `await`, no `asyncio` anywhere in this story's
  backend diff. CrewAI's kickoff is synchronous; `useCreateTodo` is
  the existing thread-safe React Query hook firing `POST /api/todos`.
- The new `_prompt_helpers.py` module (today-anchor extraction) is
  pure functions — zero async, zero state.

---

## Story DoD (Definition of Done)

- [ ] All ACs satisfied.
- [ ] All Tasks checked off.
- [ ] Backend tests green (target: existing 249 + ~10 new).
- [ ] Frontend tests green (target: existing 560 + ~10 new).
- [ ] `ruff check`, `ruff format --check`, `mypy` clean.
- [ ] `npx tsc --noEmit` clean.
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
| 2026-04-26 | Story drafted. Adds conversational create-todo skill mirroring 6.3's proposal-envelope architecture. Reuses existing `POST /api/todos` for commit; LLM stays read-only. Cross-turn inheritance via `metadata.proposal` matches 6.3's history-inheritance pattern. |
