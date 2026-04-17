# Deferred Work

## Deferred from: code review of story 1-1-project-scaffolding-and-infrastructure (2026-04-15)

- `google_api_key` defaults to empty string with no startup validation — will cause opaque errors when embedding feature is implemented (Story 5.1)
- No authentication or authorization on any API endpoint — unauthenticated write access could trigger unbounded embedding generation/billing
- Soft delete not enforced at query layer — no base filter excludes deleted/archived rows; must be added in service layer (Story 2.1)
- CI backend workflow does not run `alembic upgrade head` before tests — will break when DB integration tests are added
- `embedding_status` column is unconstrained String(20) — no DB check constraint for valid values (pending/complete/failed)
- `Creature.todo_id` FK lacks `ondelete` clause — orphaned creatures possible on hard delete; should be SET NULL
- `color` field accepts any 7-char string, not just valid hex colors — no check constraint
- `updated_at` uses ORM-level `onupdate` only — raw SQL updates won't trigger it; consider DB trigger
- `database_url` accepted without format validation — malformed URLs cause unhelpful startup crashes
- `archive_threshold_days` accepts zero or negative values — no bounds validation
- Frontend `VITE_API_URL=/api` is a relative path that only works with Vite dev proxy, not production deployments
- CI workflows only trigger on `backend/**` and `frontend/**` paths — root-level changes (docker-compose, Makefile) go untested

## Deferred from: code review of story 2-3-in-scene-action-popup (2026-04-16)

- Popup is inert if its todo is removed from `useTodos` while `activePopupTodoId` is still set — `ActionPopup` unmounts but store state lingers; low-probability multi-tab/external-mutation edge case
- No ARIA dialog semantics or focus management on the popup — screen readers get unannotated buttons; no focus trap; accessibility pass best done after scope is locked
- SVG callout line does not re-enable `pointer-events` — clicks that land on the diagonal pass through to the canvas and close the popup via the water-click path; low-probability click target

## Deferred from: code review of story 2-4-completion-via-popup-green-flash-and-dissolve (2026-04-17)

- `padUniforms.uColor` captured once at LilyPad mount; doesn't react to `todo.color` changes (pre-existing, exposed by this diff) — Story 4.1 (popup color-swatch) will need to wire color-change through the shader uniform
- Clicking Complete on a pad still in `forming`/`dropping`/`settling`/`pulsing` silently delays the flash up to ~2.1s — pad eventually transitions correctly, but UX polish is needed to either fast-forward the drop or disable Complete until `resting`
- Tab-backgrounded or computer-sleep mid-sequence collapses the 1.6s animation to an instant jump on resume — rare edge case; fix would detect large R3F clock delta and snap to terminal state without firing `triggerRipple`
- useFrame-driven completion-sequence tests — need a `useFrame` invoker mock with controllable clock advancement to assert flash color, ripple-fired-once, finishCompletion at t=1.60s, and terminal `'completed'` phase. Scaffolding is non-trivial; deferred from story 2.4 code review

## Deferred from: code review of story 2-5-deletion-via-popup-red-flash-and-dissolve (2026-04-17)

- Tab backgrounded / computer sleep mid-deletion-sequence collapses the 1.6s animation to an instant jump on resume (inherited from 2.4 — same fix applies to both completion and deletion paths; detect large R3F clock delta and snap to terminal state)
- Clicking Delete on a pad still in `forming`/`dropping`/`settling`/`pulsing` phase silently delays the deletion sequence up to ~2.1s while the pad finishes its drop (inherited from 2.4 — either widen the transition guard to accept any non-terminal phase, or block `handlePadClick` until `resting`)
- `uDropCenter` ripple-uniform collision in `WaterSurface.tsx` — two rapid pad actions share a single ripple slot; story 2.5 aggravates frequency (both Complete and Delete fire through the popup) but the single-slot limit dates from story 1.2. Consider a short ripple queue or multiple uniform slots
- Camera focus mid-lerp cut-off — when the user clicks Delete before `PondCamera`'s focus-zoom lerp completes (before `ARRIVE_THRESHOLD=0.1`), `closePopup()` nulls `cameraFocus` and the camera stops at a random intermediate position. Pre-existing consequence of the spec's camera-restore drop in 2.3/2.4/2.5 — accepted, but worth re-visiting if UX complains
