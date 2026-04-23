# Story 4-8: Batch Position Endpoint

Status: done

> Promoted from story 4.2 CR decision 2 (2026-04-23). Drag-release with cascade nudges fans out one PATCH per affected pad — this story collapses that into a single batch PATCH and routes every pad-position write through it.

---

## Scope

Ship:

1. **Backend** — `PATCH /api/todos/positions` accepting `{ positions: [{ id, position_x, position_y }, ...] }`, returning the refreshed todos in input order. Missing or soft-deleted ids are silently skipped rather than raising 404 (keeps the batch robust against deletes-during-drag).
2. **Frontend** — `useUpdateTodoPositions()` hook mirroring `useUpdateTodo`'s error/retry/invalidate wiring but for a batch payload.
3. **Rewire** — LilyPad's three commit paths (drag release, spread arrival, sibling-nudge commit) all dispatch through the new hook. Drag release collects the dragged pad + every cascade-displaced sibling from `displacedPads` into one batch call; spread arrival dispatches a single-entry batch per pad; sibling-nudge commit block now sets only local state (sticky, dragPosRef, nudgeRef reset) and lets the dragger own the write.

Do not ship:
- Additional PATCH/PUT endpoints for non-position fields.
- Retry / partial-success reconciliation beyond "re-fire the whole batch" (the React-Query retry budget already retries the mutation; partial failures are treated as full failures for decay purposes).

---

## Acceptance Criteria

1. `PATCH /api/todos/positions` returns 200 with a list of `TodoResponse` rows for an all-valid batch.
2. Unknown or soft-deleted ids are skipped (absent from the response). The 200 response still succeeds.
3. Empty `positions` → 422 (validation_error).
4. `position_x` and `position_y` are both required per entry. No partial-axis updates.
5. Other fields (text, completed, color) are NEVER touched by the batch endpoint.
6. A single drag release that cascaded into N sibling displacements fires exactly ONE PATCH, regardless of N.
7. Spread arrival PATCHes still stagger per pad (one-entry batches) — arrivals don't aggregate across frames.
8. Network error on the batch calls `setTodoError('update', err)` for every id in the batch.

---

## Dev Agent Record

### Implementation Notes

- **Route ordering** — `/api/todos/positions` is registered BEFORE `/api/todos/{todo_id}` in `backend/src/api/todos.py` so FastAPI's matcher picks the literal segment before trying to parse it as a UUID.
- **Missing-id policy** — skip silently (no 404). Rationale: drag release races with deletes naturally, and a 404 on a partial batch would poison the entire commit, forcing the client to redo work that already succeeded server-side. Caller compares returned ids against requested ids if distinction matters.
- **Input-order response** — the service iterates `entries` (request order), not the query result set. Safer for the client when it walks its own payload to diff.
- **Publish-threshold alignment** — `DISPLACED_PUBLISH_THRESHOLD` in LilyPad is pinned to 0.3 (same as the sibling-commit threshold) so every pad that acquires sticky at release is also in `displacedPads`, hence in the dragger's batch. Before alignment, a nudge between 0.3 and 0.5 was pinned locally but never PATCHed, leaving session-local visual drift that reset on refresh.
- **Commit block refactor** — the per-sibling commit block no longer dispatches a PATCH. It still resets local state (sticky, dragPosRef, nudge) and unpublishes from `displacedPads`. The dragger's `onWindowUp` reads `displacedPads` BEFORE clearing it, so sibling ids make it into the batch payload built at release time.

### Tests

- Backend: `tests/api/test_todos.py` — 5 new tests (batch happy-path, missing-id skip, empty-batch 422, no-touch-other-fields, soft-deleted skip). 29/29 in test_todos.py green.
- Frontend: existing LilyPad drag test updated for the new mutate-payload shape (array of entries instead of single entry). 303/303 frontend tests green.

### Completion Checklist

- [x] Backend endpoint + service + schema
- [x] `update_positions` service skips missing / soft-deleted
- [x] Route order: `/positions` before `/{todo_id}`
- [x] Frontend `useUpdateTodoPositions` hook with error/retry/invalidate parity
- [x] All three LilyPad commit paths routed through the batch hook
- [x] Publish threshold aligned with commit threshold (0.3) so every committed sibling joins the batch
- [x] Backend tests (5 new): batch happy-path, skip-missing, empty-rejected, no-touch-other-fields, skip-soft-deleted
- [x] Frontend LilyPad drag-release test asserts batch shape
- [x] `ruff check` / `ruff format --check` / `mypy` — clean
- [x] `npx tsc --noEmit` — clean
- [x] `npx vitest run` — 303/303 green
