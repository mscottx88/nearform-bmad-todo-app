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

## Deferred from: code review of story 2-6-loading-and-error-states (2026-04-17)

- Click ripple wavefront speed mismatches shader phase velocity — `speed/freq = 5.5/1.3 ≈ 4.23` but hardcoded `wavefrontSpeed = 7.0`; leading edge races ahead of the real wave (WaterSurface.tsx, ripple feature)
- `triggerRipple` single-slot zustand state coalesces simultaneous writes between useFrame ticks — two triggers same frame collapse to one (usePondStore.ts + WaterSurface.tsx, ripple feature; also noted in 2.5 deferred)
- Water ripple fires during popup-open without closing the popup — `handleWaterClick` has no popup-state guard (WaterSurface.tsx, ripple feature)
- Ambient ripple slot overwrite can evict an in-flight ripple when cadence runs faster than shader decay (3 slots × up to ~14s visibility vs. 2.5–7s schedule) (WaterSurface.tsx, ripple feature)
- `useCreateCreature` POST has no idempotency key — retries could create duplicate creatures if first response is lost (frontend/src/api/creatureApi.ts + backend)
- `stampedAt` field on `TodoErrorEntry` is written via `performance.now()` but never read (usePondStore.ts, harmless)
- `useDeleteCreature` hook kept as dead-but-harmless code with no cleanup plan (frontend/src/api/creatureApi.ts, pre-existing)
- Decay-on-`todo.completed` branch in LilyPad is dead code while backend excludes completed todos from `list_todos` — resolution depends on backend-scope decision from the same review (LilyPad.tsx)
- `renderTodos` ordering places completing/deleting extras after live todos, so during initial-load-with-pending-mutation stagger index doesn't match visual position (PondScene.tsx:63-80)
- `uDropCenter` mirrored-Z fix may have inverted any other caller of `triggerRipple(x, z)` that treated z as local-Y (WaterSurface.tsx, ripple feature)
- `AMBIENT_WAVEFRONT_SPEED` injected via template literal into GLSL — fragile string-template idiom vs. `uniform float` (WaterSurface.tsx, ripple feature)
- `dropRipple.time` uses `performance.now()/1000` (wall clock) while shader uniforms use R3F `elapsedTime` — two-clock mixing latent bug (usePondStore.ts + WaterSurface.tsx, ripple feature)
- Click ripple slot round-robin can evict in-flight ripples above ~2Hz click rate (8 slots × ~4s visibility) (WaterSurface.tsx, ripple feature)
- Ambient-ripple 20% skip-probability applies to the first ripple too — pond can look frozen on load in pathological RNG sequences (WaterSurface.tsx, ripple feature)
- Ambient scheduler `setTimeout` cleanup does not clear a pending `pendingAmbientRef` on unmount — ghost ripple possible on StrictMode remount (WaterSurface.tsx, ripple feature)
- No `useTodos` error-state handling — persistent query failure shows `EmptyPondHint` ("create a todo") and misreads as empty state; spec doesn't prescribe failed-initial-load UI (PondScene.tsx, warrants a follow-up story)
- `finishDeletion` fires alongside `finishCompletion` at `COMPLETING_TOTAL` — cross-idempotent clear is defensive today but a footgun for adversarial inputs (LilyPad.tsx, pre-existing from 2.4/2.5)
- `useEffect([], ...)` in LilyPad reads closure-captured `posX`/`posZ`/`rotationY` — latent bug when positions become mutable (Story 4.3 position-persistence; pre-existing, no trigger today)

## Deferred from: code review of story 2-5-deletion-via-popup-red-flash-and-dissolve (2026-04-17)

- Tab backgrounded / computer sleep mid-deletion-sequence collapses the 1.6s animation to an instant jump on resume (inherited from 2.4 — same fix applies to both completion and deletion paths; detect large R3F clock delta and snap to terminal state)
- Clicking Delete on a pad still in `forming`/`dropping`/`settling`/`pulsing` phase silently delays the deletion sequence up to ~2.1s while the pad finishes its drop (inherited from 2.4 — either widen the transition guard to accept any non-terminal phase, or block `handlePadClick` until `resting`)
- `uDropCenter` ripple-uniform collision in `WaterSurface.tsx` — two rapid pad actions share a single ripple slot; story 2.5 aggravates frequency (both Complete and Delete fire through the popup) but the single-slot limit dates from story 1.2. Consider a short ripple queue or multiple uniform slots
- Camera focus mid-lerp cut-off — when the user clicks Delete before `PondCamera`'s focus-zoom lerp completes (before `ARRIVE_THRESHOLD=0.1`), `closePopup()` nulls `cameraFocus` and the camera stops at a random intermediate position. Pre-existing consequence of the spec's camera-restore drop in 2.3/2.4/2.5 — accepted, but worth re-visiting if UX complains

## Deferred from: code review of story 2-7-pulse-on-flash-polish (2026-04-17)

- `prefers-reduced-motion` not honored by scale pulses, rim glows, body tint, or focus flash in LilyPad.tsx — project-wide accessibility gap, not a 2.7 regression. Warrants a dedicated a11y sweep.
- Popup has no keyboard handling — no focus trap, no Escape-to-close, no `role="dialog"`/`aria-modal`; Tab falls through to canvas. Predates 2.7 (ActionPopup shipped in 2.3; already noted in 2-3 deferred list). Warrants a popup-a11y story.
- Pre-existing React-strict runtime errors surfaced while reviewing 2.7 but NOT caused by the 2.7 diff: `PondCamera.tsx:108` mutates `camera.position` (hook-returned value); `PondScene.tsx:147` reads a ref during render. Belong in a React-strict-compliance sweep across the frontend — distinct from the LilyPad.tsx:354 variant that IS in 2.7's patch list.
