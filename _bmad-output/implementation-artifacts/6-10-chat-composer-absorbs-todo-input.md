# Story 6.10: Chat Composer Absorbs Todo Input

Status: backlog

> **Scope note:** Migration story — make the chat composer the single
> entry point for ALL user input that the top-level
> `TodoInput` currently handles: slash commands (visibility toggles,
> `/help`, future `/spread-out`), plus plain-text todo creation. After
> this story lands, the chat composer covers 100% of input cases —
> story 6.11 then deletes the now-redundant `TodoInput`.
>
> **Dependencies:**
> - **Hard:** story 6.8 (`create_todo` skill) MUST be implemented and
>   `done`. Without it, plain text in the composer can't route to a
>   skill that creates todos — the user would be stranded.
> - **Soft:** story 6.9 (resizable panel) — independent but lands
>   well alongside this story since the user will be using the
>   panel more.

---

## Story

As a user,
I want everything I currently do via the bottom-left input box (slash commands like `/show-completed`, plain-text todo creation, `/help`) to work just as well from the chat composer,
So that there's one obvious place to type, and the agent can be in the conversational loop for those flows too.

---

## Acceptance Criteria

### AC 1 — Slash-command autocomplete in `AgentComposer`

**Given** the user types `/` as the first character in the composer

**When** they continue typing (or press Tab/Down-arrow)

**Then** an autocomplete menu appears above the composer listing all
slash commands available in the current world state (filtered via
`availableCommands(world)` — same source-of-truth as
[TodoInput](frontend/src/components/ui/TodoInput.tsx)).

**Filtering:** as the user types more characters, the menu narrows
by case-insensitive prefix match on `cmd.token`. Up/Down arrow keys
move the highlight; Enter selects + inserts the full token + a
trailing space; Escape dismisses the menu without committing.

**Multi-command chains:** the user can type
`/show-completed /hide-active` (matching the existing TodoInput
chain semantics from story 3.3). Walking the virtual world state
through each token is delegated to the existing
[`walkState`](frontend/src/utils/slashCommands.ts) function — the
composer doesn't reimplement parsing.

**Submit (Enter without menu open):** the chain is parsed via
`parseSlashCommands(text, world)`. On valid parse, each command's
`execute()` runs in sequence (same as TodoInput). On invalid parse
(unknown token, non-consumable command), the composer flashes a
neon-pink error border for 200ms and the input stays put — no chat
turn is dispatched.

### AC 2 — `/help` carve-out preserved

**Given** the user types `/help` or `/help <text>`

**When** they press Enter

**Then** the existing
[TodoInput help carve-out](frontend/src/components/ui/TodoInput.tsx)
behaviour fires:
- `/help` alone → opens the agent panel (already open, since this is
  the agent panel) and seeds the composer with the existing help
  prompt content. (If a deeper help-skill exists, route via the
  intent classifier; otherwise pre-fill the input with the static
  help text from TodoInput's existing handler.)
- `/help <text>` → seed the composer with the user's `<text>` AND
  flag it as a help-context turn so the chat skill knows to
  prioritize "explain how to..." framing.

**Implementation note:** the carve-out logic in TodoInput is
~10 lines (lines 156-166). Lift it into a shared helper at
`frontend/src/utils/slashCommands.ts` (or a new `slashCommandShared.ts`)
so both the existing TodoInput AND the new composer path call the
same code. Story 6.11 deletes the TodoInput call site; the helper
stays.

### AC 3 — Plain-text → routed via intent classifier

**Given** the user types plain text (NOT starting with `/`) in the
composer

**When** they press Enter to send

**Then** the existing chat send path fires
(`useAgentStore.sendMessage(content)`) — the intent classifier on
the backend then routes to:
- `chat` for question-style messages ("how many todos do I have?")
- `rephrase` for edit-style messages ("rephrase X to ...")
- `create_todo` for creation-style messages ("remind me to ...",
  "add a task: ...", "I need to ...")  — **requires 6.8 to be
  done**

The intent classifier already routes the first two; story 6.8 added
`create_todo` to the registry with a directive description that the
classifier picks up automatically (per
[6-8-create-todo-skill.md AC 1](6-8-create-todo-skill.md)).

**No new client-side classification logic.** This story does NOT
re-implement intent detection on the frontend — sending the message
to the existing backend SSE endpoint is the only entry point.

### AC 4 — Visual affordance: composer placeholder updates

**Given** the composer was previously placeholder-text "ask anything"
(per [AgentComposer.tsx](frontend/src/components/agent/AgentComposer.tsx))

**When** this story ships

**Then** the placeholder updates to:
`"type a todo, ask a question, or /command"`

…signaling all three input modes. Keep it terse (the composer is
narrow). The keyboard hint banner below stays as-is.

### AC 5 — TodoInput keeps working during the migration

**Given** this story removes NOTHING from
[TodoInput](frontend/src/components/ui/TodoInput.tsx) — story 6.11
is the deletion

**When** the user types in the bottom-left TodoInput

**Then** all existing behaviours (slash commands, plain-text creation,
`/help`) continue to function unchanged.

This is intentional: shipping 6.10 alongside (or before) 6.11 lets
us prove via dogfooding that the composer truly covers 100% of
input cases before deleting the alternative entry point. If a gap
surfaces, 6.10 is the place to patch it without an emergency
revert of TodoInput's deletion.

### AC 6 — Empty-state hint adapts (lightweight)

**Given** the
[EmptyPondHint](frontend/src/components/ui/EmptyPondHint.tsx)
currently displays "just start typing..." pointing implicitly at the
TodoInput

**When** this story ships, the user has TWO entry points

**Then** the hint stays as-is for now (still valid — both the
composer and the input accept "just start typing"). Story 6.11
updates / removes the hint when the TodoInput is gone.

(This is a deliberate non-change to keep 6.10 scoped tight.)

### AC 7 — Tests

**Frontend (vitest):**

- `AgentComposer.test.tsx`:
  - Typing `/` opens the autocomplete menu with all available
    commands listed.
  - Typing `/show-` filters to commands matching that prefix.
  - Selecting a menu item via Enter inserts `/show-completed `
    (with trailing space) and closes the menu.
  - Up/Down arrow keys navigate the menu highlight.
  - Escape dismisses the menu without inserting.
  - Submitting `/show-completed /hide-active` calls each command's
    `execute()` in order via `parseSlashCommands`.
  - Submitting `/unknown-cmd` flashes the error border and does NOT
    dispatch a chat turn.
  - Submitting `/help` triggers the help carve-out (assert via the
    shared helper, not the agent send path).
  - Submitting plain text dispatches `useAgentStore.sendMessage()`.
  - Placeholder text matches AC 4's literal.

- `slashCommandShared.test.ts` (new file, AC 2):
  - Help carve-out helper handles `/help`, `/help foo bar`, and
    `/help` with no args identically to the current TodoInput
    behaviour.

- Existing `TodoInput.test.tsx` MUST still pass unmodified — the
  TodoInput keeps working during migration.

**Backend:** no changes; story 6.8 already added `create_todo` to
the classifier's known-skills list. Verify via an existing
`test_agent.py` assertion that "remind me to ..." routes to
`create_todo` (added in 6.8 AC 9).

### AC 8 — Definition of Done

- All ACs satisfied with code + tests.
- 6.8 (`create_todo` skill) is `done` on `master` BEFORE this
  story can flip to `review`. Verify by checking sprint-status.yaml.
- `npx tsc --noEmit` clean.
- Vitest suite green (existing TodoInput tests still pass).
- Manual smoke:
  1. Open chat panel. Type `/` → menu appears.
  2. Type `/show-completed`, press Enter → completed todos appear
     in the pond.
  3. Type "remind me to call my mum by next sunday", press Enter
     → agent routes to `create_todo`, draft proposal appears,
     click Create → pad appears.
  4. Type "rephrase the dashboard task to be crisper", press
     Enter → agent routes to `rephrase`, suggestion proposal
     appears.
  5. TodoInput at the bottom of the screen still works for all of
     the above (regression check).
- Story flipped to `review`; sprint-status synced.

---

## Tasks / Subtasks

### Task 1 — Extract help-command carve-out into shared helper (AC 2)

- [ ] Move the `/help` and `/help <text>` handling from
  `TodoInput.tsx:156-166` into
  `frontend/src/utils/slashCommandShared.ts` (new file) as a pure
  function: `applyHelpCarveout(text: string, agentStore: AgentStore): boolean`
  returning `true` if the text was consumed by the help path.
- [ ] Replace the inline TodoInput logic with a call to the helper.
  Existing TodoInput tests should pass unchanged.
- [ ] Unit test the helper directly per AC 7.

### Task 2 — Slash-command autocomplete UI in AgentComposer (AC 1, 4)

- [ ] In `frontend/src/components/agent/AgentComposer.tsx`, add a
  controlled menu component that renders when the textarea's leading
  character is `/`. Filter via
  `availableCommands(world)` from the existing
  [`slashCommands.ts`](frontend/src/utils/slashCommands.ts) registry.
- [ ] Style the menu to match the agent panel vocabulary
  (var(--neon-cyan), monospace, glow on hover/highlight).
- [ ] Wire keyboard nav: Up/Down/Enter/Escape — but ONLY when the
  menu is open. Otherwise the existing Up/Down history-recall
  behaviour stays.
- [ ] Update the placeholder per AC 4.

### Task 3 — Slash-command submission path (AC 1)

- [ ] On Enter (without menu open), check if the text starts with
  `/`. If yes:
  - Apply the help carve-out helper (Task 1) — if it returns
    `true`, stop.
  - Else call `parseSlashCommands(text, world)`. On valid parse,
    iterate and call each command's `execute()`. Clear the
    composer.
  - On invalid parse (null return), trigger the error-border
    flash and keep the text in the composer.
- [ ] Plain text (no leading `/`) goes through the existing
  `useAgentStore.sendMessage()` path — NO changes there.

### Task 4 — Tests (AC 7)

- [ ] Per AC 7. Note: testing the autocomplete menu interaction
  requires the existing `world` snapshot. Mock or seed
  `availableCommands` to a known list to keep the test deterministic.

### Task 5 — Polish + manual smoke (AC 8)

- [ ] Run all gates.
- [ ] Manual smoke per AC 8. If a flow doesn't work in the composer
  but does in TodoInput, that's a 6.10 bug — fix here, don't
  defer.
- [ ] Story → review.

---

## Dev Notes

### Sequencing with 6.8

This story can ONLY be implemented after 6-8 is `done` because
"plain text in the composer creates a todo" is the load-bearing
new capability. If you start this story before 6-8, the composer's
plain-text path goes to the chat skill, which (per the system
prompt) tells the user "go use the in-app input box" — defeating
the entire migration.

**Sequencing test:** before flipping this story to review, run the
manual smoke step 3 ("remind me to call my mum") and verify a
`todo_draft` proposal appears in the chat. If it doesn't, 6-8 is
not actually done — fix that first.

### Why migrate to the composer at all

The user's stated goal: a single conversational loop for ALL
todo manipulation. Today the TodoInput is a fast-path for power
users (slash commands, mass creation) but it's a separate input
mode the user has to context-switch into. By moving everything to
the composer, the agent stays in-the-loop for every action — which
sets up future skills that operate on what the user just did
(e.g. an "organize" skill that reads the recent create-todo turns
to suggest grouping).

### What NOT to do in this story

- **Don't reimplement intent classification on the frontend.**
  The backend's `intent_classifier` skill already exists for this
  purpose. Frontend should be a dumb pipe.
- **Don't delete TodoInput yet.** Story 6.11 owns that. Leaving
  TodoInput working during the migration provides a safety net.
- **Don't merge the autocomplete styling into the existing
  TodoInput's autocomplete** — they're different components in
  different DOM trees. Each gets its own menu styled to its
  context (TodoInput is bottom-left modal, composer is bottom of
  the right panel). Once 6.11 deletes TodoInput, that duplication
  goes away naturally.

### File locations

**New files:**
- `frontend/src/utils/slashCommandShared.ts` — help carve-out
  helper
- `frontend/src/utils/slashCommandShared.test.ts` — helper tests

**Modified files:**
- `frontend/src/components/agent/AgentComposer.tsx` — autocomplete
  menu + slash-command submission path
- `frontend/src/components/agent/AgentComposer.test.tsx` — new
  tests
- `frontend/src/components/agent/AgentComposer.css` (or wherever
  the composer styles live) — autocomplete menu styles
- `frontend/src/components/ui/TodoInput.tsx` — extract help
  carve-out into helper call (no behaviour change)

**Untouched (deliberate):**
- `frontend/src/utils/slashCommands.ts` — registry stays
  authoritative
- `frontend/src/utils/visibilityCommands.ts` — registrations stay
- All backend code — no changes

### References

- [TodoInput.tsx](frontend/src/components/ui/TodoInput.tsx) lines
  156-179 — current slash-command + help handling to mirror
- [AgentComposer.tsx](frontend/src/components/agent/AgentComposer.tsx)
  lines 21-225 — current composer
- [slashCommands.ts](frontend/src/utils/slashCommands.ts) lines
  41-66, 78-226 — registry API surface
- [visibilityCommands.ts](frontend/src/utils/visibilityCommands.ts)
  lines 79-88 — concrete registered commands
- [6-8-create-todo-skill.md](6-8-create-todo-skill.md) — the
  hard-dependency story

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
| 2026-04-26 | Story drafted. Migrates slash-command autocomplete + plain-text routing into the chat composer while leaving TodoInput functional during the transition. Hard dependency on 6-8 (`create_todo` skill must exist for plain-text creation routing). |
