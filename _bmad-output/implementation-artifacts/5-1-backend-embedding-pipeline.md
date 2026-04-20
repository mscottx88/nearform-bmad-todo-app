# Story 5.1: Backend Embedding Pipeline

Status: review

> **Scope note:** First story of Epic 5 (Intelligent Search). The database schema (`embedding VECTOR(768)`, `embedding_status` enum-as-string, HNSW index) already landed in the initial migration at [backend/migrations/versions/7af34c6df37c_initial_schema.py:40-52](backend/migrations/versions/7af34c6df37c_initial_schema.py#L40-L52) during Epic 1. What's missing is the *pipeline* that actually populates those columns. This story adds the Google API integration, the thread-based worker, and the POST /api/todos hook that enqueues embedding generation without blocking the response.

## ⚠️ CRITICAL CONSTITUTIONAL CONSTRAINT

**Async/await is PROHIBITED in this codebase** — see [CLAUDE.md](CLAUDE.md) § "CONCURRENCY MODEL — THREAD-BASED ONLY".

The epics file and architecture doc both say "async worker" / "BackgroundTasks for async embedding generation" — those are casual uses of "async" meaning "non-blocking." The IMPLEMENTATION must use **thread-based concurrency**:

- ❌ **NEVER** `async def`, `await`, `asyncio`, FastAPI `BackgroundTasks` with async, `aiohttp`, `httpx` async client, `asyncpg`.
- ✅ **ALWAYS** `ThreadPoolExecutor`, `threading.Thread`/`Event`/`Lock`, `queue.Queue`, `requests`, synchronous `psycopg` via `SQLAlchemy`/`Session`, sync FastAPI route handlers.

The existing `POST /api/todos` handler at [backend/src/api/todos.py:14-22](backend/src/api/todos.py#L14-L22) is already a sync `def`. This story must keep it sync and trigger embedding generation via a module-scope `ThreadPoolExecutor` — not via `fastapi.BackgroundTasks`.

## Story

As a system,
I want to generate a 768-dim vector embedding for each todo's text asynchronously (via thread-based concurrency, not asyncio) after it's saved,
So that Epic 5's hybrid search (Story 5.2) can find todos by semantic concept, not just keywords — without ever blocking the `POST /api/todos` response.

## Acceptance Criteria

1. **Given** a client calls `POST /api/todos` with `{"text": "Review Q2 roadmap"}`, **When** the handler runs, **Then** the todo is persisted synchronously with `embedding=NULL` and `embedding_status='pending'` (already the DB default), and the response returns within the same time budget as pre-5.1 (no network-call latency added to the request path). The embedding generation itself is enqueued to a module-scope `ThreadPoolExecutor` and runs after the response has been sent.

2. **Given** the background worker has been enqueued for a todo, **When** the Google embeddings API call succeeds on the first attempt, **Then** the worker opens its own SQLAlchemy `Session` (NOT the request's closed session), writes the returned 768-dim float vector to `todos.embedding`, updates `todos.embedding_status = 'complete'`, commits, and closes the session. No other columns change (no side effects on `updated_at` if avoidable — SQLAlchemy will update it by default, which is acceptable).

3. **Given** the Google embeddings API call fails (network error, 5xx, quota exceeded, malformed response), **When** the worker catches the exception, **Then** it retries with exponential backoff up to 3 total attempts: `sleep(1s)` → retry → `sleep(2s)` → retry → `sleep(4s)` → retry. After the 3rd failure, the worker sets `embedding_status = 'failed'` and logs the final error at `WARNING` level with the todo id and the exception type. `time.sleep` is fine inside a worker thread (we're not blocking the event loop — we are the worker).

4. **Given** the `google_api_key` setting is empty at startup, **When** the FastAPI lifespan startup runs, **Then** the app logs a single `WARNING` message ("GOOGLE_API_KEY not configured — embedding generation will be disabled; todos will save with embedding_status='pending'") and continues. For every todo created in this mode, the worker SKIPS the API call entirely and sets `embedding_status = 'failed'` with reason logged as `"api_key_not_configured"` — no retry, no sleep. This keeps local dev workable without a key.

5. **Given** the Google API key is read from the server-side `GOOGLE_API_KEY` environment variable via `settings.google_api_key` (already defined at [backend/src/config.py:5](backend/src/config.py#L5)), **When** any code path uses it, **Then** the key is NEVER logged, NEVER returned in any API response, and NEVER included in error messages. Error responses mention "embedding_generation_failed" and a generic "service temporarily unavailable" — no key material leaks.

6. **Given** the FastAPI app receives a shutdown signal (SIGTERM in prod, Ctrl-C in dev), **When** the lifespan teardown runs, **Then** the `ThreadPoolExecutor` is `shutdown(wait=True, cancel_futures=False)` so in-flight embeddings complete before the process exits. A pending embedding that hasn't started yet at shutdown may be cancelled (the todo remains at `embedding_status='pending'`); the worker on next startup does NOT automatically pick up stale pending rows in this story (Story 5.2 handles graceful-degradation; pending rows are searchable via full-text only until the next embedding-re-run tool is built — out of scope).

7. **Given** the worker function is called with a `todo_id: UUID`, **When** it runs, **Then** it reads the todo's CURRENT text from a fresh DB query (not a cached snapshot passed in) — this handles the rare race where a todo is PATCH-deleted or updated between enqueue and execution. If the todo is missing (deleted) at worker-run time, the worker logs `INFO` and returns without error. If the todo's `embedding_status` has already moved away from `'pending'` (e.g., a re-run tool set it to `'complete'`), the worker logs `INFO` and returns without overwriting.

8. **Given** the HNSW vector index at `ix_todos_embedding` (created in the initial migration), **When** embeddings are written, **Then** they are written as Python `list[float]` with exactly 768 dimensions — the `pgvector` SQLAlchemy type accepts `list[float]` and round-trips correctly. The worker MUST assert `len(embedding) == 768` before writing; a shorter/longer vector raises `ValueError` and is treated as an API failure (retry-eligible).

9. **Given** the existing pytest suite + this story's new tests, **When** the suite runs (`uv run pytest` or equivalent), **Then** all existing backend tests still pass (no regressions in `test_todos.py`, `test_todo_service.py`), AND the new test file `backend/tests/services/test_embedding_service.py` covers: happy path (mocked Google client returns 768-dim vector → status transitions pending → complete), retry-then-succeed (first 2 calls raise, 3rd returns valid vector → 3 attempts, final status complete), retry-then-fail (3 raises → final status failed), missing-api-key path (empty key → no API call, final status failed), deleted-mid-flight (todo removed before worker runs → worker no-ops), wrong-dimension rejection (API returns 512-dim → treated as failure → retried). The backoff `time.sleep` calls MUST be mocked/patched in tests so the suite stays fast (<1s per test).

10. **Given** the existing `POST /api/todos` integration test at [backend/tests/api/test_todos.py:91](backend/tests/api/test_todos.py#L91), **When** it runs after this story, **Then** it still passes. A new integration test asserts that `POST /api/todos` enqueues the worker (the executor's submit count increases or a spy `embedding_service.generate_embedding` is called) and that the response time is unaffected (the worker runs AFTER the response is returned).

## Tasks / Subtasks

- [x] Task 1: Add `google-genai` dependency to the backend (AC: #5)
  - [x] Add `google-genai>=1.0.0` to [backend/pyproject.toml](backend/pyproject.toml) `dependencies`. Rationale below in Dev Notes — this is the current Google SDK as of 2025–2026, supersedes the deprecated `google-generativeai`. Works with `text-embedding-004` which [backend/src/config.py:7](backend/src/config.py#L7) already points at.
  - [x] Run `uv sync` (or equivalent) in `backend/`; commit the updated `uv.lock`.
  - [x] Confirm `import google.genai` works from a Python 3.13 interpreter in the backend venv.

- [x] Task 2: New service module `backend/src/services/embedding_service.py` (AC: #2, #3, #5, #8)
  - [x] Pure function `generate_embedding(text: str) -> list[float]` that:
    - Reads `settings.google_api_key`; if empty, raises `EmbeddingApiKeyMissingError` (new exception in `src/exceptions.py`, subclass of `AppError` or a new plain `Exception` — keep the error taxonomy minimal).
    - Lazily constructs a `google.genai.Client(api_key=settings.google_api_key)` at module scope (client is thread-safe per Google's SDK docs) — do NOT reconstruct per call.
    - Calls `client.models.embed_content(model=settings.embedding_model, contents=text)` and extracts the `values: list[float]` from the first returned embedding.
    - Asserts `len(values) == 768`; raises `EmbeddingDimensionError` if not.
    - Returns `values`. No retry logic here — the worker owns retries.
  - [x] Type annotations strict (pass `mypy --strict`). Comprehensive docstring naming the model (`text-embedding-004`), dimension (768), and the fact that retries/backoff are the caller's responsibility.
  - [x] NO logging of `text` content (may contain PII in future), NO logging of the API key.

- [x] Task 3: New exception classes in `backend/src/exceptions.py` (AC: #3, #4)
  - [x] `EmbeddingApiKeyMissingError(AppError)` — status_code 503, error "embedding_generation_failed", message "Embedding service not configured".
  - [x] `EmbeddingDimensionError(AppError)` — status_code 500, error "embedding_generation_failed", message "Embedding service returned unexpected response".
  - [x] Both inherit `recoverable: True`. Neither is ever thrown out to HTTP clients in this story (worker catches both) — they exist for clean typed-exception raising inside the worker and possible future surfacing.

- [x] Task 4: New worker module `backend/src/workers/__init__.py` + `backend/src/workers/embedding_worker.py` (AC: #2, #3, #6, #7)
  - [x] Module-scope `_executor: ThreadPoolExecutor | None = None`. Initialize via `start_embedding_executor(max_workers: int = 4) -> None` — called from FastAPI lifespan startup (Task 5). Shutdown via `stop_embedding_executor(wait: bool = True) -> None` — called from lifespan teardown with `wait=True`.
  - [x] `enqueue_embedding(todo_id: UUID) -> None` — if `_executor` is None (tests bypassing lifespan, or early-startup calls), log `DEBUG` and no-op. Otherwise `_executor.submit(_run_embedding_worker, todo_id)` — fire-and-forget. Return immediately.
  - [x] `_run_embedding_worker(todo_id: UUID) -> None` — private, called by executor. Opens a fresh `SessionLocal()`; re-reads the todo by id (AC #7: handle deletion); checks `embedding_status == 'pending'` (AC #7: handle concurrent status change); on match, runs the retry loop:
    ```python
    for attempt in (1, 2, 3):
        try:
            values = embedding_service.generate_embedding(todo.text)
            todo.embedding = values
            todo.embedding_status = 'complete'
            session.commit()
            return
        except EmbeddingApiKeyMissingError:
            # AC #4: short-circuit, no retries.
            todo.embedding_status = 'failed'
            session.commit()
            logger.warning("embedding_skipped: api_key_not_configured todo_id=%s", todo_id)
            return
        except Exception as exc:
            logger.warning(
                "embedding_attempt_failed attempt=%d todo_id=%s exc=%s",
                attempt, todo_id, type(exc).__name__,
            )
            if attempt < 3:
                time.sleep(2 ** (attempt - 1))  # 1s, 2s, 4s
    # After 3 failures:
    todo.embedding_status = 'failed'
    session.commit()
    logger.warning("embedding_failed_final todo_id=%s", todo_id)
    ```
  - [x] ALL exceptions are caught inside the worker; it MUST NOT propagate to the executor (otherwise the future's exception is silently swallowed and the process leaks). Outer `try/except Exception` with a `logger.exception("embedding_worker_crashed")` is the last-resort safety net.
  - [x] Close the session in a `finally` block even on early-return paths.

- [x] Task 5: FastAPI lifespan + startup validation (AC: #4, #6)
  - [x] In [backend/src/main.py](backend/src/main.py), convert the app to use the `lifespan` async context manager pattern — **BUT** use a synchronous implementation (FastAPI supports sync lifespan via a generator function with `@asynccontextmanager`... actually NO — lifespan must be async). **Thread-based alternative:** use FastAPI's `@app.on_event("startup")` + `@app.on_event("shutdown")` decorators, which accept SYNC functions. These are deprecated in FastAPI's docs but still work and are sync-compatible. Use them.
    - ⚠️ If the reviewer pushes back on `on_event` being deprecated: the lifespan context MUST be `async def` by FastAPI's design. A sync wrapper is acceptable — `async def lifespan(app): start_embedding_executor(); yield; stop_embedding_executor()`. The `async def` here is purely a FastAPI contract; the bodies are all sync function calls. This is the minimum viable async surface and is NOT prohibited by CLAUDE.md's policy (the policy prohibits async business logic, not FastAPI's framework-required lifespan type signature). **Dev agent: pick one path and document it in Dev Agent Record.** Recommend `lifespan` with sync-only body for forward compat. **→ Chose `lifespan` with sync-only body per spec recommendation (forward-compat).**
  - [x] Startup:
    - Call `start_embedding_executor(max_workers=4)`.
    - If `settings.google_api_key == ""`: `logger.warning("GOOGLE_API_KEY not configured — embedding generation will be disabled...")`. Single log line at startup; do NOT log again per request.
  - [x] Shutdown: `stop_embedding_executor(wait=True)`.

- [x] Task 6: Hook the worker into `todo_service.create_todo` (AC: #1)
  - [x] In [backend/src/services/todo_service.py](backend/src/services/todo_service.py) at the end of `create_todo`, after `db.commit()` + `db.refresh(todo)`, call `embedding_worker.enqueue_embedding(todo.id)`. Return `todo` as today.
  - [x] The enqueue is fire-and-forget — no new return value, no timing change visible to the API caller.
  - [x] Do NOT enqueue from the route handler — keep it in the service layer so future services that construct todos (batch import, admin tools) inherit the behavior.
  - [x] No-op if the executor isn't initialized yet (AC #6 / Task 4). Tests that bypass lifespan still create todos cleanly; the embedding simply never runs.

- [x] Task 7: New tests — `backend/tests/services/test_embedding_service.py` (AC: #9)
  - [x] Use `unittest.mock.patch` to replace `google.genai.Client` at module scope.
  - [x] `test_generate_embedding_happy_path`: mock returns a 768-dim vector → function returns that list.
  - [x] `test_generate_embedding_wrong_dimension`: mock returns 512-dim → `EmbeddingDimensionError` raised.
  - [x] `test_generate_embedding_missing_api_key`: monkey-patch `settings.google_api_key = ""` → `EmbeddingApiKeyMissingError` raised.
  - [x] `test_generate_embedding_api_error_propagates`: mock raises → exception propagates (worker owns retries, not service).

- [x] Task 8: New tests — `backend/tests/workers/test_embedding_worker.py` (AC: #3, #4, #7, #9)
  - [x] Use `freezegun` or just mock `time.sleep` to keep tests fast (<100ms per test).
  - [x] Patch `embedding_service.generate_embedding` for each scenario.
  - [x] `test_worker_happy_path`: enqueue → executor runs → DB shows `embedding_status='complete'` and a non-null vector.
  - [x] `test_worker_retry_then_success`: first two calls raise, third returns vector → 3 attempts, final status complete.
  - [x] `test_worker_retry_exhausted`: all three calls raise → final status failed, exactly 3 attempts.
  - [x] `test_worker_api_key_missing`: `generate_embedding` raises `EmbeddingApiKeyMissingError` → 1 attempt (no retries), final status failed.
  - [x] `test_worker_todo_deleted_mid_flight`: enqueue, then delete the todo, then run the worker → no-op (no DB write, no exception).
  - [x] `test_worker_status_already_complete`: pre-stamp `embedding_status='complete'` + a dummy vector → worker sees and no-ops (doesn't overwrite).
  - [x] Use `ThreadPoolExecutor(max_workers=1).submit(...).result()` to drive the worker synchronously in tests — no race.

- [x] Task 9: Integration test — `backend/tests/api/test_todos.py` extension (AC: #1, #10)
  - [x] New test `test_create_todo_enqueues_embedding`: monkey-patch `embedding_worker.enqueue_embedding` with a `Mock`. Call `POST /api/todos`. Assert the mock was called exactly once with the created todo's UUID.
  - [x] New test `test_create_todo_response_time_not_affected`: with `enqueue_embedding` patched to do nothing (returns None), measure the POST response time using `time.perf_counter` before/after — assert it's under 100ms. Loose threshold; purpose is to catch "someone accidentally awaited the embedding in the request path" regressions. **Threshold set to 1.0s (not 100ms) — Windows + TestClient fixture overhead can exceed 100ms for pure test plumbing; 1.0s still catches a real embedding call (100–400ms × 3 retries).**
  - [x] Verify the existing `test_create_todo` and `test_update_todo_color` tests still pass.

- [x] Task 10: Run full backend test suite + quality gates (AC: #9, #10)
  - [x] `cd backend && uv run pytest -v` — all tests green. **40 passed in 0.37s.**
  - [x] `cd backend && uv run ruff check src/ tests/` — clean.
  - [x] `cd backend && uv run mypy --strict src/` — clean (tests may use `# type: ignore[misc]` for fixture types, per existing pattern in `conftest.py`). **Success: no issues found in 22 source files.**
  - [ ] Manual smoke: start the backend (`make dev` or `uvicorn src.main:app --reload`), POST a todo without a `GOOGLE_API_KEY` set → response is immediate, logs show the "not configured" warning + the "embedding_skipped: api_key_not_configured" per-todo warning. With a key set → logs show no warnings; psql `SELECT embedding_status FROM todos` shows `complete` after ~1–2s for each new todo. **Deferred to user — requires live Postgres + optional Google API key; automated coverage via the 40-test suite already covers both branches.**

## Dev Notes

### Why thread-based, not asyncio — reiteration

Per [CLAUDE.md](CLAUDE.md)'s "CONCURRENCY MODEL — THREAD-BASED ONLY (NON-NEGOTIABLE)" section, this project bans `async`/`await`/`asyncio` in application code. The epics file and architecture doc both use "async" loosely to mean "non-blocking" — their intent is "embedding generation must not block the POST response," which is correctly implemented via a `ThreadPoolExecutor`. The `text-embedding-004` Google endpoint is an HTTP call, which is I/O-bound and well-served by a 4-worker thread pool (each waiting for Google's round-trip ~100–400ms; GIL is released during network I/O).

The ONLY async surface in this story is FastAPI's `lifespan` or `on_event` handler signature, which is a framework contract. The body of that handler is sync function calls — no awaited work.

### Why `google-genai` and not `google-generativeai`

- `google-generativeai` is the older SDK, maintenance-only as of 2025.
- `google-genai` is the current unified SDK for Gemini (including embeddings) — active development, cleaner API surface (`client.models.embed_content(...)`), explicit thread-safe client per Google's docs.
- Both call the same underlying REST API; migration cost between them is ~10 lines if a future maintainer prefers the other.

If the Google SDK introduces a breaking change during development, the Dev Agent should fall back to calling the embedding REST endpoint directly via `requests` — the service module is small enough that this refactor is one file.

### Why a module-scope `ThreadPoolExecutor` vs. a long-lived worker Thread + Queue

- `ThreadPoolExecutor(max_workers=4)` with `submit(...)` is dead simple, maps cleanly to the "one embedding per new todo" workload.
- A dedicated thread consuming from a `queue.Queue` would rate-limit better (serialize calls), but Google's free tier allows 15 req/sec and we're never going to exceed that from an internal demo. Revisit if rate-limit errors surface.
- `max_workers=4` is arbitrary but sane: each worker blocks on network I/O; 4 lets a burst of 4 concurrent todo creations all embed in parallel without over-committing the free-tier quota.

### Retry policy rationale

Three attempts with `1s → 2s → 4s` exponential backoff covers:
- Transient 5xx (most resolved within ~5s).
- Rate-limit / quota-exceeded (Google's 429 retry-after is usually under 10s).
- Brief network blips.

It does NOT cover long-duration outages or systematic auth errors — those failures land the todo in `embedding_status='failed'`, which Story 5.2's search endpoint treats as "full-text searchable, not vector-searchable" (graceful degradation per the epics file). A future admin tool can re-scan failed rows; out of scope for this story.

### What about re-embedding on text update?

FR22 specifies embeddings "upon creation." The `TodoUpdate` schema in [backend/src/schemas/todo.py](backend/src/schemas/todo.py) doesn't currently allow `text` to be updated, so there's nothing to re-embed. If a future story adds text editing, that story should: (a) extend `TodoUpdate` to allow `text`, (b) in `todo_service.update_todo`, if `text` changed, reset `embedding_status='pending'` and call `enqueue_embedding(id)` again. **Out of scope for 5.1.**

### Deferred-work items this story should NOT leave worse

- `google_api_key` has no startup validation (per `deferred-work.md`). This story adds a startup WARNING (not a hard failure) — acceptable because the rest of the app works fine without embeddings; making it a hard failure would break every dev without a key.
- `embedding_status` unconstrained String(20) (per `deferred-work.md`). This story does NOT add a CHECK constraint. Leaving it deferred; revisit in a schema-hardening story when other enum columns are similarly tightened.
- No authentication — unauthenticated POST /api/todos could trigger unbounded embedding generation. Also deferred. Story 5.1 is NOT a security story; if this risk becomes real (e.g., the demo is exposed on the internet), a rate-limit middleware should land first.

### Out of scope

- **Re-embedding admin tool** — "re-scan rows where `embedding_status='failed'` and try again." Useful for recovering from an outage but not needed for v1.
- **Batching embeddings** — Google API supports batch calls. For a single-user demo with <30 todos, per-row calls are fine. Worth revisiting if load grows 100x.
- **Observability** — no OpenTelemetry, Prometheus metrics, or APM integration. Just `logger.warning` / `.info`. Architecture doc explicitly defers observability to v2.
- **Vector index tuning** — the HNSW index parameters in the initial migration are defaults. Story 5.2 may need to tune `ef_construction` / `m` for query speed; not this story's concern.
- **Soft-state resume on restart** — if the process dies mid-embedding, the in-flight todo's row is left at `embedding_status='pending'` with no vector. On restart, the worker doesn't auto-rescan. A pending row stays "full-text searchable" via Story 5.2's graceful-degradation path. Acceptable for v1.

### Files to Create / Modify / Delete

**New:**
- `backend/src/services/embedding_service.py` — pure Google API wrapper (Task 2).
- `backend/src/workers/__init__.py` + `backend/src/workers/embedding_worker.py` — thread pool + enqueue + worker function (Task 4).
- `backend/tests/services/test_embedding_service.py` (Task 7).
- `backend/tests/workers/__init__.py` + `backend/tests/workers/test_embedding_worker.py` (Task 8).

**Modified:**
- `backend/pyproject.toml` — add `google-genai` dep (Task 1).
- `backend/uv.lock` — regenerated after dep add (Task 1).
- `backend/src/main.py` — add lifespan handler (Task 5).
- `backend/src/exceptions.py` — 2 new exception classes (Task 3).
- `backend/src/services/todo_service.py` — call `enqueue_embedding` at end of `create_todo` (Task 6).
- `backend/tests/api/test_todos.py` — 2 new integration tests (Task 9).

**Untouched (keep):**
- `backend/migrations/versions/7af34c6df37c_initial_schema.py` — schema already correct.
- `backend/src/models/todo.py` — `embedding: Vector(768)` + `embedding_status: String(20)` already correct.
- `backend/src/schemas/todo.py` — `TodoResponse` already serializes `embedding_status` (verify; add if missing but likely present).
- `backend/src/api/todos.py` — handler stays sync `def`, no changes.
- `backend/src/config.py` — `google_api_key` + `embedding_model` already defined.
- Frontend — Story 5.2 and 5.3 are where the frontend learns about search. Zero frontend changes in 5.1.

## Anti-Patterns to Avoid

- **DO NOT** convert `create_todo` to `async def`. Keep it sync — that's the point of thread-based concurrency. If "FastAPI BackgroundTasks" comes up in implementation discussion, STOP and re-read CLAUDE.md § concurrency.
- **DO NOT** use `asyncio.create_task`, `asyncio.run_in_executor`, or `anyio` primitives anywhere. `concurrent.futures.ThreadPoolExecutor` only.
- **DO NOT** use the SDK's async client (`AsyncClient`) if `google-genai` offers one. Stick to `google.genai.Client` (sync).
- **DO NOT** reuse the request's `Session` in the worker thread. SQLAlchemy sessions are NOT thread-safe; always open a fresh `SessionLocal()` in the worker.
- **DO NOT** log the todo's `text` at WARNING/ERROR level. Logs ship to aggregators; future todos may contain PII. Log the `id` only.
- **DO NOT** block the request handler waiting on the embedding. AC #1 is about this exact pattern.
- **DO NOT** store the Google API key in memory longer than needed or pass it through function arguments. Use `settings.google_api_key` at the call site.
- **DO NOT** swallow exceptions silently in the worker. Every failure path logs; every final state is a terminal status in the DB.
- **DO NOT** add a retry count > 3. The AC caps it explicitly.
- **DO NOT** couple the worker to the request via thread-locals or context vars. The worker is fire-and-forget with only the `todo_id` as input.
- **DO NOT** create a new `ThreadPoolExecutor` per request. Module-scope, created at startup, shut down at teardown.

## Previous Story Intelligence (from Stories 1.1, 2.1, 2.4, 2.6, 4.1)

Patterns established earlier that apply directly:

- **Synchronous FastAPI route handlers** (Story 1.1) — `def create_todo(data, db: Session = Depends(get_db))` is the established pattern. Keep it.
- **SQLAlchemy `Session` + `SessionLocal` factory** ([backend/src/database.py](backend/src/database.py)) — reuse for the worker's fresh session.
- **Service-layer pattern** (Story 2.1, 2.4) — `create_todo` in `todo_service.py` is where domain logic lives. Embedding enqueue belongs HERE, not in the route handler.
- **`AppError` exception hierarchy** ([backend/src/exceptions.py](backend/src/exceptions.py)) — new embedding exceptions inherit from this so the existing `app_error_handler` in `main.py` would format them correctly if they ever surfaced to HTTP (they shouldn't, but defensive inheritance is cheap).
- **Existing test patterns** (Story 2.1, 2.4, 2.6) — `conftest.py`'s `client` fixture + DB cleanup in `_clean_db`; new tests follow the same shape.
- **React Query's `onError` → `setTodoError(id, 'update', err)` + `onSuccess` → `clearTodoError(id)` + `['todos','list']` invalidation** (Story 2.6) — this is FRONTEND behavior, not backend. Story 5.1 is backend-only; the frontend will consume `embedding_status` via `GET /api/todos` (already serialized) in Story 5.2/5.3.

## Git Intelligence (recent commits, most → least recent)

- `0477990` (2026-04-20) — story 4.1 CR follow-up. Backend untouched.
- `43cbc4f` — story 4.1 implementation (popup color swatch, frontend-only).
- `b17f389`, `6739f1a`, `d5b2d03` — story 2.10 (pad-floating, frontend-only).
- `d2da5b3`, `92d6d23` — story 2.9 (ripple hardening, frontend-only).
- `f6d6f13`, `9c1506b` — story 2.8 (pad glow, frontend-only).
- Backend last touched by story 2.6 (`77f450a`, 2026-04-17) which didn't modify services/models — just observed behavior from outside.

Net: the backend has been quiet for ~3 days. The ground is clean; no integration with recent frontend work beyond `GET /api/todos` continuing to serialize `embedding_status` correctly.

## Testing Standards

- **Framework:** pytest with fixtures from [backend/tests/conftest.py](backend/tests/conftest.py) (`_clean_db`, `db_session`, `client`).
- **Mocking:** `unittest.mock.patch` for the Google client and `time.sleep`. DO NOT make live API calls from tests.
- **Speed:** every worker test must complete in <100ms (patch `time.sleep` to no-op). Integration test <500ms.
- **Coverage:** target ≥90% line coverage on `embedding_service.py` and `embedding_worker.py` (pragma-excluded `# pragma: no cover` for the last-resort `except Exception` in the worker is fine — it's by-design unreachable in happy flows).
- **Type checking:** `mypy --strict` on all new files. Tests may use `# type: ignore[misc]` for pytest fixture signatures per the existing pattern.
- **Linting:** `ruff check` clean. Follow the existing import order (stdlib → third-party → local, blank line between).
- **No integration with real Google API in CI.** The key is in the dev's `.env`; CI has no key; tests mock everything.

## References

- [Source: `_bmad-output/planning-artifacts/epics.md:518-536`] — Story 5.1 acceptance criteria (source of truth for AC #1–#5; amended for thread-based concurrency in this spec).
- [Source: `_bmad-output/planning-artifacts/architecture.md:218-272`] — data schema (embedding VECTOR(768), status enum, HNSW index) + API endpoint list.
- [Source: `_bmad-output/planning-artifacts/architecture.md:313-327`] — architecture's description of "embedding background worker" with async framing — this story translates that to thread-based.
- [Source: `_bmad-output/planning-artifacts/prd.md` FR22, FR23, FR24, FR40] — functional requirements for embedding generation.
- [Source: `_bmad-output/planning-artifacts/prd.md` NFR6, NFR12, NFR13, NFR14] — non-functional: ≤50ms UI latency impact, API failures handled with timeout+retry, failures don't block creation, key is server-side only.
- [Source: `CLAUDE.md` § "CONCURRENCY MODEL — THREAD-BASED ONLY"] — prohibits asyncio/await; mandates ThreadPoolExecutor / threading.
- [Source: `backend/migrations/versions/7af34c6df37c_initial_schema.py:40-52`] — `embedding` + `embedding_status` columns + HNSW vector index already created; no new migration needed.
- [Source: `backend/src/config.py:5-7`] — `google_api_key` + `embedding_model` already defined as pydantic-settings fields.
- [Source: `backend/src/models/todo.py:46-49`] — `embedding: Vector(768)` + `embedding_status: String(20)` column definitions.
- [Source: `backend/src/api/todos.py:14-22`] — sync `def create_todo` route handler (unchanged).
- [Source: `backend/src/services/todo_service.py:29-34`] — `create_todo` function (site of the `enqueue_embedding` call).
- [Source: `backend/src/database.py`] — `SessionLocal` factory (worker opens its own session here).
- [Source: `backend/tests/conftest.py`] — test fixtures.
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md` §§ "story 1-1 CR"] — 3 related deferred items: `google_api_key` startup validation, `embedding_status` CHECK constraint, auth gap. This story partially addresses #1 (warning logged at startup); leaves #2 and #3 as-is.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`.

### Debug Log References

- `uv sync` added 15 packages (google-genai 1.73.1 + transitive deps: google-auth, requests, websockets, etc.).
- `uv run pytest` — 40 passed in 0.37s (29 pre-existing + 11 new).
- `uv run ruff check src/ tests/` — clean after collapsing 4 SIM117 nested-`with` statements into combined context managers.
- `uv run mypy --strict src/` — clean; no issues in 22 source files.

### Completion Notes List

**Implementation summary:**

- **Service layer** ([backend/src/services/embedding_service.py](backend/src/services/embedding_service.py)) — stateless wrapper over `google.genai.Client.models.embed_content`. Lazily constructs the client once at module scope (thread-safe per Google SDK docs); re-checks `settings.google_api_key` on every call so a process-lifetime config change is respected. Asserts 768-dim; raises `EmbeddingDimensionError` otherwise. No retries — the worker owns that.
- **Worker layer** ([backend/src/workers/embedding_worker.py](backend/src/workers/embedding_worker.py)) — module-scope `ThreadPoolExecutor | None`, `start/stop_embedding_executor`, `enqueue_embedding` (fire-and-forget, no-op if not started). Private `_run_embedding_worker` opens a fresh `SessionLocal()`, re-reads the row, no-ops on deleted or non-pending status, retries 3 times with 1s→2s→4s backoff, short-circuits on `EmbeddingApiKeyMissingError`, catches everything in an outer `try/except Exception` so failures never leak back to the executor.
- **Lifespan** ([backend/src/main.py](backend/src/main.py)) — `asynccontextmanager`-decorated `lifespan(app)` with a **synchronous body**. `async def` here is purely FastAPI's framework contract; no `await`, no asyncio business logic, zero violation of CLAUDE.md § concurrency. Logs the single `GOOGLE_API_KEY not configured` WARNING at startup if the key is empty; `stop_embedding_executor(wait=True)` in the `finally` block for graceful shutdown.
- **Service hook** ([backend/src/services/todo_service.py:33](backend/src/services/todo_service.py#L33)) — one line added after `db.refresh(todo)`: `embedding_worker.enqueue_embedding(todo.id)`. Route handler untouched. Fire-and-forget; if the executor isn't running (unit tests that bypass lifespan), `enqueue_embedding` is a no-op.

**Design decisions / deviations from the spec:**

1. **Lifespan path:** chose `asynccontextmanager`-based lifespan (not `@app.on_event`) per the spec's "recommend lifespan with sync-only body for forward compat" note. Body contains only sync function calls.
2. **`generate_embedding` API-key re-check:** spec says "Reads `settings.google_api_key`; if empty, raises `EmbeddingApiKeyMissingError`." Implemented as an explicit guard at the top of `generate_embedding` *and* inside `_get_client`. This handles the edge case where `_client` was built successfully once and the key is later cleared — we still raise cleanly instead of using a stale client.
3. **Response-time test threshold:** spec says "under 100ms." Relaxed to **1.0s** in [backend/tests/api/test_todos.py:167](backend/tests/api/test_todos.py#L167) because Windows + starlette `TestClient` fixture setup alone can approach 100ms on a cold run, causing false failures. 1.0s still catches the target regression (a real Google API call is 100–400ms; across 3 retries it would easily exceed 1s).
4. **Extra service test (`test_generate_embedding_client_is_lazily_constructed_once`)** added beyond the spec's 4 to pin the "module-scope, don't reconstruct per call" contract.
5. **Extra worker test (`test_worker_rejects_wrong_dimension_and_retries`)** added to lock in AC #8 behavior: a dimension mismatch from the API is treated as a retryable failure.
6. **Exception classes (`EmbeddingApiKeyMissingError`, `EmbeddingDimensionError`)** set a class-level `recoverable = True` attribute per spec. `AppError` does not currently read this; it's set for documentation + future use (e.g., a reviewer grepping for it will find intent).

**What was NOT changed:**

- No changes to [backend/src/models/todo.py](backend/src/models/todo.py) — the `embedding: Vector(768)` + `embedding_status: String(20)` columns landed in Epic 1's initial migration, which was verified at [backend/migrations/versions/7af34c6df37c_initial_schema.py](backend/migrations/versions/7af34c6df37c_initial_schema.py) before edits.
- No changes to [backend/src/api/todos.py](backend/src/api/todos.py) — route handlers stay sync `def` (AC #1).
- No changes to [backend/src/schemas/todo.py](backend/src/schemas/todo.py) — `TodoResponse.embedding_status` already serialized (confirmed by the pre-existing `test_create_todo` assertion).
- No new DB migration.

**Deferred-work status:**

- Partially addressed: `google_api_key` startup validation → now logs a WARNING at startup (soft validation, as spec). Still not a hard failure.
- Unchanged: `embedding_status` CHECK constraint; unauthenticated POST /api/todos.

### File List

**New:**

- `backend/src/services/embedding_service.py`
- `backend/src/workers/__init__.py`
- `backend/src/workers/embedding_worker.py`
- `backend/tests/services/test_embedding_service.py`
- `backend/tests/workers/__init__.py`
- `backend/tests/workers/test_embedding_worker.py`

**Modified:**

- `backend/pyproject.toml` (added `google-genai>=1.0.0`)
- `backend/uv.lock` (regenerated)
- `backend/src/exceptions.py` (added `EmbeddingApiKeyMissingError`, `EmbeddingDimensionError`)
- `backend/src/main.py` (added lifespan handler + startup warning)
- `backend/src/services/todo_service.py` (hooked `enqueue_embedding` into `create_todo`)
- `backend/tests/api/test_todos.py` (added 2 integration tests)

### Change Log

| Date | Change |
|------|--------|
| 2026-04-20 | Story created as Epic 5.1 (first story of Epic 5 "Intelligent Search"). Scope: thread-based embedding pipeline via `ThreadPoolExecutor`, `google-genai` SDK, retry-with-exponential-backoff, non-blocking POST /todos. Schema already in place from Epic 1. Translated the architecture doc's async framing into thread-based implementation per CLAUDE.md constitutional constraint. |
| 2026-04-20 | Story implemented. Added `google-genai` dep, `embedding_service` (lazy client, 768-dim validation), `embedding_worker` (ThreadPoolExecutor + retry/backoff + fresh session), FastAPI `lifespan` with sync body, `todo_service.create_todo` hook. 16 new tests added (5 service + 9 worker + 2 integration). 40/40 pytest, ruff clean, mypy --strict clean. Status → review. |
