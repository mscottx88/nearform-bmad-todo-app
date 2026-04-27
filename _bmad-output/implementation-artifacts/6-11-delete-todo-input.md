# Story 6.11: Delete TodoInput + EmptyPondHint Composer

Status: backlog

> **Scope note:** Cleanup story. Deletes the now-redundant
> `TodoInput` modal (the bottom-left "one-line input box") and its
> companion `EmptyPondHint`, after story 6.10 has migrated all of
> their functionality into the chat composer. Updates the
> `KeyboardShortcutsHint` footer to reflect the new flow. This is the
> "remove the alternative entry point" half of the chat-only-input
> initiative.
>
> **Dependencies:**
> - **Hard:** story 6.10 MUST be `done`. The composer must already
>   handle slash commands, plain-text creation, and `/help` —
>   verified by 6.10's manual smoke test.

---

## Story

As a user,
I want the bottom-left input box to go away now that the chat composer covers everything it did,
So that the UI has a single obvious place to type and the screen real estate it occupied is freed for the pond.

---

## Acceptance Criteria

### AC 1 — Delete `TodoInput` component + tests

**Given** story 6.10 has shipped and the chat composer covers all
of TodoInput's functionality

**When** this story ships

**Then** the following files are DELETED outright (not deprecated,
not commented out):
- `frontend/src/components/ui/TodoInput.tsx`
- `frontend/src/components/ui/TodoInput.test.tsx`
- `frontend/src/components/ui/TodoInput.css` (if exists)

All imports of `TodoInput` MUST be removed from their call sites
(probably `App.tsx` or `PondScene.tsx`). `npx tsc --noEmit` must
remain clean — no orphaned imports.

### AC 2 — Delete `EmptyPondHint` (or repurpose)

**Given** the
[EmptyPondHint](frontend/src/components/ui/EmptyPondHint.tsx)
currently displays "just start typing..." pointing implicitly at
the now-deleted TodoInput

**When** this story ships

**Then** EmptyPondHint is DELETED. The empty-pond zero-state
guidance moves into the existing
[KeyboardShortcutsHint](frontend/src/components/ui/KeyboardShortcutsHint.tsx)
or a new lightweight pond-overlay element pointing the user at the
chat panel:
- "Press F1 to open the chat panel and start typing" — or similar
  wording matching the project's existing voice.

**Decision point during implementation:** if the
KeyboardShortcutsHint already covers this case adequately (the user
sees "F1 → agent panel" in the footer at all times), then
EmptyPondHint can just be deleted with no replacement — the
shortcut hint already serves the purpose. The dev should pick the
simpler outcome and document the decision in the Change Log.

### AC 3 — Update `KeyboardShortcutsHint` footer

**Given** the existing
[KeyboardShortcutsHint](frontend/src/components/ui/KeyboardShortcutsHint.tsx)
lists the canonical shortcuts (Enter → new task, F1 → agent panel,
etc.)

**When** TodoInput is gone

**Then** the "Enter → new task" shortcut MUST be removed (it
referenced the TodoInput modal). The remaining shortcuts (F1, Esc,
camera controls, mouse) stay.

If the hint previously said "Enter on the pond opens the input
box", remove that line entirely. Pressing Enter on the empty pond
should now do nothing (or, optionally, focus the chat composer —
see AC 4).

### AC 4 — Pond Enter-key handler decision

**Given** pressing Enter while the pond canvas has focus currently
opens the TodoInput

**When** TodoInput is gone

**Then** EITHER:
- **Option A (recommended):** Pressing Enter on the pond opens the
  agent panel (if closed) and focuses the chat composer. This
  preserves muscle memory: "I want to type something" → "Enter".
- **Option B:** Pressing Enter does nothing on the pond. User must
  press F1 explicitly to open the panel.

Implementation should pick Option A unless it conflicts with another
keyboard handler. Document the choice in the Change Log.

### AC 5 — Slash command shared helpers stay

**Given** story 6.10 extracted help-carve-out into
`frontend/src/utils/slashCommandShared.ts` and left
[`slashCommands.ts`](frontend/src/utils/slashCommands.ts) +
[`visibilityCommands.ts`](frontend/src/utils/visibilityCommands.ts)
authoritative

**When** this story ships

**Then** none of those shared utility files are deleted — they're
still used by the chat composer. Only TodoInput's specific code is
removed.

### AC 6 — Tests

**Frontend (vitest):**

- All TodoInput-specific tests (`TodoInput.test.tsx`) are deleted
  alongside the component.
- All EmptyPondHint-specific tests are deleted.
- Other tests that import from these files are updated (likely
  none, but `npx tsc --noEmit` will catch any).
- `KeyboardShortcutsHint.test.tsx` (if exists) updated to reflect
  the removed Enter shortcut.
- New test for the pond Enter-key handler (per AC 4 Option A):
  pressing Enter on the pond canvas dispatches
  `useAgentStore.openPanel()` AND focuses the composer. (Skip if
  Option B chosen.)
- Full test suite runs clean — verify no orphaned references.

### AC 7 — Definition of Done

- All ACs satisfied with code + tests.
- 6.10 (`chat-composer-absorbs-todo-input`) is `done` on `master`
  BEFORE this story can flip to `review`. Verify via
  sprint-status.yaml.
- `npx tsc --noEmit` clean.
- Vitest suite green; no test files orphaned.
- Manual smoke:
  1. The bottom-left input box is GONE.
  2. Pressing F1 opens the chat panel.
  3. Typing in the composer works for all flows (slash commands,
     plain-text creation, `/help`) — same smoke checks as 6.10.
  4. Pressing Enter on the pond opens the panel + focuses the
     composer (if AC 4 Option A) or does nothing (Option B).
  5. The empty-pond zero state shows the user where to type
     (either via KeyboardShortcutsHint alone, or a replacement
     hint per AC 2).
- Story flipped to `review`; sprint-status synced.
- Code review run (bmad-code-review skill) before flipping to
  `done`.

---

## Tasks / Subtasks

### Task 1 — Decide: keep or delete `EmptyPondHint` (AC 2)

- [ ] Open the app with zero todos. Note what the user actually
  sees in the empty-pond state today.
- [ ] If KeyboardShortcutsHint already mentions "F1 to open agent
  panel" prominently → delete EmptyPondHint with no replacement.
- [ ] Else → either retarget EmptyPondHint to point at the agent
  panel ("Press F1 and start typing") or extend
  KeyboardShortcutsHint. Pick whichever is fewer lines of code.
- [ ] Document the choice in the Change Log.

### Task 2 — Delete TodoInput (AC 1)

- [ ] Delete `frontend/src/components/ui/TodoInput.tsx` +
  `.test.tsx` + `.css`.
- [ ] Find call sites via `grep -rn 'TodoInput'`. Remove imports
  + the JSX usages. Likely a single mount point in `App.tsx` or
  `PondScene.tsx`.
- [ ] Run `npx tsc --noEmit` and fix any orphaned references.

### Task 3 — Update pond Enter-key handler (AC 4)

- [ ] Find the existing keyboard listener that opens TodoInput on
  Enter. Likely in a `useKeyboardShortcuts` hook or directly in
  `PondScene.tsx`.
- [ ] Replace with: `if (e.key === 'Enter') { useAgentStore.getState().openPanel(); /* focus composer via ref or post-frame focus */ }`.
- [ ] Verify the handler doesn't fire while the user is typing in
  any other input (avoid double-trigger).

### Task 4 — Update KeyboardShortcutsHint (AC 3)

- [ ] Remove the "Enter → new task" line.
- [ ] If AC 4 Option A: optionally update the F1 line to mention
  Enter as an alternative.

### Task 5 — Tests (AC 6)

- [ ] Delete TodoInput test files alongside the component.
- [ ] Delete EmptyPondHint test files (per AC 2 decision).
- [ ] Add the pond-Enter handler test (per AC 4).
- [ ] Run full test suite.

### Task 6 — Polish + manual smoke + code review (AC 7)

- [ ] Manual smoke per AC 7. Pay special attention to
  zero-state UX (a fresh user with no todos should immediately
  understand where to start).
- [ ] Run gates.
- [ ] Story → review → run bmad-code-review → resolve findings →
  done.

---

## Dev Notes

### Why this is its own story (not bundled with 6.10)

Two reasons:
1. **Safety net.** Shipping the migration (6.10) and the deletion
   (6.11) in separate landings means we can revert one without
   the other. If 6.10 ships but a slash-command edge case is
   broken in the composer, TodoInput is still there as a
   workaround until the bug is fixed.
2. **Reviewability.** Deletion stories are usually small + boring
   but worth a focused review (to catch orphaned imports,
   unhandled keyboard wires, etc.). Bundling deletion into a
   migration story dilutes both reviews.

### Why F1 → agent panel is the new "Enter to type" muscle memory

Per the existing
[KeyboardShortcutsHint](frontend/src/components/ui/KeyboardShortcutsHint.tsx),
F1 is already the canonical "open agent panel" shortcut. AC 4
Option A makes Enter ALSO open the panel (when pond canvas is
focused), so existing muscle memory ("I want to type" → press
Enter) keeps working — it just opens a different surface.

### What NOT to do in this story

- **Don't refactor the slash-command registry.** Those files are
  still used by the chat composer (per 6.10). Touching them here
  is out of scope.
- **Don't change the composer styling or layout.** Story 6.10
  established the composer as the input surface; this story just
  deletes the alternative.
- **Don't add new keyboard shortcuts.** Stick to the AC 4 decision
  (Enter on pond → open panel, OR no-op).

### File locations

**Deleted files:**
- `frontend/src/components/ui/TodoInput.tsx`
- `frontend/src/components/ui/TodoInput.test.tsx`
- `frontend/src/components/ui/TodoInput.css` (if exists)
- `frontend/src/components/ui/EmptyPondHint.tsx` (per AC 2 decision)
- `frontend/src/components/ui/EmptyPondHint.test.tsx` (if exists)
- `frontend/src/components/ui/EmptyPondHint.css` (if exists)

**Modified files:**
- `frontend/src/App.tsx` or `frontend/src/components/pond/PondScene.tsx`
  — remove `<TodoInput />` mount + import
- `frontend/src/components/ui/KeyboardShortcutsHint.tsx` — drop
  the Enter shortcut row
- Wherever the pond Enter-key handler lives — replace with
  panel-open

**Untouched (deliberate):**
- `frontend/src/utils/slashCommands.ts`
- `frontend/src/utils/visibilityCommands.ts`
- `frontend/src/utils/slashCommandShared.ts` (extracted in 6.10)
- All backend code

### References

- [6-10-chat-composer-absorbs-todo-input.md](6-10-chat-composer-absorbs-todo-input.md)
  — the hard-dependency story
- [TodoInput.tsx](frontend/src/components/ui/TodoInput.tsx) — file
  to delete
- [EmptyPondHint.tsx](frontend/src/components/ui/EmptyPondHint.tsx)
  — file to delete or retarget
- [KeyboardShortcutsHint.tsx](frontend/src/components/ui/KeyboardShortcutsHint.tsx)
  — file to update

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
| 2026-04-26 | Story drafted. Cleanup story to delete TodoInput + EmptyPondHint after story 6.10 has migrated their functionality into the chat composer. Includes a decision-during-implementation on whether to retarget EmptyPondHint or just rely on KeyboardShortcutsHint. Hard dependency on 6.10. |
