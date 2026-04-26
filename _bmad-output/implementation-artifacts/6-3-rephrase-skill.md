# Story 6.3: Rephrase Skill

Status: review

> **Scope note:** First "skill" beyond the free-form `chat` skill in
> Epic 6 ("The Intelligent Pond Companion"). Lands the entire
> **proposal** machinery — backend `rephrase` skill that outputs a
> structured envelope, a NEW `proposal` SSE event type, frontend
> ingest into `chat_messages.metadata`, and the first proposal
> renderer (`RephraseProposal.tsx`) with per-suggestion accept +
> missing-field hints. Reuses the existing `PATCH /api/todos/{id}`
> endpoint on accept — NO new mutation paths.

---

## ⚠️ CRITICAL CONSTITUTIONAL CONSTRAINT

**Async/await is PROHIBITED in backend code** — see [CLAUDE.md](CLAUDE.md)
§ "CONCURRENCY MODEL — THREAD-BASED ONLY". The CrewAI `crew.kickoff()`
call is synchronous; it runs on a daemon `threading.Thread` and
streams events through a `queue.Queue`. JavaScript/TypeScript in
`frontend/` uses async normally (the constitutional ban is
Python-only).

---

## Story

As a user,
I want to select a todo and ask the agent to rephrase it, seeing suggested improvements inline with missing-field hints,
So that my todos become clearer and more actionable without retyping from scratch.

---

## Acceptance Criteria

### AC 1 — Backend `rephrase` skill (single-agent crew, structured JSON output)

**Given** the agent skill registry

**When** the rephrase skill is registered

**Then** `src/agent/skills/rephrase.py` exposes a `build(ctx: SkillContext) -> Crew` factory matching the existing skill contract (see [skills/chat.py](backend/src/agent/skills/chat.py) for precedent).

**Crew shape:**
- **Single agent** named `Rephrase Editor` constructed via [`build_base_agent`](backend/src/agent/skills/base.py) so the project's `BASE_SYSTEM_PROMPT` (untrusted-data framing, tool-use guardrails) is preserved.
- **One `Task`** whose `description` includes:
  - the resolved **target todo's content** (fetched up-front via `GetTodoTool` based on `ctx` — see § "Target todo resolution" below);
  - the user's natural-language request (e.g. "rephrase this");
  - explicit instructions to return ONLY a JSON object matching the schema below — no markdown, no commentary;
  - the same **untrusted-data framing block** the chat skill uses ([chat.py:19-25](backend/src/agent/skills/chat.py#L19-L25)) so an injected todo body cannot redirect the LLM ("ignore previous instructions and …").
- **`expected_output`** = "A JSON object with `reasoning`, `suggestions`, and `missing_fields` keys per the schema in the task description."
- **Tools:** `[GetTodoTool(session_factory=ctx.session_factory)]` ONLY. NO `PATCH`/`POST`/`DELETE` tools — § Architecture Decision 3.2 ("Read-only in v1"). The crew never mutates state; it only proposes.
- **`Crew` config:** `process=Process.sequential`, `verbose=False`, single agent, single task.
- **`crew.kickoff()`** is called synchronously by `run_crew` per Decision 1; no `async`/`await`/`asyncio` anywhere in this module.

**Skill registration** — `src/agent/skills/registry.py`'s `_register_skills()` adds:
```python
from src.agent.skills.rephrase import build as build_rephrase  # noqa: PLC0415

SKILL_REGISTRY["rephrase"] = SkillSpec(
    name="rephrase",
    description=(
        "Suggest clearer, more actionable phrasing for a single todo. "
        "Flags missing fields like due dates or scope when relevant."
    ),
    proposal_kind="text_rewrite",
    builder=build_rephrase,
)
```

The `proposal_kind` field (already on `SkillSpec`) is now meaningful — it's `None` for `chat`/`intent_classifier`, and `"text_rewrite"` here. See AC 4 for how `crew_runner` consumes it.

### AC 2 — Target-todo resolution & input contract

**Given** a chat request reaches the rephrase skill

**When** the skill builder runs

**Then** the target todo MUST be resolvable from the request before the crew kicks off. Resolution order (first match wins):

1. **Explicit selection** — `ChatRequest.context.todo_ids` (already exists; capped at 50, [agent.py:70](backend/src/schemas/agent.py#L70)) contains exactly one UUID. The rephrase skill uses `todo_ids[0]` as the target. **This is the canonical path** — frontend right-click "rephrase this todo" or composer with a clicked-pad pre-selection.
2. **UUID extracted from the user message** — last-resort regex scan of `ctx.user_message` for a UUID (matches `[0-9a-f]{8}-...{12}`). Useful for power users who type the id; not advertised in the UX copy.
3. **No id resolved** — the skill returns a structured "needs target" payload (see AC 3 § "Empty-target fallback") rather than producing a freeform-rephrase proposal against unknown content.

**Resolution lives in `rephrase.py`** (NOT in the API layer) so the skill owns its own input validation. The api/agent.py chat handler stays generic — it doesn't grow per-skill branching.

**`GetTodoTool` — NOT `ListTodosTool`** — issues a single point-lookup against the resolved id. `_run` returns either the todo JSON or a JSON error object, both already-string-typed (see [get_todo.py:24-44](backend/src/agent/tools/get_todo.py#L24-L44)) so the LLM receives a stable contract.

### AC 3 — Proposal envelope & output contract

**Given** the rephrase crew kicks off with a resolvable target todo

**When** the LLM produces its final output

**Then** the output MUST be a single JSON object matching this schema (NO markdown wrapping, NO ```json fences, NO trailing commentary):

```json
{
  "reasoning": "<1-2 sentence user-facing rationale, becomes the chat bubble's prose>",
  "suggestions": [
    {
      "field": "text",
      "original": "<exact current value of that field>",
      "revised": "<the LLM's improved wording>",
      "reason": "<one short sentence explaining why this is better>"
    }
  ],
  "missing_fields": ["due_date"]
}
```

**Field semantics:**
- `reasoning` — REQUIRED. Becomes the chat-bubble prose typed via the standard chunk stream (so the user sees a normal assistant reply); also written to `chat_messages.content`.
- `suggestions` — list of zero-or-more per-field rewrites. v1 only ever produces suggestions for `field: "text"` (no other fields are user-editable today via `PATCH /api/todos/{id}` text-content path). Schema is widened anyway so future fields (e.g. notes) require no contract change.
  - `field` — must be a key the existing `PATCH /api/todos/{id}` endpoint accepts. v1 valid values: `"text"`. Anything else triggers AC 7 server-side validation rejection.
  - `original` — exact current value. Exposed in the diff so the user sees what's being replaced; not strictly required for the PATCH (the backend doesn't compare originals), but required for the diff renderer (AC 5).
  - `revised` — new value to apply.
  - `reason` — short justification, displayed under the diff per AC 5.
- `missing_fields` — list of optional metadata flags the LLM thinks are missing. v1 understands one literal: `"due_date"`. Future flags (e.g. `"context"`, `"priority"`) require frontend-renderer extension in the SAME PR per Architecture Principle P2 ("Proposal envelope is contractual").

**Empty-target fallback (no resolvable id):**
```json
{
  "reasoning": "I'd be happy to rephrase a todo, but I'm not sure which one you mean — try clicking a pad first or pasting its id.",
  "suggestions": [],
  "missing_fields": []
}
```

This still goes through the proposal pipeline (so the prose surfaces in the bubble) but produces an empty `suggestions` array; `RephraseProposal.tsx` (AC 5) renders nothing under the bubble in that case.

**JSON-parse failure path:** if the LLM returns malformed JSON despite the explicit instructions, `crew_runner` (AC 4) emits an `error` SSE event with `code: "agent_invalid_proposal"` rather than crashing the worker thread.

### AC 4 — `crew_runner` extension: parse JSON, emit `proposal` event, persist metadata

**Given** a skill whose `SkillSpec.proposal_kind` is non-`None`

**When** `run_crew` finalises the kickoff result

**Then** instead of streaming the raw LLM output as chunks, it MUST:

1. **Parse** `prose = str(result).strip()` as JSON. On `json.JSONDecodeError`, emit `{"type": "error", "code": "agent_invalid_proposal", "message": "Skill produced non-JSON output", "recoverable": false}` and return `CrewResult(success=False, ...)` — no proposal event, no chunks.
2. **Validate** the parsed object's top-level shape: dict with `reasoning: str`, `suggestions: list`, `missing_fields: list`. On shape mismatch, emit `agent_invalid_proposal` with a structured message describing the missing key.
3. **Build the canonical envelope:**
   ```python
   envelope = {
       "kind": spec.proposal_kind,  # e.g. "text_rewrite"
       "payload": {
           "suggestions": parsed["suggestions"],
           "missing_fields": parsed["missing_fields"],
       },
       "targets": [str(target_todo_id)],  # see § "Targets" below
       "reasoning": parsed["reasoning"],
   }
   ```
4. **Emit** a NEW SSE event type before any `chunk` events fire:
   ```json
   {"type": "proposal", "kind": "text_rewrite", "payload": {...}, "targets": [...], "reasoning": "..."}
   ```
   Frontend code path: `useAgentStore.ingestSseEvent` (AC 6).
5. **Stream the `reasoning` text** via the existing `_chunk_words` path so the chat bubble displays prose as the message types out — no behaviour change for the chat-rendering path.
6. **Return** `CrewResult(success=True, prose=parsed["reasoning"], error=None)` so `finalise_assistant_message` writes `content=reasoning` (not the raw JSON).
7. **Metadata persistence** — `finalise_assistant_message` (called from [agent.py:83-177](backend/src/api/agent.py#L83-L177)) is extended to accept an optional `metadata: dict[str, Any] | None` parameter. When provided, it's written to `chat_messages.metadata` via the existing `chat_service.update_message` (which already accepts metadata as a kwarg — see § Architecture Decision 2). The structured envelope from step 3 IS the metadata value (under the `proposal` key, alongside the existing `skill` key already written by 6.2).

**Targets:** the rephrase skill records the resolved todo id in `targets`; the API-layer wrapper that calls `run_crew` passes the resolved id explicitly (see Task 2). `proposal.targets` is a list because `position_deltas` (organize) will be many-targets; `text_rewrite` is single-target in v1 but the array shape is fixed.

**Skill module returns the resolved id** through a small new dataclass `RephraseSkillSetup` (or equivalent) that the API handler consumes:
```python
@dataclass(frozen=True)
class RephraseSkillSetup:
    crew: Crew
    target_todo_id: uuid.UUID  # resolved per AC 2
```
Or equivalently, the `build()` function returns `Crew` AND publishes the resolved id via `ctx`. **Choose by ergonomics during dev** — the constraint is that `run_crew` MUST know the resolved target id at the moment it constructs the envelope. A small mutation of `ctx` is acceptable since `SkillContext` is `frozen=True`; either widen the dataclass with a `resolved_target_id: uuid.UUID | None = None` field or pass the id alongside the Crew via a new return type. Bias toward the dataclass widening (less ceremony, no new type).

### AC 5 — Frontend `RephraseProposal.tsx`

**Given** a chat message arrives with `metadata.proposal.kind === "text_rewrite"`

**When** the message renders in the chat thread

**Then** `RephraseProposal.tsx` renders BELOW the assistant bubble (NOT inside it), wired into `AgentMessage.tsx` via a small switch on `metadata.proposal.kind`. Layout:

1. **Header row** — bare neon-cyan label "Suggested rewrite" matching the panel's micro-text style (mono 11px, 0.04em letter-spacing) — same vocabulary as [`AgentControlsRow`](frontend/src/components/agent/AgentControlsRow.tsx)'s button text.
2. **Per-suggestion block** — one block per `payload.suggestions[i]`:
   - Diff: original struck-through (`text-decoration: line-through; opacity: 0.6`) on the LEFT, an arrow glyph (`→` rendered in `var(--neon-cyan)`), revised in normal weight on the RIGHT. On panels narrower than 320px, fall back to vertical stack (CSS `flex-wrap: wrap`).
   - `reason` line below the diff in dim micro-text.
   - **Two icon-buttons** at the top-right of the block:
     - **Accept** — green check `✓`, fires `useUpdateTodo().mutate({ id: targets[0], [field]: revised })` on click. Existing hook from [todoApi.ts:88-93](frontend/src/api/todoApi.ts#L88-L93). On success the block flips to a "✓ applied" state (background tint, both buttons disabled).
     - **Dismiss** — red `×`, marks the suggestion as dismissed locally (in component state, NOT persisted server-side). Both buttons disable. Dismiss does NOT fire any network call — the suggestion was never persisted.
3. **Missing-field hints** — a row below the suggestion blocks, ONE per `payload.missing_fields[i]`. Format: `⚠ Consider adding a due date — no deadline mentioned` (the literal hint text is keyed off the field name; see § "Missing-field copy table" below).
4. **Empty payload** — if `suggestions.length === 0` AND `missing_fields.length === 0`, render NOTHING (the assistant prose alone is the response). Cleanly handles the empty-target fallback from AC 3.
5. **Persistence across reloads** — accepted/dismissed state is per-mount only. On panel close + reopen, all suggestions are again "pending" until the user clicks Accept (which persists via `PATCH /api/todos/{id}`) or Dismiss (which doesn't). No new metadata bookkeeping for "applied/dismissed" — the architecture is "freeze on apply: applied state is implicit because the underlying todo's text now matches `revised`". A reloaded suggestion whose `original` no longer matches the live todo text reads as "stale" — in that case the block displays a small `[stale]` chip and disables Accept (the LLM's `original` is no longer current; we don't want to overwrite a fresh edit). Reading the live todo for the staleness check: `useTodos()`'s cached list is already loaded; do a `find(t => t.id === targets[0])` lookup.

**Missing-field copy table** (case-by-case literal strings, since v1 only handles `due_date`):

| `missing_fields[i]` | UI hint copy |
|---|---|
| `due_date` | "Consider adding a due date — no deadline mentioned" |
| _(any other)_ | Fallback: `"Consider adding ${field.replace('_', ' ')}"` — keeps the renderer extensible without breaking on future flags |

**Optimistic-update behaviour on accept:** the existing `useUpdateTodo` hook (todoApi.ts) ALREADY does optimistic updates via React Query's mutation `onMutate` — see comment on [todoApi.ts:88](frontend/src/api/todoApi.ts#L88). The accepted change appears on the lily pad immediately, without waiting for the PATCH round-trip. No new optimistic plumbing in this story.

### AC 6 — Frontend SSE event extension

**Given** the new `proposal` SSE event from AC 4

**When** the SSE consumer parses it

**Then**:
- The `SseEvent` discriminated union in [`frontend/src/types/agent.ts`](frontend/src/types/agent.ts) gains a new arm:
  ```ts
  | {
      type: 'proposal';
      kind: string;
      payload: Record<string, unknown>;
      targets: string[];
      reasoning: string;
    }
  ```
  Per the comment at [agent.ts:7-12](frontend/src/types/agent.ts#L7-L12), SSE event payloads keep their snake_case server keys; `targets`/`payload`/`reasoning` are already lowercase single-word keys so the discriminant stays stable.
- `useAgentStore.ingestSseEvent` gains a new branch:
  ```ts
  if (event.type === 'proposal') {
    set((s) => {
      const id = s.streamingMessageId;
      if (id === null) return {};
      return {
        messages: s.messages.map((m) =>
          m.id === id
            ? {
                ...m,
                metadata: {
                  ...m.metadata,
                  proposal: {
                    kind: event.kind,
                    payload: event.payload,
                    targets: event.targets,
                    reasoning: event.reasoning,
                  },
                },
              }
            : m,
        ),
      };
    });
    return;
  }
  ```
  The proposal arrives BEFORE any `chunk` events, so it's safe to write into `metadata` without risk of stamping over a still-streaming `content` (which lives in a different field).
- **Persistence pathway** — when the user re-opens the panel later, `GET /api/agent/sessions/{id}/messages` returns the assistant row with `metadata.proposal` already populated (written by AC 4 step 7). No special re-ingestion needed; the existing `loadActiveMessages` flow that populates `messages[]` carries the metadata field through unchanged.

### AC 7 — Backend safety: validate `field` against an allowlist

**Given** `RephraseProposal.tsx` fires `PATCH /api/todos/{id}` with the LLM-suggested `field`

**When** the request reaches the existing PATCH route

**Then** Pydantic (the existing [`TodoUpdate` schema](backend/src/schemas/todo.py)) MUST reject any field not already in its allowlist with a 422 — NO new endpoints, NO new server-side validation needed. Verify the existing schema disallows arbitrary keys (`extra="forbid"` or equivalent) so a malicious or buggy LLM proposal can't write to fields like `id` or `created_at`.

If `extra="forbid"` is NOT already set on `TodoUpdate`, this story adds it. Document the existing state in dev notes and only widen if needed. A fast confirmation: `grep -n 'extra' backend/src/schemas/todo.py`.

### AC 8 — Tests

**Backend (pytest):**
- `backend/tests/agent/test_rephrase_skill.py`:
  - `build()` returns a Crew with one agent and one task; asserts the task description includes the target todo's content and the untrusted-data framing literal;
  - target-todo resolution via `ctx.context.todo_ids[0]` (mocked todo_service);
  - target-todo resolution via UUID extraction from `user_message`;
  - empty-target fallback path (no UUID anywhere): the `build()` produces a crew that returns an empty-suggestions JSON, with `reasoning` matching the AC 3 literal (or close — phrasing can drift but the schema must hold);
  - `proposal_kind` registered as `"text_rewrite"` in `SKILL_REGISTRY`.
- `backend/tests/agent/test_crew_runner_proposal.py`:
  - run_crew with a skill that has `proposal_kind` set: parses JSON, emits `proposal` SSE event before chunks, then chunks the `reasoning` text;
  - JSON-parse failure → emits `agent_invalid_proposal` error event;
  - shape-mismatch (missing `suggestions` key) → emits `agent_invalid_proposal`;
  - `finalise_assistant_message` writes `metadata.proposal` to the DB row when provided (mocked SessionLocal).
- `backend/tests/api/test_agent_chat.py` (extend):
  - End-to-end: POST `/api/agent/sessions/{id}/chat` with `skill: "rephrase"` and `context.todo_ids: [<id>]` — assert response stream contains a `proposal` event whose `kind === "text_rewrite"` and `targets === [id]`;
  - POST with `skill: null` and a user message containing "rephrase this" — assert intent classifier routes to `rephrase` (mock the LLM so the classifier deterministically picks rephrase).
- `backend/tests/schemas/test_todo_schema.py` (or wherever existing schema tests live): assert `TodoUpdate` rejects unknown fields with 422.

**Frontend (vitest):**
- `frontend/src/components/agent/RephraseProposal.test.tsx`:
  - Renders zero blocks when `suggestions === []`;
  - renders one block per suggestion with original / arrow / revised / reason;
  - clicking Accept fires `useUpdateTodo().mutate({ id, [field]: revised })` (mock the hook);
  - clicking Dismiss does NOT fire mutate;
  - missing-field hints render the literal copy from the table for known fields and the fallback for unknown fields;
  - "stale" chip appears when the live todo's `text` no longer matches `original` (mocked `useTodos`).
- `frontend/src/stores/useAgentStore.test.ts` (extend):
  - `ingestSseEvent({type: 'proposal', kind: 'text_rewrite', ...})` writes `metadata.proposal` onto the streaming message and leaves `content` / `streamingBuffer` untouched;
  - subsequent `chunk` events still grow the streaming content normally.
- `frontend/src/components/agent/AgentMessage.test.tsx` (extend): when `message.metadata.proposal.kind === 'text_rewrite'`, the bubble renders + `RephraseProposal` is rendered as a sibling (mock the proposal renderer to avoid pulling in `useUpdateTodo`'s React Query plumbing in this test).

### AC 9 — Definition of done gates

- [x] `npm run build` clean (no TS errors, no Vite warnings);
- [x] `npx vitest --run` from `frontend/` passes (existing + new);
- [x] `uv run pytest` from `backend/` passes (existing + new);
- [x] `npm run lint` net-zero new errors;
- [x] Manual smoke: open panel, click a pad, type "rephrase this", send → assistant prose streams in, suggestion block appears below, Accept updates the pad's text and the block flips to "✓ applied"; Dismiss disables both buttons without any network call.

---

## Tasks / Subtasks

### Task 1 — Backend: `rephrase` skill module (AC 1, AC 2, AC 3)

- [x] Create [`backend/src/agent/skills/rephrase.py`](backend/src/agent/skills/rephrase.py):
  - `build(ctx: SkillContext) -> Crew` factory matching the existing skill signature.
  - Resolve target todo id per AC 2: read `ctx.context.todo_ids[0]` if set; else regex-scan `ctx.user_message` for a UUID; else proceed with empty-target fallback prompt. The chat skill currently consumes `ctx.user_message` only — extending `SkillContext` to carry `context: ChatRequestContext` is part of this task (see Task 3 also).
  - Up-front `GetTodoTool` lookup to fetch the target's content; embed the content directly into the Task description so the agent doesn't have to call the tool a second time.
  - Build the agent via `build_base_agent(role="Rephrase Editor", goal="...", tools=[GetTodoTool(...)], llm=ctx.llm)`. Tools list MUST include `GetTodoTool` for shape consistency with chat (so the agent can re-fetch if it wants), but the task description front-loads the content so the LLM rarely needs to call it.
  - Task description includes: untrusted-data framing literal, target todo content, user request, JSON schema spec from AC 3, and the empty-target fallback instructions if applicable.
  - `expected_output` matches the JSON schema description verbatim.
  - Single-agent, single-task, sequential crew.
- [x] Register the skill in [`backend/src/agent/skills/registry.py`](backend/src/agent/skills/registry.py):
  - Import from `src.agent.skills.rephrase`;
  - Add `SKILL_REGISTRY["rephrase"]` with `proposal_kind="text_rewrite"`;
  - Update `intent_classifier` skill list dynamically (it iterates `SKILL_REGISTRY` minus internal skills — already happens [intent_classifier.py:25-28](backend/src/agent/skills/intent_classifier.py#L25-L28)), so registering the skill is enough for the classifier to start routing to it.
- [x] Create [`backend/tests/agent/test_rephrase_skill.py`](backend/tests/agent/test_rephrase_skill.py) per AC 8.

### Task 2 — Backend: `crew_runner` proposal pipeline (AC 4)

- [x] Extend [`backend/src/agent/crew_runner.py`](backend/src/agent/crew_runner.py)'s `run_crew`:
  - After `crew.kickoff()` and before chunk-streaming, branch on `spec.proposal_kind`:
    - When `proposal_kind is None` (chat / classifier): keep the existing path verbatim — chunk the prose, no proposal event, no metadata write.
    - When `proposal_kind is not None`: parse `prose` as JSON; on success, build the envelope; emit `{"type": "proposal", "kind": ..., "payload": ..., "targets": ..., "reasoning": ...}`; chunk the `reasoning` text only; persist the envelope into the assistant row's metadata via the new `metadata` parameter on `finalise_assistant_message`.
  - JSON parse failure / shape mismatch → emit `agent_invalid_proposal` error and return `CrewResult(success=False, ...)`. Use distinct codes (`agent_invalid_proposal_json` vs `agent_invalid_proposal_shape`) to make ops triage easier.
  - The `CrewResult` dataclass GAINS an optional `metadata: dict[str, Any] | None = None` field (or similar) so the API wrapper can pass it through to `finalise_assistant_message` without re-parsing the SSE stream.
- [x] Extend [`finalise_assistant_message`](backend/src/api/agent.py#L83) signature with `metadata: dict[str, Any] | None = None`. When provided, write to the row alongside `content` / `status`. Existing call sites (chat skill) pass `None` and behave unchanged.
- [x] Extend `chat_service.update_message` if it doesn't already accept `metadata` — confirm via `grep -n metadata backend/src/services/chat_service.py`. If absent, add a `metadata: dict[str, Any] | None = None` kwarg that writes to the existing JSONB column when non-None.
- [x] Create [`backend/tests/agent/test_crew_runner_proposal.py`](backend/tests/agent/test_crew_runner_proposal.py) per AC 8.

### Task 3 — Backend: `SkillContext` widening + API plumbing (AC 2)

- [x] Extend [`SkillContext`](backend/src/agent/skills/registry.py) with `context: ChatRequestContext = field(default_factory=ChatRequestContext)` (frozen dataclass — use `field(default_factory=...)` since `ChatRequestContext` is mutable). Pre-existing skills (chat / classifier) ignore this field, so the widening is backward compatible.
- [x] Update [`backend/src/api/agent.py`](backend/src/api/agent.py)'s `chat()` handler to thread `body.context` into the constructed `SkillContext`:
  ```python
  ctx = SkillContext(
      session_id=session_id,
      user_message=body.content,
      session_factory=SessionLocal,
      llm=get_llm_for_agent(),
      event_queue=q,
      history=history,
      context=body.context,  # <-- new
  )
  ```
- [x] Extend [`backend/tests/api/test_agent_chat.py`](backend/tests/api/test_agent_chat.py) per AC 8's E2E cases.

### Task 4 — Backend: schema validation (AC 7)

- [x] Verify [`backend/src/schemas/todo.py`](backend/src/schemas/todo.py)'s `TodoUpdate` rejects extra fields:
  - If `model_config = ConfigDict(extra="forbid")` is already set, no change.
  - Otherwise, add it. Document the change as a defence-in-depth step; the LLM is the new untrusted producer of PATCH bodies.
- [x] Add / extend a schema-level test asserting that `TodoUpdate.model_validate({"id": "x", "text": "y"})` raises `ValidationError`.

### Task 5 — Frontend: SSE union + ingest (AC 6)

- [x] Extend [`frontend/src/types/agent.ts`](frontend/src/types/agent.ts) `SseEvent` union with the `proposal` arm.
- [x] Extend [`useAgentStore.ingestSseEvent`](frontend/src/stores/useAgentStore.ts) with the new branch — write `metadata.proposal` onto the streaming message; do NOT touch `content` or `streamingBuffer`.
- [x] Extend [`frontend/src/stores/useAgentStore.test.ts`](frontend/src/stores/useAgentStore.test.ts) with the new ingestion case + the "subsequent chunk still appends to content" case (AC 8).

### Task 6 — Frontend: `RephraseProposal.tsx` component (AC 5)

- [x] Create [`frontend/src/components/agent/RephraseProposal.tsx`](frontend/src/components/agent/RephraseProposal.tsx):
  - Reads the proposal payload from props (the parent passes `message.metadata.proposal` after type-narrowing on `kind === 'text_rewrite'`).
  - Per-suggestion local state — `applied`, `dismissed` — both `boolean`. Resets on parent re-mount, NOT persisted.
  - Live-todo lookup via `useTodos()` for the staleness check; falls back to "stale" when the matching todo's text differs from the suggestion's `original`.
  - `useUpdateTodo()` mutation on Accept; Dismiss is a pure local state flip.
  - Missing-field hints rendered per the copy table.
  - Component is presentational — no Zustand subscriptions, no API calls except the mutation hook. Keeps the test surface small.
- [x] Create matching CSS rules in a new [`RephraseProposal.css`](frontend/src/components/agent/RephraseProposal.css) (or extend [`AgentPanel.css`](frontend/src/components/agent/AgentPanel.css) — pick by what neighbouring components do). Match the panel's neon-cyan + `var(--font-mono)` micro-text vocabulary.
- [x] Create [`RephraseProposal.test.tsx`](frontend/src/components/agent/RephraseProposal.test.tsx) per AC 8.

### Task 7 — Frontend: AgentMessage proposal switch (AC 5)

- [x] Extend [`frontend/src/components/agent/AgentMessage.tsx`](frontend/src/components/agent/AgentMessage.tsx) to render a proposal renderer below the bubble when `message.metadata?.proposal?.kind === 'text_rewrite'`:
  ```tsx
  {message.metadata?.proposal?.kind === 'text_rewrite' && (
    <RephraseProposal
      payload={message.metadata.proposal.payload}
      targets={message.metadata.proposal.targets}
    />
  )}
  ```
- [x] Future-proof with a `kind` switch the moment a second proposal kind lands. v1 hard-codes the cyan-only path, but a `switch (kind)` block kept simple now removes friction for `position_deltas` / `visual_cues` later.
- [x] Extend [`AgentMessage.test.tsx`](frontend/src/components/agent/AgentMessage.test.tsx) per AC 8.

### Task 8 — Polish + run all gates (AC 9)

- [x] Visual smoke test: open the panel, click a pad, type "rephrase this", send. Verify the suggestion block appears, Accept updates the pad's text optimistically, Dismiss disables the block.
- [x] `npm run build` — no TS errors, no Vite warnings.
- [x] `npx vitest --run` — all tests pass, no skips.
- [x] `uv run pytest` from `backend/` — all tests pass.
- [x] `npm run lint` — net-zero delta vs baseline.

---

## Dev Notes

### Existing patterns to follow (not reinvent)

| Concern | Where it's done | Pattern |
|---|---|---|
| Skill registration | [registry.py](backend/src/agent/skills/registry.py) | `SkillSpec` dataclass; register via `_register_skills()` at module load |
| Skill builder shape | [chat.py](backend/src/agent/skills/chat.py) | `build(ctx) -> Crew` factory; `process=Process.sequential`, `verbose=False` |
| Untrusted-data framing | [chat.py:19-25](backend/src/agent/skills/chat.py#L19-L25), [intent_classifier.py:13-17](backend/src/agent/skills/intent_classifier.py#L13-L17) | Localized literal block in the Task description; symmetric across skills |
| Read-only tool | [get_todo.py](backend/src/agent/tools/get_todo.py) | `PooledTool` subclass; `_run` returns JSON-serialized string (never raw exception); `session_factory` injected at construction |
| SSE event emit + queue sentinel | [crew_runner.py](backend/src/agent/crew_runner.py) | `q.put({...})`; terminal `None` sentinel in `finally` |
| `CrewResult` dataclass | [crew_runner.py:30-48](backend/src/agent/crew_runner.py#L30-L48) | Frozen dataclass; success/failure/cancelled paths produce distinct shapes |
| API thread spawn + cancellation | [agent.py:213+](backend/src/api/agent.py#L213) | Daemon thread per chat; `threading.Event` for cancel; per-session lock for create-message |
| Mutation hook with optimistic update | [todoApi.ts:88-98](frontend/src/api/todoApi.ts#L88-L98) | React Query `useMutation` with `onMutate` for optimistic UI |
| Frozen Zustand-store ref-based subscriptions | [useAgentStore.ts](frontend/src/stores/useAgentStore.ts) | Module-scope `let` for non-serializable handles; `subscribe()` for cross-tick effects |

### Architecture vs Epic kind-name discrepancy

The epics file (line 745) calls the proposal `kind: "rephrase"`. The architecture's contract table ([architecture.md](_bmad-output/planning-artifacts/architecture.md) Decision 3.5, line 1118) says `text_rewrite`. **This story uses `text_rewrite`** because:

1. The architecture is the canonical contract source for the wire envelope (referenced from the renderer registration table at line 1269: `text_rewrite | RephraseProposal.tsx`);
2. The `*_deltas` / `text_rewrite` / `visual_cues` taxonomy used elsewhere is a descriptive-noun pattern; `rephrase` would break it;
3. The user-facing concept (`/help rephrase this`) stays `rephrase`; only the internal envelope's `kind` discriminator is `text_rewrite`.

If product later mandates `kind: "rephrase"`, the change is one literal in `registry.py`'s `proposal_kind` plus a matching `kind === 'rephrase'` check in `AgentMessage.tsx` / `RephraseProposal.tsx`. No other moving parts.

### Schema discrepancy: epic vs architecture payload shape

The epic specifies (per AC 3 above):
```json
{ "suggestions": [{ "field", "original", "revised", "reason" }], "missing_fields": [...] }
```

The architecture's contract table (line 1118) specifies:
```json
[{ "id", "current", "suggested", "notes": [...] }, ...]
```

**This story follows the EPIC** because:
1. The epic is the more recent and detailed source;
2. The epic's per-field granularity matches the user-facing diff renderer in AC 5;
3. `missing_fields` (epic) is a first-class hint slot the architecture's older shape couldn't carry.

The architecture document should be updated to match in the same PR (if convenient) or noted as a follow-up; the canonical contract for v1 is the epic.

### Why `proposal_kind` lives on `SkillSpec`, not on the skill module

The architecture's `SkillSpec` already has the `proposal_kind: str | None` field — it was reserved by Story 6.1 specifically for this. Discovering it via `SKILL_REGISTRY[spec_name].proposal_kind` (rather than asking the skill module for it) keeps `crew_runner.py` decoupled from individual skill modules — the runner doesn't import from each skill's namespace. Same pattern the dispatcher already uses for `description`.

### `extra="forbid"` defence in depth

The PATCH route is the LLM's mutation surface (via the user clicking Accept on a proposal). Until now, PATCH writes were authored by either (a) the user via the UI or (b) other UI-driven hooks like cascade displacement. The LLM's `field` slot widens the input space; an `extra="forbid"` hardening on `TodoUpdate` is cheap defence in depth. If the schema already has it, document and skip.

### What v1 explicitly does NOT do

- **Multi-todo rephrase** — `targets` is array-shaped but rephrase only ever produces one. A future "rephrase all my todos" command would need a multi-target plan but isn't in scope.
- **Diff-of-fields beyond `text`** — the schema is widened to allow other fields (e.g. notes), but v1 prompts and renders for `text` only. Extending to other fields is a renderer + prompt-template change, no contract change.
- **Tool-call audit logging** — see Architecture § 3.6 ("Tool-call audit logging — deferred").
- **Persisted dismiss state** — dismissed-but-not-applied suggestions disappear on reload (the metadata.proposal is still on the row, but the local "dismissed" flag is per-mount). Persisting requires a DB schema change for "user accepted suggestion N at time T" — out of scope.
- **Inline diff-edit** — the user can't tweak `revised` before accepting in v1. They Accept (commits as-is) or Dismiss (no commit) and then manually edit via the existing InfoPopup edit mode if they want a tweak. A future story could add an inline editable `<textarea>` for the revised value.
- **Streaming the proposal as the LLM produces it** — the proposal arrives all-at-once (after `crew.kickoff()` returns). The reasoning chunks afterward give the user something to read while the proposal panel materialises. CrewAI doesn't have first-class token-streaming for structured output; deferring to the day it does.

### File locations summary

| New file | Purpose |
|---|---|
| `backend/src/agent/skills/rephrase.py` | Rephrase skill builder |
| `backend/tests/agent/test_rephrase_skill.py` | Skill builder unit tests |
| `backend/tests/agent/test_crew_runner_proposal.py` | crew_runner proposal-pipeline tests |
| `frontend/src/components/agent/RephraseProposal.tsx` | Proposal renderer for `text_rewrite` |
| `frontend/src/components/agent/RephraseProposal.test.tsx` | Renderer + accept/dismiss tests |
| `frontend/src/components/agent/RephraseProposal.css` | Renderer styles (or extend AgentPanel.css) |

| Modified file | Change |
|---|---|
| `backend/src/agent/skills/registry.py` | Register the rephrase skill with `proposal_kind="text_rewrite"` |
| `backend/src/agent/skills/registry.py` (`SkillContext`) | Add `context: ChatRequestContext` field |
| `backend/src/agent/crew_runner.py` | Branch on `proposal_kind`: parse JSON, emit `proposal`, chunk reasoning, persist metadata |
| `backend/src/api/agent.py` | Thread `body.context` into `SkillContext`; extend `finalise_assistant_message` with `metadata` kwarg |
| `backend/src/services/chat_service.py` | If `update_message` doesn't already accept `metadata` kwarg, add it (writes to existing JSONB column) |
| `backend/src/schemas/todo.py` | Confirm / add `extra="forbid"` on `TodoUpdate` |
| `backend/tests/api/test_agent_chat.py` | Extend with rephrase E2E cases |
| `frontend/src/types/agent.ts` | Add `proposal` arm to `SseEvent` discriminated union |
| `frontend/src/stores/useAgentStore.ts` | Add `proposal` branch to `ingestSseEvent` |
| `frontend/src/stores/useAgentStore.test.ts` | Cover proposal ingest + downstream chunk stitching |
| `frontend/src/components/agent/AgentMessage.tsx` | Render `RephraseProposal` below the bubble when `metadata.proposal.kind === 'text_rewrite'` |
| `frontend/src/components/agent/AgentMessage.test.tsx` | Cover the proposal-render branch |

### Story 6.2 deferred items that touch this story

- The `metadata` JSONB column on `chat_messages` was provisioned in 6.1 and exposed via Pydantic's `metadata_` field with `serialization_alias="metadata"` (see [agent.py schema:33-63](backend/src/schemas/agent.py#L33-L63)). Confirm that `chat_service.update_message` writes to the underlying ORM column `metadata_` (note the trailing underscore — the column name conflicts with SQLAlchemy's `Base.metadata` and was renamed); writing to `metadata` directly returns `Base.metadata`, NOT the JSONB.
- Story 6.2 added the `start` SSE event's `message_id` field for assistant-row binding ([useAgentStore.ts:401+](frontend/src/stores/useAgentStore.ts#L401)). The `proposal` event arrives AFTER `start` (so `streamingMessageId` is already set when ingest fires) and BEFORE any `chunk` (so writes to `metadata` are race-free).
- Story 6.2 capped chat content at 4000 chars ([agent.py schema:74](backend/src/schemas/agent.py#L74)). The rephrase skill's task description embeds the target todo's text inline; verify the embedded JSON instructions + content stay under the LLM's context window. The longest todo is ~1000 chars (`text` column has no DB cap but the InfoPopup textarea practically caps user input under that). Total task description with framing + instructions + 1k-char todo + JSON-schema example is comfortably under 4k tokens.

### CrewAI 1.14 specifics (current upgrade target — Story 6.2 bumped from 1.6)

- `Crew.kickoff()` returns `CrewOutput` whose `__str__` returns the final task's `raw_output`. The raw output is what `crew_runner` parses as JSON. If a future CrewAI version changes the str-coercion, the parse path needs to read `result.raw` directly. Pin the failure mode in `test_crew_runner_proposal.py` so a CrewAI upgrade caught it.
- CrewAI's structured-output features (`output_pydantic`, `output_json`) are tempting alternatives to "parse the str(result)". They were not adopted in 6.1's chat skill because they coupled the skill to a specific Pydantic model and made tool-call interleaving brittle. v1 of rephrase stays string-parse for symmetry; revisit if a third proposal-producing skill ships.

### Constitutional-compliance reminders

- **No async/await/asyncio anywhere in `backend/src/agent/skills/rephrase.py` or `backend/src/agent/crew_runner.py`'s diff.** The `crew.kickoff()` call is sync; the JSON parse + envelope build is sync; the SSE event emit goes through `queue.Queue.put()` which is thread-safe.
- **No new HTTP clients** — frontend reuses `apiClient` (axios) via `useUpdateTodo`; backend has no outbound HTTP needs in this skill.
- **No new background tasks** — the rephrase crew runs on the existing daemon thread spawned by `chat()`; no separate worker.

---

## Story DoD (Definition of Done)

- [x] `npm run build` succeeds (no type errors, no lint errors)
- [x] `npx vitest --run` from `frontend/` passes (existing + new tests, no skips)
- [x] `uv run pytest` from `backend/` passes (existing + new tests, no skips)
- [x] `npm run lint` clean (net-zero new errors)
- [x] `rephrase` skill registered in `SKILL_REGISTRY` with `proposal_kind="text_rewrite"`
- [x] Manual smoke: open panel, click a pad, type "rephrase this", send → suggestion block appears below the assistant prose; clicking Accept updates the pad's text optimistically AND the block flips to "✓ applied"; clicking Dismiss disables both buttons without any network call.
- [x] Manual smoke (intent classifier route): send "rephrase [todo text]" without explicit `skill` parameter — assert classifier picks rephrase (verify via the skill dropdown in DevTools or by inspecting the `start` event payload).
- [x] Manual smoke (empty target): send "rephrase this" with no `context.todo_ids` and no UUID in the message — assert the chat bubble shows the empty-target fallback prose, no suggestion block renders.
- [x] Manual smoke (stale suggestion): produce a suggestion, refresh the page, edit the todo's text via the InfoPopup so it no longer matches `original`, reopen the panel — assert the proposal block now shows `[stale]` and Accept is disabled.
- [x] Manual smoke (PATCH allowlist): observed via DevTools — clicking Accept fires `PATCH /api/todos/{id}` with body `{"text": "..."}` and 200 OK; no extra fields beyond `text` are in the request body.

---

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (claude-opus-4-7)

### Debug Log References

- Backend: 240/240 pytest pass (`make test-db-setup` then `DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/todo_pond_test uv run pytest`).
- Backend lint clean: `uv run ruff check src tests` → All checks passed.
- Backend types clean: `uv run mypy --strict src` → no issues found in 45 source files.
- Frontend: 544/544 vitest pass (`npx vitest --run`).
- Frontend build clean: `npm run build` succeeds with TypeScript checks.
- Frontend lint baseline = 17 errors / 4 warnings (pre-existing); my changes added 0 net errors.

### Completion Notes List

**Mid-implementation pivot from string-parse → CrewAI `output_pydantic`.** The original spec said "v1 of rephrase stays string-parse for symmetry" with the chat skill. User instructed mid-implementation to switch to `output_pydantic=RephraseEnvelope`. This is cleaner — CrewAI handles JSON parse + schema validation; `crew_runner` consumes `CrewOutput.pydantic` directly via `_extract_proposal_envelope`. The error-code names `agent_invalid_proposal_missing` (CrewAI returned no parsed model) and `agent_invalid_proposal_shape` (model parsed but missing required keys / blank reasoning) replace the spec's `agent_invalid_proposal_json` / `agent_invalid_proposal_shape` pair.

**User-driven enhancement: search-based candidate resolution + clickable chips.** Original spec hard-flipped to the empty-target fallback whenever explicit-id resolution failed. User reported "Help me reword the dashboard task" → "I'd be happy to rephrase a todo, but I'm not sure which one you mean" and asked the skill to search instead. Implemented in two parts:

1. Backend `_resolve_via_search` in `rephrase.py` — runs `search_service.hybrid_search` with the user message as the query. Auto-resolves to the top hit when score ≥ 0.35 AND gap to second-best ≥ 0.15 (clear winner). Otherwise returns the top-3 hits as `RephraseCandidate`s. Failure-domain handling mirrors the existing search path — embedding outage / DB error is logged and degrades silently to the empty-target fallback prose.
2. Frontend `RephraseProposal.tsx` — when `payload.candidates` is non-empty, renders clickable chips. Click dispatches `useAgentStore.sendMessage('rephrase this', { todoIds: [picked.id], skill: 'rephrase' })`, threading the explicit selection through `streamAgentChat`'s body and pinning the skill so the intent classifier doesn't route elsewhere.

Schema additions: `RephraseCandidate` model + `candidates: list[RephraseCandidate]` on `RephraseEnvelope`. The candidates field is server-side-stamped — the LLM never produces it; `_extract_proposal_envelope` folds `ctx.resolved_candidates` into `payload.candidates` post-LLM.

**Defensive runtime hardening (user reported `Cannot read properties of undefined (reading 'length')` at RephraseProposal.tsx:150).** Older proposal envelopes (e.g. pre-this-story chat_messages rows) may surface payloads missing `suggestions` or `missing_fields` keys. The renderer now coalesces all three arrays via `?? []` so a missing key never crashes the bubble. Also added per-suggestion `errorMsg` chip + `unsupportedField` chip so PATCH failures (network drop, future LLM hallucinated `field` slot beyond the v1 allow-list) surface visibly instead of silently leaving the suggestion in a "pending" state.

**Async/await prohibition honoured.** No `async def`, no `await`, no `asyncio` import in any backend file in this story's diff. CrewAI's `crew.kickoff()` runs synchronously on the existing daemon thread spawned by `chat()`; `search_service.hybrid_search` is sync; `chat_service.update_message` is sync. The `extra="forbid"` hardening on `TodoUpdate` is the only PATCH-route change — no new endpoints, no new mutation paths.

**Tests added (47 net):** 18 backend + 23 frontend.

- Backend new files: `tests/agent/test_rephrase_skill.py` (21 tests — resolution helpers, search resolver branches incl. clear-winner / ambiguous / no-results / search-failure-swallowed / low-score-floor, task description shape, `output_pydantic` wiring, registry registration, `SkillContext` default-context isolation), `tests/agent/test_crew_runner_proposal.py` (8 tests — `_extract_proposal_envelope` happy path / missing-target / missing-pydantic / blank-reasoning, `run_crew` proposal-event-before-chunks order, JSON-parse-failure error event, `proposal_kind=None` skill unchanged, `finalise_assistant_message` writes metadata).
- Backend extended: `tests/api/test_agent.py` (3 new tests — context threading through to skill, omitting context defaults to empty, `finalise_assistant_message` writes proposal envelope to JSONB metadata column), `tests/api/test_todos.py` (2 new tests — PATCH rejects unknown field with 422, schema-level `extra="forbid"` guard), `tests/agent/test_crew_runner.py` (`_mock_skill` pin `proposal_kind=None`).
- Frontend new files: `RephraseProposal.test.tsx` (9 tests — empty / suggestion blocks / accept fires mutate / dismiss does NOT fire / known + unknown missing-field copy / stale chip / candidate chips / empty-everything render-nothing).
- Frontend extended: `useAgentStore.test.ts` (2 new tests — proposal ingest writes metadata.proposal without touching content/buffer; subsequent chunk after proposal still appends to content), `AgentMessage.test.tsx` (3 new tests — text_rewrite renders RephraseProposal sibling, missing metadata renders nothing, unknown kind renders nothing).

### File List

**New files:**
- `backend/src/agent/skills/rephrase.py`
- `backend/tests/agent/test_rephrase_skill.py`
- `backend/tests/agent/test_crew_runner_proposal.py`
- `frontend/src/components/agent/RephraseProposal.tsx`
- `frontend/src/components/agent/RephraseProposal.css`
- `frontend/src/components/agent/RephraseProposal.test.tsx`

**Modified files:**
- `backend/src/agent/skills/registry.py` — register rephrase skill with `proposal_kind="text_rewrite"`; widen `SkillContext` with `context: ChatRequestContext`, `resolved_target_id: uuid.UUID | None`, `resolved_candidates: Any`.
- `backend/src/agent/crew_runner.py` — add `CrewResult.metadata`, `_ProposalParseError`, `_extract_proposal_envelope`; branch on `spec.proposal_kind` in `run_crew` to consume `CrewOutput.pydantic` and emit `proposal` SSE event before chunks.
- `backend/src/api/agent.py` — thread `body.context` into `SkillContext`; extend `finalise_assistant_message` to write `result.metadata` via `chat_service.update_message(metadata=...)`.
- `backend/src/services/chat_service.py` — add `metadata: dict[str, Any] | None = None` kwarg to `update_message`; writes to ORM column attr `metadata_`.
- `backend/src/schemas/agent.py` — add `RephraseSuggestion`, `RephraseCandidate`, `RephraseEnvelope` Pydantic models.
- `backend/src/schemas/todo.py` — add `model_config = ConfigDict(extra="forbid")` on `TodoUpdate` (defence in depth on the LLM mutation surface).
- `backend/tests/agent/test_crew_runner.py` — pin `_mock_skill().proposal_kind = None` so legacy chat-path tests don't trip the new proposal pipeline.
- `backend/tests/api/test_agent.py` — extend `TestFinaliseAssistantMessage` + new `TestRephraseRoute` class.
- `backend/tests/api/test_todos.py` — extra-field rejection tests.
- `frontend/src/types/agent.ts` — add `ProposalEnvelope` interface; extend `SseEvent` union with `proposal` arm.
- `frontend/src/stores/useAgentStore.ts` — add `proposal` branch in `ingestSseEvent`; widen `sendMessage` to accept `SendMessageOptions { todoIds?, skill? }`; thread options into `streamAgentChat`.
- `frontend/src/stores/useAgentStore.test.ts` — proposal ingest + chunk-after-proposal tests.
- `frontend/src/hooks/useAgentSse.ts` — accept `todoIds?: string[]` arg, thread into request body's `context.todo_ids`.
- `frontend/src/components/agent/AgentMessage.tsx` — render `RephraseProposal` sibling when `metadata.proposal.kind === 'text_rewrite'`; tolerant `readProposalMetadata` parser.
- `frontend/src/components/agent/AgentMessage.test.tsx` — proposal-render branch tests.

### Change Log

| Date | Change |
|---|---|
| 2026-04-25 | Initial implementation: rephrase skill + crew_runner proposal pipeline + frontend SSE/ingest/renderer wired through. Mid-flight pivot from string-parse to `output_pydantic`. |
| 2026-04-26 | User-driven enhancement: search-based candidate resolution. `_resolve_via_search` runs hybrid_search and returns either a clear-winner target_id or top-3 candidate chips. Frontend renders chips that re-fire rephrase with the chosen id. Defensive runtime hardening (optional `?` chaining on payload arrays, error-chip surfacing on mutation failures). |
| 2026-04-26 | User-driven enhancement (round 2): cross-turn history inheritance + better intent-classifier routing. `_resolve_from_history` reads the immediate-prior assistant turn's `metadata_.proposal.targets[0]` and inherits it as the resolved target — handles "rephrase the dashboard task" → "add a due date" without re-stating the todo. Scope-limited to the IMMEDIATE prior assistant turn so stale targets from older conversation don't leak. Rephrase skill description rewritten to be directive ("Edit, rephrase, clarify, or add missing details ... Use this for ANY request that changes an existing todo's text — phrases like 'rephrase X', 'reword X', 'add a due date to X', 'edit X'") so the intent classifier picks rephrase for edit-style asks even when the user doesn't say "rephrase". 4 new history-resolver tests cover the inherit / no-proposal / no-history / immediate-prior-only scopes. 244/244 backend tests green. |
