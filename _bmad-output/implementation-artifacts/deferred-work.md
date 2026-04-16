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
