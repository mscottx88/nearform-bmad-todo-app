# Story 6.12: Chat Suggested Actions

Status: ready-for-dev

> **Scope note:** Closes a cross-skill UX gap: when the chat skill
> says "Want me to rephrase X?" and the user replies "Do it!", the
> intent classifier currently routes "Do it!" back to the chat skill
> (which then tells the user to paste a long phrase to trigger
> rephrase). Adds a structured `suggested_action` side-channel:
> chat-skill prose can attach a machine-readable hint, the frontend
> renders a one-click confirm chip, AND the backend recognises typed
> confirmations on the next turn and pre-empts the classifier.
>
> **Dependencies:** none — independent of 6-8/6-9/6-10/6-11.
> Follows the proposal-envelope precedent (6.3, 6.8) for envelope
> shape and persistence machinery.

---

## ⚠️ CRITICAL CONSTITUTIONAL CONSTRAINT

**Async/await is PROHIBITED in backend code** — see [CLAUDE.md](CLAUDE.md)
§ "CONCURRENCY MODEL — THREAD-BASED ONLY". CrewAI's `crew.kickoff()`
runs synchronously on the existing daemon thread. JavaScript/TypeScript
in `frontend/` uses async normally (the ban is Python-only).

---

## Story

As a user,
I want the agent to follow through when it offers an action and I confirm — without me having to paste back the long instructions it just printed,
So that "Want me to rephrase X?" → "Do it!" actually rephrases X, instead of looping back to the chat skill and asking me to retype the request.

---

## User Experience

### Happy path — clicking the chip

1. **User:** "rephrase the park task to include this weekend's plan"
2. **Assistant** *(chat skill)*: "Want me to rephrase [Hang out with Ryker at the park](todo://...) to include the timeline?"
   *Below the bubble, a small confirm chip appears: `[ ✓ Rephrase the park task ]`.*
3. **User clicks the chip** → frontend dispatches a fresh chat turn with `skill: "rephrase"` and the chat-suggested prefilled message. Rephrase skill runs immediately, drafts the change, renders the standard `RephraseProposal` block.

### Happy path — typed confirmation

1. **User:** *(same as above)*
2. **Assistant** *(chat skill)*: *(same — chip rendered)*
3. **User:** "Do it!"
4. Backend sees the prior assistant turn had an open `suggested_action` AND the new user message looks like a confirmation. Routes the turn to `rephrase` (using the suggestion's prefilled message) **without running the intent classifier**. The user types four characters and gets the right behaviour.

### Cancel paths

- **Explicit dismiss:** the chip carries a small × button. Clicking
  it marks the suggestion `dismissed` — no chat turn dispatched, the
  chip fades, no further auto-routing on confirmation phrases.
- **User pivots:** if the user's next message looks neither like a
  confirmation nor like the suggested skill's intent, the suggestion
  is consumed-as-stale (no auto-route) and the conversation
  continues normally. Confirmation detection has a deliberately
  narrow allowlist of phrases (see AC 4); anything outside it
  invalidates the suggestion.
- **Page reload mid-suggestion:** the suggestion persists via
  `metadata.suggested_action` on the assistant row. After reload the
  chip rehydrates. If the user sends an unrelated message at that
  point, the suggestion is consumed as stale (same rule as above).

---

## Acceptance Criteria

### AC 1 — `SuggestedAction` schema

**Given** the chat skill needs a structured side-channel for action
suggestions

**When** an envelope is produced

**Then** `src/schemas/agent.py` adds:

```python
from typing import Literal

class SuggestedAction(BaseModel):
    """Structured side-channel attached to a chat-skill turn that
    offers an action the chat skill itself cannot execute (rephrase,
    create_todo, etc.). The frontend renders a one-click confirm
    chip; the backend also pre-empts the intent classifier when the
    next user turn matches a confirmation phrase.

    `extra="forbid"` is defence in depth — the LLM authors this and
    the routing layer trusts it; locking the shape prevents a
    hallucinated `arguments` or `tool_call` field from sneaking in.
    """

    model_config = ConfigDict(extra="forbid")

    # Allowlist of skills the chat skill is permitted to suggest.
    # Narrowing via Literal keeps the LLM from dragging the user
    # into an unwired skill ("plan", "organize" come later — add
    # them to the literal when those skills land).
    skill: Literal["rephrase", "create_todo"]

    # Pre-filled prompt that becomes the next turn's user_message
    # when the user confirms (replacing whatever they typed —
    # usually a short "yes"/"do it"). The downstream skill sees
    # this as the actionable request.
    prefilled_message: str

    # Optional pre-resolved targets. The chat skill knows which
    # todo it was discussing, so it stamps the id here — the
    # downstream rephrase skill skips its own resolver and uses
    # this directly via the existing `context.todo_ids` channel.
    target_todo_ids: list[uuid.UUID] = Field(default_factory=list)

    # Short label for the confirm chip ("Rephrase the park task" /
    # "Create the todo"). LLM-authored. Capped to keep the chip
    # readable on a narrow panel.
    confirm_label: str = Field(min_length=1, max_length=80)
```

### AC 2 — `ChatEnvelope` wrapping the chat skill's output

**Given** the chat skill currently returns plain prose via
`str(result).strip()`

**When** this story ships

**Then** the chat skill switches to `output_pydantic=ChatEnvelope`:

```python
class ChatEnvelope(BaseModel):
    """Story 6.12 — chat skill structured output. `prose` is the
    streamable reply (becomes the chat-bubble text); `suggested_action`
    is the optional side-channel hint the routing layer consumes."""

    model_config = ConfigDict(extra="forbid")

    prose: str
    suggested_action: SuggestedAction | None = None
```

The chat skill's task description (added at the end of the existing
prompt body in `chat.py::_format_task_description`) instructs:

> If your reply OFFERS to perform an action that you cannot execute
> directly (rephrase, create-todo), populate `suggested_action`
> with:
> - the skill name from the allowlist;
> - a `prefilled_message` that, if the user confirms, becomes the
>   next request — write it as the user would have typed it
>   ("rephrase X to include..." / "remind me to call my mum...");
> - any `target_todo_ids` you've already named in your prose;
> - a short `confirm_label` for the confirm chip.
>
> If your reply doesn't offer an action (just answering a question,
> general chitchat), leave `suggested_action` null.

### AC 3 — `crew_runner` emits `suggested_action` SSE event + persists metadata

**Given** the chat skill produces a `ChatEnvelope` whose
`suggested_action` is non-null

**When** `run_crew` finalises the kickoff result

**Then** before the chunk-streaming loop fires, `crew_runner` emits
a NEW SSE event:

```jsonc
{
  "type": "suggested_action",
  "skill": "rephrase",
  "prefilled_message": "Rephrase the park task to: ...",
  "target_todo_ids": ["..."],
  "confirm_label": "Rephrase the park task"
}
```

…and the chat skill's `CrewResult.metadata` carries
`{"suggested_action": <envelope>}`. `finalise_assistant_message`
writes that to the assistant row's `metadata_` JSONB column,
mirroring how proposals persist per story 6.3.

**Implementation note:** the chat skill is NOT switched to a
`proposal_kind` (it doesn't produce a proposal in the
text_rewrite/todo_draft sense). Instead, `crew_runner` adds a
parallel "extract suggested_action from a ChatEnvelope" path that
fires when `proposal_kind is None` AND the parsed pydantic instance
has a `suggested_action` attribute. Symmetric with the existing
`_extract_proposal_envelope` flow but distinct (different SSE event
type, different metadata key).

If the LLM's prose path produces a malformed envelope (CrewAI
parse failure), fall back to the pre-6.12 behaviour: stream the
raw `str(result).strip()` and log a warning. Don't fail the run.
Chat is the safety-net skill — degrading silently is preferable to
a hard error in conversational replies.

### AC 4 — Backend confirmation pre-empts classifier

**Given** a chat turn arrives with `skill=null` (classifier path),
AND the IMMEDIATE-prior assistant message carries a non-consumed
`metadata.suggested_action`

**When** `api/agent.py::chat()` processes the request, BEFORE
running the intent classifier

**Then** it checks whether the user's message matches a
**confirmation phrase** (case-insensitive, after `.strip()`):

```python
# Conservative allowlist — narrow phrases that have only ONE
# reasonable interpretation in the context of an offered action.
_CONFIRMATION_PHRASES: frozenset[str] = frozenset({
    "yes", "yeah", "yep", "yup", "sure", "ok", "okay",
    "do it", "do it!", "go for it", "go ahead", "please do",
    "yes please", "sounds good", "👍", "yes!",
})
```

If the message matches:
1. Mark the suggestion **consumed** (set
   `metadata.suggested_action.consumed = True` on the prior
   assistant row, via a separate `chat_service.update_message`
   call so the chip renders as faded on reload).
2. Substitute `body.content = suggestion.prefilled_message` and
   `body.context.todo_ids = suggestion.target_todo_ids` BEFORE
   creating the user message. The user-message DB row carries the
   ACTUAL text the user typed ("Do it!") in `content`, but a new
   `display_metadata.routed_via_suggestion = True` flag tells the
   frontend to render a small "(routed via 'Rephrase the park task')"
   subtitle so the user sees what happened.
3. Set `resolved_skill = suggestion.skill` directly — skip the
   classifier.
4. Run the resolved skill normally with the substituted message
   + todo_ids. The downstream skill (rephrase / create_todo) is
   unchanged — it sees a normal turn.

**If the message does NOT match** the confirmation allowlist: leave
the suggestion alone, run the classifier as usual. The classifier's
output may still route to the suggested skill on its own merits
(e.g. user typed "rephrase the park task to ..." which classifier
routes to rephrase regardless). In that case the suggestion is
**consumed as stale** AT THE END of the turn (set `consumed=True`
unconditionally if the immediate-prior user turn isn't a
confirmation) so the chip doesn't linger.

**Pickyness:** confirmation detection is intentionally narrow.
"sounds great", "let's do it", "alright let's go" don't match. The
chip is the canonical confirmation path; typed confirmations are a
nice-to-have shortcut. Better to under-route a few phrasings (user
clicks the chip instead) than to over-route a phrase like "yes"
that they meant as part of a longer sentence.

### AC 5 — Frontend `SuggestedActionChip` renderer

**Given** an assistant message arrives with
`metadata.suggested_action` (live via SSE OR rehydrated from the DB)

**When** the message renders

**Then** a new component
`frontend/src/components/agent/SuggestedActionChip.tsx` mounts
BELOW the bubble (sibling of any RephraseProposal / TodoDraftProposal
renderer, ABOVE them if both exist — though they shouldn't on the
same row). Layout:

```
[ ✓ Rephrase the park task ]   [ × ]
```

**Click on the confirm button** → dispatches
`useAgentStore.getState().sendMessage(suggestion.prefilled_message, {
  skill: suggestion.skill,
  todoIds: suggestion.target_todo_ids,
})`. Local React state marks the chip `consumed`, swapping it for a
faded `✓ done` indicator. (The backend `consumed=True` write
synchronises this on reload.)

**Click on the × button** → marks `dismissed` locally and the chip
hides. The DB row's metadata stays as-is; on reload the chip
reappears UNLESS the backend marked it `consumed` via the
typed-confirmation path. (Local-only dismiss is the same pattern
RephraseProposal already uses.)

**Status gating:** the chip ONLY renders when
`message.status === 'complete'` (mirroring the rephrase patch from
6.3 CR P613) so a cancelled / failed bubble never surfaces a
clickable suggestion.

**Null guard:** the suggested-action read goes through the same
defensive `readSuggestedActionMetadata` pattern as
`readProposalMetadata` — tolerates `null` / `undefined` /
non-object metadata.

### AC 6 — Frontend SSE event extension

`types/agent.ts` extends the `SseEvent` union:

```ts
export type SseEvent =
  // ... existing arms ...
  | {
      type: 'suggested_action';
      skill: 'rephrase' | 'create_todo';
      prefilled_message: string;
      target_todo_ids: string[];
      confirm_label: string;
    };
```

`useAgentStore.ingestSseEvent` adds a new arm that writes
`metadata.suggested_action` onto the streaming bubble — same pattern
as the existing `proposal` arm (untouched by this story). Doesn't
mutate `content` / `streamingBuffer`.

The store also tracks a `consumed` flag on each suggestion that
local clicks flip. Reload pulls the truth from the persisted row.

### AC 7 — `display_metadata.routed_via_suggestion` user-message subtitle

**Given** the backend substituted `prefilled_message` for the user's
typed confirmation per AC 4

**When** the user message renders in the chat panel

**Then** below the user's actual typed text ("Do it!"), the bubble
shows a small italic subtitle:

> *(routed via "Rephrase the park task")*

…using the `display_metadata.routed_via_suggestion = true` +
`display_metadata.suggestion_label = "Rephrase the park task"`
fields the backend set on the user-message row. This makes the
substitution visible — the user knows what their "Do it!" actually
triggered. Without this, a typed-confirmation that routed to the
wrong skill (LLM mis-suggested) would be confusing.

### AC 8 — Backend safety + security

The chat skill's prose is user-data-derived (todos in context, prior
messages). A malicious todo body could craft an LLM reply that puts
adversarial content into `prefilled_message`, which then becomes the
NEXT turn's user_message verbatim. Mitigations:

1. The downstream skill (rephrase / create_todo) ALREADY frames its
   own task as untrusted-data per the existing
   `_REPHRASE_UNTRUSTED_DATA_FRAMING` constant. The LLM treats the
   substituted message as data, not instructions.
2. The `Literal` type on `SuggestedAction.skill` is a hard allowlist.
   Even if the LLM hallucinated a skill name like
   `"delete_all_todos"`, Pydantic rejects via `extra_forbidden` /
   `literal_error`.
3. `prefilled_message` and `confirm_label` are bounded by Pydantic
   validation (`max_length`) so an LLM can't smuggle a 100k-char
   payload that floods the next prompt.
4. The user sees the substituted message via AC 7's subtitle — they
   can hit Cancel on the resulting proposal block before it commits.

### AC 9 — Tests

**Backend (pytest):**

- `tests/agent/test_chat_skill.py`:
  - `build()` task carries `output_pydantic=ChatEnvelope`.
  - Task description includes the suggested-action instruction
    block.
  - Chat skill produces an envelope with `suggested_action=null` for
    a question-only turn (mocked LLM).
  - Chat skill produces an envelope with non-null
    `suggested_action` for an offer-shaped turn (mocked LLM).
- `tests/agent/test_crew_runner_suggested_action.py` (new):
  - When chat skill returns ChatEnvelope with
    `suggested_action`, an SSE `suggested_action` event fires
    BEFORE the first chunk.
  - When `suggested_action` is null, no such event fires.
  - `CrewResult.metadata.suggested_action` round-trips to the
    assistant row via `finalise_assistant_message`.
  - Malformed envelope (no `prose` key) falls back to streaming
    `str(result).strip()` with a warning log; no SSE crash.
- `tests/api/test_agent.py`:
  - Confirmation pre-empt: prior assistant row has
    `metadata.suggested_action`, new user message is "Do it!" —
    the resolved skill is the suggestion's skill (NOT the
    classifier's output), the user-message row content is "Do it!"
    but `display_metadata.routed_via_suggestion = True`, and the
    suggestion is marked `consumed=True`.
  - Non-confirmation message: the suggestion is left intact and
    the classifier runs as usual. (After the turn the suggestion
    is marked consumed-as-stale.)
  - No prior suggestion: confirmation phrase doesn't trigger any
    special path (regression guard against a dangling
    `_CONFIRMATION_PHRASES` check).
  - Suggestion `skill` value outside the Literal allowlist is
    rejected at envelope-parse time (Pydantic 422 before reaching
    the routing layer).

**Frontend (vitest):**

- `SuggestedActionChip.test.tsx`:
  - Renders confirm button with `confirm_label` text.
  - Clicking confirm fires `sendMessage(prefilled_message, { skill, todoIds })`.
  - Clicking × hides the chip without dispatching.
  - `consumed=true` flag renders the faded ✓-done state.
  - Status gating: chip not rendered when
    `message.status !== 'complete'`.
- `useAgentStore.test.ts`:
  - `ingestSseEvent` handles a `suggested_action` event by writing
    to `metadata.suggested_action` on the streaming bubble; doesn't
    touch `content` / `streamingBuffer`.
- `AgentMessage.test.tsx`:
  - Renders `SuggestedActionChip` sibling when
    `metadata.suggested_action` is present AND status is complete.
- New backend integration test for the user-message subtitle
  (AC 7): user-message rows with `routed_via_suggestion` flag
  carry the suggestion label through to `GET /sessions/{id}/messages`.

### AC 10 — Definition of Done

- All ACs satisfied with code + tests.
- Lint clean (ruff, mypy, tsc).
- Pytest + vitest suites green (target: existing 255 + ~12 new
  backend, existing 561 + ~8 new frontend).
- No async/await in backend.
- Manual smoke per § User Experience: both happy paths AND both
  cancel paths run end-to-end in dev.
- Story flipped to `review`; sprint-status synced.
- Code review run (bmad-code-review) before flipping to `done`.

---

## Tasks / Subtasks

### Task 1 — Backend: schemas (AC 1, AC 2)

- [ ] Add `SuggestedAction` and `ChatEnvelope` to
  `src/schemas/agent.py`. Both `extra="forbid"`.
- [ ] Schema-level tests: rejects unknown keys; rejects skill
  values outside the Literal allowlist; enforces
  `confirm_label` length bounds.

### Task 2 — Backend: chat skill envelope output (AC 2)

- [ ] In `src/agent/skills/chat.py`, add the suggested-action
  instruction block to the task description.
- [ ] Wire `output_pydantic=ChatEnvelope` on the Task.
- [ ] Verify the existing `_format_task_description` tests still
  pass (the body is unchanged; only an instruction block is
  appended).

### Task 3 — Backend: `crew_runner` suggested-action emit + metadata (AC 3)

- [ ] Add a parallel extract path to `crew_runner` that fires
  when `proposal_kind is None` AND the parsed pydantic has a
  `suggested_action` attribute. Emit `{type: "suggested_action", ...}`
  before chunk streaming.
- [ ] Set `CrewResult.metadata.suggested_action` (key sibling to
  the existing `metadata.proposal` from 6.3).
- [ ] On malformed envelope (Pydantic parse fail), fall back to
  the pre-6.12 plain-string streaming and log a warning. No SSE
  crash.
- [ ] Tests in `test_crew_runner_suggested_action.py`.

### Task 4 — Backend: confirmation pre-empt in `api/agent.py` (AC 4, AC 7)

- [ ] Define `_CONFIRMATION_PHRASES` frozenset at module scope.
- [ ] In `chat()` BEFORE the classifier call, check the prior
  assistant message's `metadata.suggested_action`. If it exists,
  is non-consumed, AND the user message matches a confirmation
  phrase: substitute message + todo_ids, set
  `resolved_skill` directly, mark suggestion `consumed=True`, set
  `display_metadata.routed_via_suggestion + suggestion_label` on
  the user-message row.
- [ ] After-turn cleanup: if the suggestion wasn't consumed via
  confirmation but the classifier didn't route to the suggested
  skill anyway, mark `consumed=True` (stale) so the chip stops
  rendering.
- [ ] Tests in `test_agent.py`.

### Task 5 — Frontend: SSE union + ingest (AC 6)

- [ ] Add `suggested_action` arm to `SseEvent` in
  `frontend/src/types/agent.ts`.
- [ ] `useAgentStore.ingestSseEvent` writes
  `metadata.suggested_action` on the streaming bubble. Don't
  touch content / streamingBuffer.
- [ ] Test in `useAgentStore.test.ts`.

### Task 6 — Frontend: `SuggestedActionChip` renderer (AC 5, AC 7)

- [ ] New component
  `frontend/src/components/agent/SuggestedActionChip.tsx`.
- [ ] Confirm button → `useAgentStore.getState().sendMessage(...)`
  with `skill` + `todoIds` overrides.
- [ ] × button → local dismiss.
- [ ] `consumed` state renders faded ✓-done.
- [ ] Status gating on `message.status === 'complete'`.
- [ ] CSS at `SuggestedActionChip.css` matching agent panel
  vocabulary.
- [ ] User-message subtitle (`routed_via_suggestion` rendering) —
  small CSS / JSX change in `AgentMessage.tsx` for the user-role
  branch.
- [ ] Tests in `SuggestedActionChip.test.tsx`.

### Task 7 — Frontend: AgentMessage wiring (AC 5)

- [ ] In `AgentMessage.tsx`, mount `SuggestedActionChip` as a
  sibling of the bubble when assistant message metadata carries
  the suggestion (separate slot from the proposal switch — both
  could in theory render on the same bubble, though in practice
  proposal-skills don't currently produce suggestions).
- [ ] Test the render in `AgentMessage.test.tsx`.

### Task 8 — Polish + run gates (AC 10)

- [ ] Format + lint + type-check + full test suites.
- [ ] Manual smoke per AC 10.
- [ ] Story → review → bmad-code-review → done.

---

## Dev Notes

### Why a side-channel on chat, not a new "router" skill

A standalone "router" skill would need to read every chat-skill
turn's content + classify the user's reply — duplicating the chat
skill's LLM call. The side-channel approach lets the chat skill,
which already understands its own offered action, ALSO emit the
machine-readable hint at zero marginal LLM cost. Cleaner data flow
+ no extra latency.

### Why narrow confirmation phrases, not LLM-based intent detection

The intent classifier could theoretically take the prior turn's
suggestion as additional context and decide whether the user is
confirming. But:
- Adding chat history to the classifier prompt costs tokens on
  every turn (not just confirmation turns).
- LLMs occasionally over-route — interpret "yes — but actually
  let me think about it" as confirmation.
- Frontend chip is the canonical UX. Typed confirmation is a
  shortcut for power users; better to under-route safely than
  over-route surprisingly.

### Why mark suggestions consumed-as-stale aggressively

The chip is sticky to its assistant row. Without aggressive
consumption, an old chip from three turns ago could still trigger
typed-confirmation routing if the user happens to say "yes" to an
unrelated current question. Limiting the suggestion to be valid for
ONE next user turn — and marking consumed regardless of whether the
confirmation fired — keeps the rule predictable.

### Status interaction with story 6.10 (composer absorbs todo input)

Story 6.10 routes plain-text composer input through the intent
classifier. After this story (6.12) lands, that routing also
respects the suggested-action pre-empt. The two stories are
compatible — 6.10's classifier path runs only when 6.12's pre-empt
doesn't fire. No coupling required.

### Status interaction with story 6.8 (create_todo skill)

When 6.8 lands, the chat skill's allowlist (`Literal["rephrase",
"create_todo"]`) gains automatic coverage of suggested-create-todo
flows. Until then, only `rephrase` is meaningful in the allowlist;
the LLM's suggestions for "I could create a todo for that" can sit
in the schema as `create_todo` but the routing still works (the
downstream skill must exist or the routing 422s on
`SuggestedAction.skill` Literal validation). Recommend NOT shipping
this story before 6.8 — the chat skill would routinely suggest
create_todo and route it to a non-existent skill. Add a runtime
guard (Task 4) that strips skills not in `SKILL_REGISTRY` before
the pre-empt fires.

### File locations

**New backend files:**
- `backend/tests/agent/test_crew_runner_suggested_action.py`

**Modified backend files:**
- `backend/src/schemas/agent.py` — `SuggestedAction`, `ChatEnvelope`
- `backend/src/agent/skills/chat.py` — `output_pydantic`, instruction
- `backend/src/agent/crew_runner.py` — extract path + SSE emit
- `backend/src/api/agent.py` — confirmation pre-empt + display_metadata
- `backend/src/services/chat_service.py` — possibly extend
  `update_message` to support setting display_metadata fields
- `backend/tests/agent/test_chat_skill.py` — envelope shape tests
- `backend/tests/api/test_agent.py` — confirmation routing tests

**New frontend files:**
- `frontend/src/components/agent/SuggestedActionChip.tsx`
- `frontend/src/components/agent/SuggestedActionChip.test.tsx`
- `frontend/src/components/agent/SuggestedActionChip.css`

**Modified frontend files:**
- `frontend/src/types/agent.ts` — SseEvent union
- `frontend/src/stores/useAgentStore.ts` — ingestSseEvent arm
- `frontend/src/stores/useAgentStore.test.ts`
- `frontend/src/components/agent/AgentMessage.tsx` — chip mount +
  user-bubble subtitle
- `frontend/src/components/agent/AgentMessage.test.tsx`

### What v1 explicitly does NOT do

- **No multi-step flows.** The suggestion is a single-turn pre-empt.
  "Suggest, suggest, suggest, do it" — only the most recent
  suggestion is honoured.
- **No suggestion editing.** The user can't tweak the
  `prefilled_message` before confirming. They either accept as-is
  (chip click) or type their own variant (which the classifier
  then routes via its normal path).
- **No frontend-driven confirmation detection.** All typed-
  confirmation logic lives on the backend so SSR / curl-based
  clients work. Frontend is dumb.
- **No analytics on chip take-rate.** Worth doing eventually
  (which suggestion shapes get accepted vs ignored?) but out of
  scope here.

### What NOT to do in this story

- Don't add the suggested-action mechanic to ANY skill except chat.
  Other skills (rephrase, create_todo) already produce structured
  proposals — adding suggested_action on top would be redundant.
- Don't refactor `_extract_proposal_envelope` to subsume the
  suggested-action path. Different SSE event type, different
  metadata key, different downstream renderer — keeping the paths
  parallel makes each easier to reason about.
- Don't touch the intent classifier's prompt. It stays oblivious;
  the pre-empt happens BEFORE classification.

### Constitutional-compliance reminders

- No async/await in backend.
- Confirmation matching is a synchronous string check — don't
  introduce a separate LLM call for it.

---

## Story DoD (Definition of Done)

- [ ] All ACs (1-10) satisfied.
- [ ] All Tasks (1-8) checked off.
- [ ] Backend tests green (target: existing 255 + ~12 new).
- [ ] Frontend tests green (target: existing 561 + ~8 new).
- [ ] `ruff check`, `ruff format --check`, `mypy` clean.
- [ ] `npx tsc --noEmit` clean.
- [ ] Manual smoke per § User Experience (both confirm paths + both
  cancel paths).
- [ ] No async/await in backend code (constitutional).
- [ ] Story status flipped to `review`; sprint-status synced.
- [ ] Code review run (bmad-code-review skill) and review findings
  triaged before flipping to `done`.

---

## Dev Agent Record

### Agent Model Used

(populated by Dev agent)

### Debug Log References

(populated by Dev agent)

### Completion Notes List

(populated by Dev agent)

### File List

(populated by Dev agent)

### Change Log

| Date | Change |
|---|---|
| 2026-04-26 | Story drafted in response to a real-user dialogue: chat skill said "Want me to rephrase X?" and user replied "Do it!" — system told user to paste a long phrase to trigger rephrase instead of just doing it. Adds structured `suggested_action` envelope on chat-skill output, frontend confirm chip, AND backend confirmation pre-empt. Independent of other backlog stories (recommended sequencing: ship after 6-8 so the `create_todo` allowlist entry is meaningful). |
