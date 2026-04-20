# Deferred Work

A log of code-review findings that were real but deliberately not fixed in the story that surfaced them. This is **a log, not a queue** — items sit here until a real signal (a bug, a perf regression, a related story's scope) pulls them into action.

## Status markers

Every item carries a leading status marker:

- `[OPEN]` — not yet acted on; default state for new entries.
- `[FIXED <sha>]` — resolved in a commit. The short SHA lets you `git show <sha>` for the actual diff.
- `[PROMOTED → <story-key>]` — graduated into a real story with its own ACs / scope. See `sprint-status.yaml` for the story's current status.
- `[RETIRED]` — no longer applicable (refactored away, upstream fix, product decision). Leave the bullet in place with a one-line reason so future readers don't re-raise it.

## Review cadence

Triage happens at two points:

1. **At `create-story` time for a new story** — grep this file for items in the new story's area; decide whether to absorb them, promote them to their own story, or leave as open. Ideally the `bmad-create-story` workflow prompts for this step.
2. **At epic retrospectives (`bmad-retrospective`)** — sweep every `[OPEN]` item from this epic's stories: mark `[RETIRED]` if no longer relevant, `[PROMOTED → X-Y]` if it deserves its own story, or leave `[OPEN]` with a short reason.

If this file grows faster than it drains, something's wrong with the process, not the code.

---

## Deferred from: code review of story 5-2-hybrid-search-api (2026-04-20)

- `[OPEN]` No search-path-specific HTTP timeout. Query embedding inherits 5.1's 15 s `HttpOptions.timeout`, so a slow-but-not-erroring Google API can pin a search request at ~15 s against a 300 ms UX budget. Fix: per-call `HttpOptions(timeout=1500)` on the search path, OR wrap `generate_embedding(q)` in `concurrent.futures.ThreadPoolExecutor.submit(...).result(timeout=1.5)` with timeout treated as fallback trigger. Story 5.2 Dev Notes § "Out of scope" already calls this out. (src/services/search_service.py:55-70)
- `[OPEN]` Double round-trip per side: one SQL to rank IDs, one ORM query to hydrate. 4 DB round-trips per search request. Spec's preferred pattern, but worth collapsing into one `SELECT * FROM todos ... + scoring_expr` if profiling shows search latency matters. (src/services/search_service.py:95-116, 127-156)
- `[OPEN]` Per-side `MAX_CANDIDATES_PER_SIDE = 50` hides dual-signal matches at scale. A todo ranked #60 in BOTH FTS and vector would merge to a high hybrid score but is excluded from both pools. Harmless at ≤ a few hundred active todos. Fix: lift the per-side cap OR implement a "bridge" second query that pulls in high-hybrid candidates missing from either pool. (src/services/search_service.py:44, 98, 137)
- `[OPEN]` Empty-tsquery signal missing. `websearch_to_tsquery` returns an empty tsquery for stop-words-only, emoji-only, non-English, or punctuation-only queries. The client can't distinguish "no matches" from "your query was unsupported by FTS." Fix: add a `tsquery_supported: false` flag to `SearchResponse` when the tsquery lexemes are empty. (src/services/search_service.py:86-99)
- `[OPEN]` `?q=a&q=b` silently last-wins. FastAPI drops all but the final value on a scalar `str` param with no 422 or warning. Cosmetic but surprising when a proxy duplicates the param. Fix: detect duplicate `q` values in the request and 422. (src/api/search.py)
- `[OPEN]` `SearchResponse.query` returns the server-stripped value, not the raw client input. A UI that echoes `response.query` to display "results for X" will disagree with the user's typed text by up to the trimmed whitespace. Fix: echo raw input in `query`; retain the stripped form only internally. (src/services/search_service.py:52, 75-79)
- `[OPEN]` `_seed_todo` test helper bypasses the embedding-worker pipeline invariants — sets `embedding` + `embedding_status` atomically on the ORM without going through `embedding_worker._run_embedding_worker`. Harmless today, but if the worker later adds post-write invariants (e.g., `updated_at` bump logic) these fixtures drift and the drift is invisible until a real production bug surfaces. Fix in a test-hygiene sweep: spin up a real worker call in a helper that mirrors the production path. (tests/services/test_search_service.py:23-40, tests/api/test_search.py:17-34)

## Deferred from: code review of story 5-1-backend-embedding-pipeline (2026-04-20)

- `[OPEN]` PATCH on `text` doesn't reset `embedding_status` or re-enqueue an embedding. `TodoUpdate.text` is writable in the schema, so edited todos have stale embeddings forever. Dev Notes § "What about re-embedding on text update?" explicitly scoped this out of 5.1. Fix: in `todo_service.update_todo`, detect `text` change, set `embedding_status='pending'`, call `enqueue_embedding(todo.id)`. (src/services/todo_service.py:58-68, src/schemas/todo.py:14-19)
- `[OPEN]` No reaper for stuck `pending` rows. If the process SIGKILLs mid-retry, the row stays at `pending` with no embedding and is never re-scanned on startup. Dev Notes § "Soft-state resume on restart" marks this out of scope. Fix: a scheduled job or startup scan that re-enqueues `WHERE embedding_status='pending' AND created_at < now() - interval '5 minutes'`. (src/workers/embedding_worker.py, no startup scan)
- `[OPEN]` No startup validation of `embedding_model` setting. Empty/whitespace/typo'd model name passes pydantic and fails at the Google API every time, burning 3 retries × N todos before operators notice. Fix: reject empty/whitespace `embedding_model` at `Settings` load time (pydantic validator) or log a WARNING in the lifespan startup. (src/config.py:7, src/main.py:22-33)
- `[OPEN]` No optimistic-lock / `version_id_col` on `Todo`. The embedding worker and a concurrent user PATCH can both write to the same row; SQLAlchemy is last-writer-wins with no version check. A concurrent PATCH changing `color` while the worker is mid-write could lose the color change (or overwrite the embedding). Architectural concern, not a 5.1 issue. Fix: add `version_id_col` to `Todo` model + `__mapper_args__ = {"version_id_col": ...}`. (src/models/todo.py:21-75)
- `[OPEN]` Whitespace-only text (`"   "`, `"\n\t"`) passes `TodoCreate.text` `min_length=1` and reaches the Google API. Either fails 3x or returns a near-zero vector that's useless for search. Fix: `text.strip()` check in `TodoCreate` validator, reject if empty after strip. (src/schemas/todo.py:8)

## Deferred from: code review of story 1-1-project-scaffolding-and-infrastructure (2026-04-15)

- `[OPEN]` `google_api_key` defaults to empty string with no startup validation — will cause opaque errors when embedding feature is implemented (Story 5.1). *Partially addressed in 5.1: a WARNING is logged at startup; the strict-rejection variant is still open.*
- `[OPEN]` No authentication or authorization on any API endpoint — unauthenticated write access could trigger unbounded embedding generation/billing
- `[OPEN]` Soft delete not enforced at query layer — no base filter excludes deleted/archived rows; must be added in service layer (Story 2.1)
- `[OPEN]` CI backend workflow does not run `alembic upgrade head` before tests — will break when DB integration tests are added
- `[OPEN]` `embedding_status` column is unconstrained String(20) — no DB check constraint for valid values (pending/complete/failed)
- `[OPEN]` `Creature.todo_id` FK lacks `ondelete` clause — orphaned creatures possible on hard delete; should be SET NULL
- `[OPEN]` `color` field accepts any 7-char string, not just valid hex colors — no check constraint
- `[OPEN]` `updated_at` uses ORM-level `onupdate` only — raw SQL updates won't trigger it; consider DB trigger
- `[OPEN]` `database_url` accepted without format validation — malformed URLs cause unhelpful startup crashes
- `[OPEN]` `archive_threshold_days` accepts zero or negative values — no bounds validation
- `[OPEN]` Frontend `VITE_API_URL=/api` is a relative path that only works with Vite dev proxy, not production deployments
- `[OPEN]` CI workflows only trigger on `backend/**` and `frontend/**` paths — root-level changes (docker-compose, Makefile) go untested

## Deferred from: code review of story 2-3-in-scene-action-popup (2026-04-16)

- `[OPEN]` Popup is inert if its todo is removed from `useTodos` while `activePopupTodoId` is still set — `ActionPopup` unmounts but store state lingers; low-probability multi-tab/external-mutation edge case
- `[OPEN]` No ARIA dialog semantics or focus management on the popup — screen readers get unannotated buttons; no focus trap; accessibility pass best done after scope is locked
- `[OPEN]` SVG callout line does not re-enable `pointer-events` — clicks that land on the diagonal pass through to the canvas and close the popup via the water-click path; low-probability click target

## Deferred from: code review of story 2-4-completion-via-popup-green-flash-and-dissolve (2026-04-17)

- `[OPEN]` `padUniforms.uColor` captured once at LilyPad mount; doesn't react to `todo.color` changes (pre-existing, exposed by this diff) — Story 4.1 (popup color-swatch) will need to wire color-change through the shader uniform
- `[OPEN]` Clicking Complete on a pad still in `forming`/`dropping`/`settling`/`pulsing` silently delays the flash up to ~2.1s — pad eventually transitions correctly, but UX polish is needed to either fast-forward the drop or disable Complete until `resting`
- `[OPEN]` Tab-backgrounded or computer-sleep mid-sequence collapses the 1.6s animation to an instant jump on resume — rare edge case; fix would detect large R3F clock delta and snap to terminal state without firing `triggerRipple`
- `[OPEN]` useFrame-driven completion-sequence tests — need a `useFrame` invoker mock with controllable clock advancement to assert flash color, ripple-fired-once, finishCompletion at t=1.60s, and terminal `'completed'` phase. Scaffolding is non-trivial; deferred from story 2.4 code review

## Deferred from: code review of story 2-6-loading-and-error-states (2026-04-17)

- `[OPEN]` Click ripple wavefront speed mismatches shader phase velocity — `speed/freq = 5.5/1.3 ≈ 4.23` but hardcoded `wavefrontSpeed = 7.0`; leading edge races ahead of the real wave (WaterSurface.tsx, ripple feature)
- `[OPEN]` `triggerRipple` single-slot zustand state coalesces simultaneous writes between useFrame ticks — two triggers same frame collapse to one (usePondStore.ts + WaterSurface.tsx, ripple feature; also noted in 2.5 deferred)
- `[OPEN]` Water ripple fires during popup-open without closing the popup — `handleWaterClick` has no popup-state guard (WaterSurface.tsx, ripple feature)
- `[OPEN]` Ambient ripple slot overwrite can evict an in-flight ripple when cadence runs faster than shader decay (3 slots × up to ~14s visibility vs. 2.5–7s schedule) (WaterSurface.tsx, ripple feature)
- `[OPEN]` `useCreateCreature` POST has no idempotency key — retries could create duplicate creatures if first response is lost (frontend/src/api/creatureApi.ts + backend)
- `[OPEN]` `stampedAt` field on `TodoErrorEntry` is written via `performance.now()` but never read (usePondStore.ts, harmless)
- `[OPEN]` `useDeleteCreature` hook kept as dead-but-harmless code with no cleanup plan (frontend/src/api/creatureApi.ts, pre-existing)
- `[OPEN]` Decay-on-`todo.completed` branch in LilyPad is dead code while backend excludes completed todos from `list_todos` — resolution depends on backend-scope decision from the same review (LilyPad.tsx)
- `[OPEN]` `renderTodos` ordering places completing/deleting extras after live todos, so during initial-load-with-pending-mutation stagger index doesn't match visual position (PondScene.tsx:63-80)
- `[OPEN]` `uDropCenter` mirrored-Z fix may have inverted any other caller of `triggerRipple(x, z)` that treated z as local-Y (WaterSurface.tsx, ripple feature)
- `[OPEN]` `AMBIENT_WAVEFRONT_SPEED` injected via template literal into GLSL — fragile string-template idiom vs. `uniform float` (WaterSurface.tsx, ripple feature)
- `[OPEN]` `dropRipple.time` uses `performance.now()/1000` (wall clock) while shader uniforms use R3F `elapsedTime` — two-clock mixing latent bug (usePondStore.ts + WaterSurface.tsx, ripple feature)
- `[OPEN]` Click ripple slot round-robin can evict in-flight ripples above ~2Hz click rate (8 slots × ~4s visibility) (WaterSurface.tsx, ripple feature)
- `[OPEN]` Ambient-ripple 20% skip-probability applies to the first ripple too — pond can look frozen on load in pathological RNG sequences (WaterSurface.tsx, ripple feature)
- `[OPEN]` Ambient scheduler `setTimeout` cleanup does not clear a pending `pendingAmbientRef` on unmount — ghost ripple possible on StrictMode remount (WaterSurface.tsx, ripple feature)
- `[OPEN]` No `useTodos` error-state handling — persistent query failure shows `EmptyPondHint` ("create a todo") and misreads as empty state; spec doesn't prescribe failed-initial-load UI (PondScene.tsx, warrants a follow-up story)
- `[OPEN]` `finishDeletion` fires alongside `finishCompletion` at `COMPLETING_TOTAL` — cross-idempotent clear is defensive today but a footgun for adversarial inputs (LilyPad.tsx, pre-existing from 2.4/2.5)
- `[OPEN]` `useEffect([], ...)` in LilyPad reads closure-captured `posX`/`posZ`/`rotationY` — latent bug when positions become mutable (Story 4.3 position-persistence; pre-existing, no trigger today)

## Deferred from: code review of story 2-5-deletion-via-popup-red-flash-and-dissolve (2026-04-17)

- `[OPEN]` Tab backgrounded / computer sleep mid-deletion-sequence collapses the 1.6s animation to an instant jump on resume (inherited from 2.4 — same fix applies to both completion and deletion paths; detect large R3F clock delta and snap to terminal state)
- `[OPEN]` Clicking Delete on a pad still in `forming`/`dropping`/`settling`/`pulsing` phase silently delays the deletion sequence up to ~2.1s while the pad finishes its drop (inherited from 2.4 — either widen the transition guard to accept any non-terminal phase, or block `handlePadClick` until `resting`)
- `[OPEN]` `uDropCenter` ripple-uniform collision in `WaterSurface.tsx` — two rapid pad actions share a single ripple slot; story 2.5 aggravates frequency (both Complete and Delete fire through the popup) but the single-slot limit dates from story 1.2. Consider a short ripple queue or multiple uniform slots
- `[OPEN]` Camera focus mid-lerp cut-off — when the user clicks Delete before `PondCamera`'s focus-zoom lerp completes (before `ARRIVE_THRESHOLD=0.1`), `closePopup()` nulls `cameraFocus` and the camera stops at a random intermediate position. Pre-existing consequence of the spec's camera-restore drop in 2.3/2.4/2.5 — accepted, but worth re-visiting if UX complains

## Deferred from: code review of story 4-1-popup-color-swatch-neon-selector (2026-04-20)

- `[OPEN]` `onCommitColor` / `onPreviewColor` inline arrows in `PondScene.tsx` → new identity each PondScene render → ActionPopup's `useEffect([previewColor, onPreviewColor])` re-fires on every ambient store update while the popup is open. Store's no-op guard prevents cascading re-renders but the effect firing pointlessly is wasteful. Fix: `useCallback` the arrows in PondScene, OR strip `onPreviewColor` from the effect's deps (capture via ref). (PondScene.tsx:171-183, ActionPopup.tsx:77-79)
- `[OPEN]` `setColorPreview`'s strict-equality no-op guard is case-sensitive (`current.get(todoId) === color`). All palette hexes are lowercased at module scope, so this can't fire today — logged for future robustness if external callers pass uppercase hex. (usePondStore.ts:297)
- `[OPEN]` `aria-pressed` / "current" ring compares ONLY to `committedColor`, not to `previewColor ?? committedColor`. While hovering swatch A the pad lerps toward A but A is NOT ringed. Reasonable either way ("ring = your saved choice"); revisit if accessibility feedback surfaces. (PopupColorSwatch.tsx:73)

## Deferred from: code review of story 2-10-lily-pads-float-on-water (2026-04-20)

- `[OPEN]` Pad-tilt gradient is evaluated outside the visible pond edge at extreme `posX`/`posZ`. `sampleElevation` has no bounds — samples at `(posX ± 0.35, posZ ± 0.35)` return valid elevation even if the fragment shader's `edgeFade` has faded the water to black at that point. Pads within `TILT_DELTA` of the 20-unit pond edge tilt toward invisible "phantom water." Fix would duplicate the fragment-shader fade in the sampler. (waterElevation.ts sampling, LilyPad.tsx resting tilt block)
- `[OPEN]` Frame-ordering invariant between `WaterSurface.useFrame` (refreshes buffer after drain) and `LilyPad.useFrame` (reads buffer) is not asserted. Currently stable because `<WaterSurface />` is rendered before `renderTodos.map` in `PondScene`, so R3F subscribes WaterSurface's tick first. If anyone reorders the JSX or sets a `priority` on either, LilyPads would silently read a 1-frame-stale buffer. Fix: add explicit `priority` props on both `useFrame` calls, OR assertion in dev mode. (WaterSurface.tsx:330, LilyPad.tsx:548)
- `[OPEN]` Splash term has no leading-edge gating — its Gaussian contributes non-zero elevation at pads far from the impact center BEFORE the wavefront arrives. At dropDist=2, `exp(-3.2) ≈ 0.04` × amp × 1.2 = ~0.034 world units at t=0, while the real wavefront takes ~0.47s to reach. Matches shader parity (acceptable today); if "pre-bob" ever becomes a reported UX issue, add a leading-edge mask to the splash in BOTH shader and TS sampler. (waterElevation.ts splash block, WaterSurface.tsx shader splash)

## Deferred from: code review of story 2-9-ripple-system-hardening (2026-04-20)

- `[OPEN]` `drainRipples` uses absolute `set({ dropRipples: [] })` instead of `set((s) => ({ dropRipples: s.dropRipples.slice(queued.length) }))` — theoretical race if a synchronous reentrancy enqueues during the drain loop. No user-visible impact today (drain loop only writes to uniforms, no callbacks to reenter), but the defensive form makes the invariant robust to future refactors. (usePondStore.ts:142, WaterSurface.tsx:311-328)
- `[OPEN]` Ambient scheduler's `setTimeout` callback can complete after cleanup if it's mid-flight at unmount — the re-armed timer then writes to a null `pendingAmbientRef.current` on a dead instance (no-op today). Real leak if anyone migrates to a shared/module-scope ref. Add an `unmounted` flag if that pattern emerges. (WaterSurface.tsx:370-393)
- `[OPEN]` Unbounded `dropRipples` queue growth during `useFrame` early-return windows (initial ref-attach, WebGL context loss). If GPU context is lost between `triggerRipple` calls and the next drain, the queue grows until restoration, then drains all at once with the same `elapsedTime` — visible as a "burst" of same-time ripples. Fix: cap the queue at `CLICK_SLOTS * 2` in `triggerRipple`, drop oldest. Worth adding if context-loss recovery becomes a real use case (integrated/discrete GPU switching laptops). (WaterSurface.tsx:296-300)
- `[OPEN]` Shader `wavefrontOverride > 0.0` sentinel doesn't guard against `freq <= 0.0` in the derived path — a future edit to `freq=0.0` would produce `Infinity` wavefront and collapse the ripple into a planar oscillation. Not a bug today (click uses `freq=1.3`). A comment on the `ripple()` function signature or a `max(freq, 1e-6)` clamp would preempt this. (WaterSurface.tsx:113-125)

## Deferred from: code review of story 2-8-pad-action-glow-on-water (2026-04-20)

- `[OPEN]` `document.querySelector('canvas')` in `ActionPopup.onWheel` is brittle if a second canvas is ever added — should use a passed ref or R3F context (ActionPopup.tsx:~91)
- `[OPEN]` `focusFlashStartRef` is read by both the rim block and the glow block in the same `useFrame` call — ordering coupling creates a maintenance hazard if blocks are refactored or extracted (LilyPad.tsx:~948,~1027)
- `[OPEN]` Pulse→resting strength handoff depends on numeric coincidence `AMBIENT_GLOW_STRENGTH === FOCUSED_GLOW_STRENGTH === 0.22` — pulse ends at 0.22 and the next resting frame also writes 0.22 regardless of `focused`, but if either constant is tuned independently a step-change will appear at pulse-end. Add a coupling comment or lerp-on-first-frame if constants diverge. (LilyPad.tsx:119, 125, 1137-1139)

## Deferred from: code review of story 2-7-pulse-on-flash-polish (2026-04-17)

- `[OPEN]` `prefers-reduced-motion` not honored by scale pulses, rim glows, body tint, or focus flash in LilyPad.tsx — project-wide accessibility gap, not a 2.7 regression. Warrants a dedicated a11y sweep.
- `[OPEN]` Popup has no keyboard handling — no focus trap, no Escape-to-close, no `role="dialog"`/`aria-modal`; Tab falls through to canvas. Predates 2.7 (ActionPopup shipped in 2.3; already noted in 2-3 deferred list). Warrants a popup-a11y story.
- `[OPEN]` Pre-existing React-strict runtime errors surfaced while reviewing 2.7 but NOT caused by the 2.7 diff: `PondCamera.tsx:108` mutates `camera.position` (hook-returned value); `PondScene.tsx:147` reads a ref during render. Belong in a React-strict-compliance sweep across the frontend — distinct from the LilyPad.tsx:354 variant that IS in 2.7's patch list.
</content>
</invoke>