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

## Deferred from: code review of story 5-3-type-anywhere-search-with-surface-submerge (2026-04-21)

- `[OPEN]` IME / non-Latin composition input dropped by `e.key.length === 1`. Japanese/Chinese/Korean commit events arrive with multi-char strings; emoji are surrogate-pair length-2; assistive tech often synthesises `"Unidentified"`. Search is effectively unusable for non-English users. Dev Notes § "Why no search-`<input>` element" already acknowledges this as a v1 English-UI limit. Fix: add `compositionstart`/`compositionend`/`input` fallback when i18n becomes real. (src/hooks/usePondSearchKeyboard.ts:61)
- `[FIXED pending-commit]` No guard against `usePondSearchKeyboard` being mounted twice. No code path does so today but HMR double-render briefly doubles listeners; any future split-pane feature would double every keystroke. Fix applied: module-scope `mountCount` sentinel in `usePondSearchKeyboard.ts`; second mount becomes a no-op and logs a dev warning. Cleanup decrements the counter so unmount/remount cycles work. (src/hooks/usePondSearchKeyboard.ts)
- `[OPEN]` In-flight axios search request is not cancelled on `clearSearch`. After the Phase-1 patch that gates `applySearchResponse` on `searchActive`, the late response is safely ignored but the network call still completes. Wire an `AbortController` through `searchApi.ts` to cancel on Escape. (src/api/searchApi.ts, src/hooks/usePondSearchSync.ts)
- `[OPEN]` LilyPad re-renders every pad on every search response because `selectSearchHit` returns a fresh `SearchHit` object per response. Per-pad subscription claim in comments is not actually narrow. Optimise with `useShallow` / cached hit-by-id when pad count crosses ~50 or perf profiling flags it. (src/components/pond/LilyPad.tsx, src/stores/usePondStore.ts)
- `[FIXED pending-commit]` Search captures keystrokes when TodoInput is open but focus has drifted to body. `e.target.tagName === 'INPUT'` only catches in-focus inputs; user clicking outside an open TodoInput ends up with keystrokes landing on the search overlay. Fix applied: guard now checks both `e.target` and `document.activeElement` via a shared `isEditableElement` helper. (src/hooks/usePondSearchKeyboard.ts)
- `[OPEN]` No LilyPad `useFrame` search-mode unit test. The "skip search during completing/deleting" phase guard is only structural — the code happens to live inside the `resting` branch — so a future refactor could silently regress it. Testing Standards explicitly forbids full-canvas R3F tests in jsdom; add when the Test Architect module provides canvas mocks.
- `[FIXED pending-commit]` `_fts_supported` has no try/except — a transient Postgres hiccup (tsquery locale drift, extension missing, etc.) kills the whole search instead of letting the embedding/vector branch carry on. Fix applied: wrapped the `numnode()` SQL in `try/except Exception`, rolls back the session, logs `search_fts_supported_failed`, and returns `False` so the search proceeds with the vector branch only. Regression test `test_hybrid_search_fts_supported_falls_back_to_false_on_db_error` asserts no propagation + `fts_supported=False`. (backend/src/services/search_service.py § `_fts_supported`)

## Deferred from: code review of story 5-2-hybrid-search-api (2026-04-20)

- `[FIXED 4b5b4e8]` No search-path-specific HTTP timeout. Query embedding inherits 5.1's 15 s `HttpOptions.timeout`, so a slow-but-not-erroring Google API can pin a search request at ~15 s against a 300 ms UX budget. Fix: per-call `HttpOptions(timeout=1500)` on the search path, OR wrap `generate_embedding(q)` in `concurrent.futures.ThreadPoolExecutor.submit(...).result(timeout=1.5)` with timeout treated as fallback trigger. Story 5.2 Dev Notes § "Out of scope" already calls this out. (src/services/search_service.py:55-70)
- `[RETIRED]` Double round-trip per side: one SQL to rank IDs, one ORM query to hydrate. 4 DB round-trips per search request. Spec's preferred pattern, but worth collapsing into one `SELECT * FROM todos ... + scoring_expr` if profiling shows search latency matters. *Retired: speculative optimisation; reopen only if search latency profile shows DB round-trips dominate.*
- `[RETIRED]` Per-side `MAX_CANDIDATES_PER_SIDE = 50` hides dual-signal matches at scale. A todo ranked #60 in BOTH FTS and vector would merge to a high hybrid score but is excluded from both pools. Harmless at ≤ a few hundred active todos. *Retired: scale-contingent; reopen when corpus exceeds ~500 active todos.*
- `[FIXED 8e5a910]` Empty-tsquery signal missing. Fix: added `fts_supported: bool` to `SearchResponse`; a `_fts_supported(db, q)` helper uses Postgres `numnode()` to detect zero-node tsqueries up-front and skips the FTS SQL.
- `[FIXED 4b5b4e8]` `?q=a&q=b` silently last-wins. FastAPI drops all but the final value on a scalar `str` param with no 422 or warning. Cosmetic but surprising when a proxy duplicates the param. Fix: detect duplicate `q` values in the request and 422. (src/api/search.py)
- `[FIXED 8e5a910]` `SearchResponse.query` returns the server-stripped value, not the raw client input. Fix: `hybrid_search` now echoes the raw `query_text` in the response.
- `[RETIRED]` `_seed_todo` test helper bypasses the embedding-worker pipeline invariants — sets `embedding` + `embedding_status` atomically on the ORM without going through `embedding_worker._run_embedding_worker`. Harmless today. *Retired: speculative; reopen when the worker adds post-write invariants that tests fail to replicate.*

## Deferred from: code review of story 5-1-backend-embedding-pipeline (2026-04-20)

- `[PROMOTED → 5.4]` PATCH on `text` doesn't reset `embedding_status` or re-enqueue an embedding. `TodoUpdate.text` is writable in the schema, so edited todos have stale embeddings forever. Dev Notes § "What about re-embedding on text update?" explicitly scoped this out of 5.1. Fix: in `todo_service.update_todo`, detect `text` change, set `embedding_status='pending'`, call `enqueue_embedding(todo.id)`. (src/services/todo_service.py:58-68, src/schemas/todo.py:14-19)
- `[PROMOTED → 5.5]` No reaper for stuck `pending` rows. If the process SIGKILLs mid-retry, the row stays at `pending` with no embedding and is never re-scanned on startup. Dev Notes § "Soft-state resume on restart" marks this out of scope. Fix: a scheduled job or startup scan that re-enqueues `WHERE embedding_status='pending' AND created_at < now() - interval '5 minutes'`. (src/workers/embedding_worker.py, no startup scan)
- `[FIXED 4b5b4e8]` No startup validation of `embedding_model` setting. Empty/whitespace/typo'd model name passes pydantic and fails at the Google API every time, burning 3 retries × N todos before operators notice. Fix: reject empty/whitespace `embedding_model` at `Settings` load time (pydantic validator) or log a WARNING in the lifespan startup. (src/config.py:7, src/main.py:22-33)
- `[OPEN]` No optimistic-lock / `version_id_col` on `Todo`. The embedding worker and a concurrent user PATCH can both write to the same row; SQLAlchemy is last-writer-wins with no version check. A concurrent PATCH changing `color` while the worker is mid-write could lose the color change (or overwrite the embedding). Architectural concern, not a 5.1 issue. Fix: add `version_id_col` to `Todo` model + `__mapper_args__ = {"version_id_col": ...}`. (src/models/todo.py:21-75)
- `[FIXED 4b5b4e8]` Whitespace-only text (`"   "`, `"\n\t"`) passes `TodoCreate.text` `min_length=1` and reaches the Google API. Either fails 3x or returns a near-zero vector that's useless for search. Fix: `text.strip()` check in `TodoCreate` validator, reject if empty after strip. (src/schemas/todo.py:8)

## Deferred from: code review of story 1-1-project-scaffolding-and-infrastructure (2026-04-15)

- `[FIXED pending-commit]` `google_api_key` defaults to empty string with no startup validation — will cause opaque errors when embedding feature is implemented (Story 5.1). *Originally partially addressed in 5.1: a WARNING is logged at startup.* Fix applied: `Settings._validate_google_api_key` rejects whitespace-only values (which are truthy enough to bypass the `if not settings.google_api_key` guards but always fail at the Google API). Empty string is still accepted as the explicit "run without embeddings" mode. 3 regression tests in `tests/test_config.py`. (backend/src/config.py)
- `[OPEN]` No authentication or authorization on any API endpoint — unauthenticated write access could trigger unbounded embedding generation/billing. *Retro-scope note: epic-sized; needs product/deployment discussion (single-user demo vs. multi-tenant) before a story can be shaped. Triggers promotion when the app is exposed beyond localhost OR when Google API billing becomes a real concern.*
- `[OPEN]` Soft delete not enforced at query layer — no base filter excludes deleted/archived rows; must be added in service layer (Story 2.1). *Retro-scope note: every service today already filters explicitly (`list_todos`, `_get_active_todo`, `hybrid_search._run_fts/_vector`). The risk is a NEW service forgetting. Promote when the second "forgot-to-filter" bug is caught in CR, OR as part of a backend-architecture refactor. Cheap preventive fix: a `Todo.active_query(db)` classmethod returning the filtered query builder; opt-in is still required, but discoverable.*
- `[FIXED bb05011]` CI backend workflow does not run `alembic upgrade head` before tests — will break when DB integration tests are added. Fix: ci-backend.yml now runs `uv run python -m alembic upgrade head` immediately before `pytest`.
- `[FIXED 8e5a910]` `embedding_status` column is unconstrained String(20) — no DB check constraint for valid values (pending/complete/failed). Fix: migration 3c3ff88ec089 added `ck_todos_embedding_status_values CHECK IN (...)`.
- `[FIXED 8e5a910]` `Creature.todo_id` FK lacks `ondelete` clause — orphaned creatures possible on hard delete. Fix: migration 3c3ff88ec089 replaced the FK with `ondelete='SET NULL'`.
- `[FIXED 8e5a910]` `color` field accepts any 7-char string — no check constraint. Fix: migration 3c3ff88ec089 added `ck_todos_color_hex` (regex `^#[0-9a-fA-F]{6}$`).
- `[OPEN]` `updated_at` uses ORM-level `onupdate` only — raw SQL updates won't trigger it; consider DB trigger
- `[FIXED 8e5a910]` `database_url` accepted without format validation — malformed URLs cause unhelpful startup crashes. Fix: `Settings._validate_database_url` rejects empty strings and inputs without `'://'`.
- `[FIXED 8e5a910]` `archive_threshold_days` accepts zero or negative values — no bounds validation. Fix: `Field(default=30, gt=0)`.
- `[RETIRED]` Frontend `VITE_API_URL=/api` is a relative path that only works with Vite dev proxy, not production deployments. *Retired: the frontend `apiClient` now hardcodes `baseURL: '/api'` by design (frontend/src/api/client.ts:5-11) — dev uses Vite's proxy, prod is assumed to serve frontend + backend behind a same-origin reverse proxy. Reopen only if a cross-origin deploy (e.g., `app.example.com` frontend + `api.example.com` backend) becomes a real target, which would require re-introducing an env var.*
- `[FIXED bb05011]` CI workflows only trigger on `backend/**` and `frontend/**` paths — root-level changes (docker-compose, Makefile) go untested. Fix: ci-backend.yml now also triggers on `docker-compose.yml`, `Makefile`, and the workflow file itself; ci-frontend.yml triggers on its own workflow file too.

## Deferred from: code review of story 2-3-in-scene-action-popup (2026-04-16)

- `[RETIRED]` Popup is inert if its todo is removed from `useTodos` while `activePopupTodoId` is still set — `ActionPopup` unmounts but store state lingers; low-probability multi-tab/external-mutation edge case. *Retired: multi-tab mutation isn't a supported workflow; reopen if multi-tab becomes a real scenario.*
- `[PROMOTED → 4.4]` No ARIA dialog semantics or focus management on the popup — screen readers get unannotated buttons; no focus trap; accessibility pass best done after scope is locked
- `[PROMOTED → 4.4]` SVG callout line does not re-enable `pointer-events` — clicks that land on the diagonal pass through to the canvas and close the popup via the water-click path; low-probability click target

## Deferred from: code review of story 2-4-completion-via-popup-green-flash-and-dissolve (2026-04-17)

- `[FIXED 43cbc4f]` `padUniforms.uColor` captured once at LilyPad mount; doesn't react to `todo.color` changes. Fix: Story 4.1 implementation wires a `useEffect([committedColor])` that writes `mat.uniforms.uColor.value` on every color change (LilyPad.tsx:464-494). Verified by grepping the file for the Story 4.1 reference comment.
- `[PROMOTED → 2.12]` Clicking Complete on a pad still in `forming`/`dropping`/`settling`/`pulsing` silently delays the flash up to ~2.1s — pad eventually transitions correctly, but UX polish is needed to either fast-forward the drop or disable Complete until `resting`
- `[RETIRED]` Tab-backgrounded or computer-sleep mid-sequence collapses the 1.6s animation to an instant jump on resume — rare edge case; fix would detect large R3F clock delta and snap to terminal state without firing `triggerRipple`. *Retired: transient and self-resolving (user sees correct terminal state); reopen if a user actually reports the jump as confusing.*
- `[RETIRED]` useFrame-driven completion-sequence tests — need a `useFrame` invoker mock with controllable clock advancement to assert flash color, ripple-fired-once, finishCompletion at t=1.60s, and terminal `'completed'` phase. Scaffolding is non-trivial; deferred from story 2.4 code review. *Retired: integration-test territory; reopen if a completion-sequence regression slips past the current test coverage.*

## Deferred from: code review of story 2-6-loading-and-error-states (2026-04-17)

- `[RETIRED]` Click ripple wavefront speed mismatches shader phase velocity — `speed/freq = 5.5/1.3 ≈ 4.23` but hardcoded `wavefrontSpeed = 7.0`; leading edge races ahead of the real wave (WaterSurface.tsx, ripple feature). *Retired: subsequent ripple-hardening work in 2.9 reworked these constants; reopen only if visual ripple-edge bugs surface.*
- `[PROMOTED → 2.11]` `triggerRipple` single-slot zustand state coalesces simultaneous writes between useFrame ticks — two triggers same frame collapse to one (usePondStore.ts + WaterSurface.tsx, ripple feature; also noted in 2.5 deferred)
- `[PROMOTED → 2.11]` Water ripple fires during popup-open without closing the popup — `handleWaterClick` has no popup-state guard (WaterSurface.tsx, ripple feature)
- `[PROMOTED → 2.11]` Ambient ripple slot overwrite can evict an in-flight ripple when cadence runs faster than shader decay (3 slots × up to ~14s visibility vs. 2.5–7s schedule) (WaterSurface.tsx, ripple feature)
- `[OPEN]` `useCreateCreature` POST has no idempotency key — retries could create duplicate creatures if first response is lost (frontend/src/api/creatureApi.ts + backend)
- `[RETIRED]` `stampedAt` field on `TodoErrorEntry` is written via `performance.now()` but never read (usePondStore.ts, harmless). *Retired: harmless dead data; keep for possible future stale-error eviction.*
- `[RETIRED]` `useDeleteCreature` hook kept as dead-but-harmless code with no cleanup plan. *Retired: dead-but-harmless; reopen if creature-deletion becomes a real product need.*
- `[RETIRED]` Decay-on-`todo.completed` branch in LilyPad is dead code while backend excludes completed todos from `list_todos`. *Retired: list_todos already filters completed; the branch is effectively unreachable.*
- `[RETIRED]` `renderTodos` ordering places completing/deleting extras after live todos, so during initial-load-with-pending-mutation stagger index doesn't match visual position (PondScene.tsx:63-80). *Retired: initial-load-with-pending-mutation is a vanishingly narrow window.*
- `[RETIRED]` `uDropCenter` mirrored-Z fix may have inverted any other caller of `triggerRipple(x, z)` that treated z as local-Y. *Retired: no other callers exist; reopen if a new ripple-trigger call site is added.*
- `[PROMOTED → 2.11]` `AMBIENT_WAVEFRONT_SPEED` injected via template literal into GLSL — fragile string-template idiom vs. `uniform float` (WaterSurface.tsx, ripple feature)
- `[PROMOTED → 2.11]` `dropRipple.time` uses `performance.now()/1000` (wall clock) while shader uniforms use R3F `elapsedTime` — two-clock mixing latent bug (usePondStore.ts + WaterSurface.tsx, ripple feature)
- `[PROMOTED → 2.11]` Click ripple slot round-robin can evict in-flight ripples above ~2Hz click rate (8 slots × ~4s visibility) (WaterSurface.tsx, ripple feature)
- `[PROMOTED → 2.11]` Ambient-ripple 20% skip-probability applies to the first ripple too — pond can look frozen on load in pathological RNG sequences (WaterSurface.tsx, ripple feature)
- `[PROMOTED → 2.11]` Ambient scheduler `setTimeout` cleanup does not clear a pending `pendingAmbientRef` on unmount — ghost ripple possible on StrictMode remount (WaterSurface.tsx, ripple feature)
- `[OPEN]` No `useTodos` error-state handling — persistent query failure shows `EmptyPondHint` ("create a todo") and misreads as empty state; spec doesn't prescribe failed-initial-load UI (PondScene.tsx, warrants a follow-up story)
- `[PROMOTED → 2.12]` `finishDeletion` fires alongside `finishCompletion` at `COMPLETING_TOTAL` — cross-idempotent clear is defensive today but a footgun for adversarial inputs (LilyPad.tsx, pre-existing from 2.4/2.5)
- `[OPEN]` `useEffect([], ...)` in LilyPad reads closure-captured `posX`/`posZ`/`rotationY` — latent bug when positions become mutable (Story 4.3 position-persistence; pre-existing, no trigger today)

## Deferred from: code review of story 2-5-deletion-via-popup-red-flash-and-dissolve (2026-04-17)

- `[RETIRED]` Tab backgrounded / computer sleep mid-deletion-sequence collapses the 1.6s animation to an instant jump on resume (inherited from 2.4). *Retired alongside the 2-4 parent entry above; same reasoning.*
- `[PROMOTED → 2.12]` Clicking Delete on a pad still in `forming`/`dropping`/`settling`/`pulsing` phase silently delays the deletion sequence up to ~2.1s while the pad finishes its drop (inherited from 2.4 — either widen the transition guard to accept any non-terminal phase, or block `handlePadClick` until `resting`)
- `[PROMOTED → 2.11]` `uDropCenter` ripple-uniform collision in `WaterSurface.tsx` — two rapid pad actions share a single ripple slot; story 2.5 aggravates frequency (both Complete and Delete fire through the popup) but the single-slot limit dates from story 1.2. Consider a short ripple queue or multiple uniform slots
- `[RETIRED]` Camera focus mid-lerp cut-off — when the user clicks Delete before `PondCamera`'s focus-zoom lerp completes, `closePopup()` nulls `cameraFocus` and the camera stops at a random intermediate position. *Retired: pre-existing and explicitly accepted in the story; reopen if UX feedback mentions camera jumpiness.*

## Deferred from: code review of story 4-1-popup-color-swatch-neon-selector (2026-04-20)

- `[RETIRED]` `onCommitColor` / `onPreviewColor` inline arrows in `PondScene.tsx` → new identity each PondScene render → ActionPopup's `useEffect` re-fires pointlessly while the popup is open. Store's no-op guard prevents cascading re-renders. *Retired: wasteful-but-guarded; measurable perf impact is zero.*
- `[RETIRED]` `setColorPreview`'s strict-equality no-op guard is case-sensitive. All palette hexes are lowercased at module scope, so this can't fire today. *Retired: no caller paths produce uppercase hex; reopen if external color inputs are added.*
- `[RETIRED]` `aria-pressed` / "current" ring compares ONLY to `committedColor`, not to `previewColor ?? committedColor`. *Retired: explicit design choice ("ring = saved choice"); reopen only on a11y feedback.*

## Deferred from: code review of story 2-10-lily-pads-float-on-water (2026-04-20)

- `[RETIRED]` Pad-tilt gradient evaluated outside visible pond edge at extreme `posX`/`posZ` — tilts toward invisible "phantom water." *Retired: pad positions today are well inside the pond; reopen if positions-at-edge become reachable (see Story 4.3 position-persistence).*
- `[RETIRED]` Frame-ordering invariant between `WaterSurface.useFrame` and `LilyPad.useFrame` is not asserted. Currently stable because `<WaterSurface />` is rendered before `renderTodos.map` in `PondScene`. *Retired: stable under current JSX ordering; reopen if a refactor adds `priority` props or reorders the children.*
- `[RETIRED]` Splash term has no leading-edge gating — contributes non-zero elevation before the wavefront arrives. Matches shader parity (acceptable today). *Retired: matches shader behaviour; reopen if "pre-bob" is reported as UX-visible.*

## Deferred from: code review of story 2-9-ripple-system-hardening (2026-04-20)

- `[RETIRED]` `drainRipples` uses absolute `set({ dropRipples: [] })` — theoretical race if a synchronous reentrancy enqueues during drain. *Retired: drain loop has no reentrancy path; reopen if drain callbacks are added.*
- `[RETIRED]` Ambient scheduler `setTimeout` callback can fire after cleanup — no-op today. *Retired: current ref discipline makes this a no-op; reopen if a shared/module-scope ref is introduced.*
- `[RETIRED]` Unbounded `dropRipples` queue growth during `useFrame` early-return windows (WebGL context loss). *Retired: GPU context loss is rare on our target hardware; reopen if we add WebGL context-loss recovery.*
- `[RETIRED]` Shader `wavefrontOverride > 0.0` sentinel doesn't guard against `freq <= 0.0`. Not a bug today. *Retired: current callers all use non-zero freq; reopen if `freq` becomes configurable.*

## Deferred from: code review of story 2-8-pad-action-glow-on-water (2026-04-20)

- `[OPEN]` `document.querySelector('canvas')` in `ActionPopup.onWheel` is brittle if a second canvas is ever added — should use a passed ref or R3F context (ActionPopup.tsx:~91)
- `[RETIRED]` `focusFlashStartRef` is read by both the rim block and the glow block in the same `useFrame` call — ordering coupling. *Retired: no refactor in progress; reopen when either block is extracted or reordered.*
- `[RETIRED]` Pulse→resting strength handoff depends on numeric coincidence `AMBIENT_GLOW_STRENGTH === FOCUSED_GLOW_STRENGTH === 0.22`. *Retired: accepted numeric coupling; reopen when either constant is tuned independently.*

## Deferred from: code review of story 2-7-pulse-on-flash-polish (2026-04-17)

- `[PROMOTED → 4.4]` `prefers-reduced-motion` not honored by scale pulses, rim glows, body tint, or focus flash in LilyPad.tsx — project-wide accessibility gap, not a 2.7 regression.
- `[PROMOTED → 4.4]` Popup has no keyboard handling — no focus trap, no Escape-to-close, no `role="dialog"`/`aria-modal`; Tab falls through to canvas.
- `[PROMOTED → 4.5]` Pre-existing React-strict runtime errors surfaced while reviewing 2.7: ref mutation + read during render in PondScene (`hasSeenInitialLoadRef.current` at PondScene.tsx:50 and :165). `PondCamera.tsx:108` mutating `camera.position` is actually the correct R3F pattern (Three.js objects are mutable by design, not React state) and should be left alone.
</content>
</invoke>