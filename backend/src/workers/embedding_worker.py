"""Thread-based embedding worker — fire-and-forget from the request path.

Implements the contract in story 5.1: a module-scope `ThreadPoolExecutor`
is started at FastAPI lifespan startup and stopped at shutdown. The
request handler calls `enqueue_embedding(todo_id)` after persisting a
todo; that submits `_run_embedding_worker(todo_id)` to the pool so the
response returns without waiting on Google's embeddings API.

Concurrency: `concurrent.futures.ThreadPoolExecutor` only — async/await is
prohibited in this codebase (see CLAUDE.md).
"""

import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from src.database import SessionLocal
from src.exceptions import EmbeddingApiKeyMissingError
from src.models.todo import Todo
from src.services import embedding_service

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3

_executor: ThreadPoolExecutor | None = None


def start_embedding_executor(max_workers: int = 4) -> None:
    global _executor
    if _executor is not None:
        return
    _executor = ThreadPoolExecutor(
        max_workers=max_workers,
        thread_name_prefix="embedding-worker",
    )


def stop_embedding_executor(wait: bool = True) -> None:
    global _executor
    if _executor is None:
        return
    executor = _executor
    # Shut down FIRST, null the module-global AFTERWARDS. If shutdown raises
    # we still clear the ref in `finally` so a subsequent start initialises
    # a fresh pool; leaving `_executor` pointing at a half-dead pool would
    # leak threads. The race window where `enqueue_embedding` sees non-None
    # mid-shutdown and calls `.submit()` on a shutting-down pool is handled
    # in `enqueue_embedding` below.
    try:
        executor.shutdown(wait=wait, cancel_futures=False)
    finally:
        _executor = None


def enqueue_embedding(todo_id: uuid.UUID) -> None:
    # Capture to a local to avoid a TOCTOU between the None-check and .submit.
    executor = _executor
    if executor is None:
        logger.debug("embedding_enqueue_skipped: executor not initialized")
        return
    try:
        executor.submit(_run_embedding_worker, todo_id)
    except RuntimeError:
        # Raised when .submit races stop_embedding_executor: "cannot schedule
        # new futures after shutdown". The todo row is already committed;
        # swallowing here means the request returns 201 normally. The
        # embedding simply never runs — same end state as "executor not
        # initialised". A future reaper (deferred-work) can pick it up.
        logger.debug(
            "embedding_enqueue_skipped: executor_shutting_down todo_id=%s",
            todo_id,
        )


def _run_embedding_worker(todo_id: uuid.UUID) -> None:
    session = SessionLocal()
    try:
        todo = (
            session.query(Todo)
            .filter(
                Todo.id == todo_id,
                Todo.deleted == False,  # noqa: E712
            )
            .first()
        )
        if todo is None:
            # Covers both genuinely-missing rows and soft-deleted ones.
            logger.info(
                "embedding_skipped: todo_not_found_or_deleted todo_id=%s",
                todo_id,
            )
            return
        if todo.embedding_status != "pending":
            logger.info(
                "embedding_skipped: status_not_pending todo_id=%s status=%s",
                todo_id,
                todo.embedding_status,
            )
            return

        text = todo.text
        last_exc: Exception | None = None
        for attempt in (1, 2, 3):
            try:
                values = embedding_service.generate_embedding(text)
                todo.embedding = values
                todo.embedding_status = "complete"
                session.commit()
                return
            except EmbeddingApiKeyMissingError:
                session.rollback()
                todo.embedding_status = "failed"
                session.commit()
                logger.warning(
                    "embedding_skipped: api_key_not_configured todo_id=%s",
                    todo_id,
                )
                return
            except Exception as exc:  # noqa: BLE001 - deliberate catch-all for retry
                # Rollback to clear any half-applied dirty state on the
                # session; without this, a failed commit inside the try
                # leaves the session in a PendingRollback state and every
                # subsequent commit (including the terminal "mark failed"
                # below) re-raises, stranding the row at 'pending'.
                session.rollback()
                last_exc = exc
                # Log .code / .status if present (google.genai.errors.ClientError
                # exposes HTTP code + API status like INVALID_ARGUMENT). These
                # are safe to log — no user text, no API key.
                logger.warning(
                    "embedding_attempt_failed attempt=%d todo_id=%s exc=%s "
                    "code=%s status=%s",
                    attempt,
                    todo_id,
                    type(exc).__name__,
                    getattr(exc, "code", "?"),
                    getattr(exc, "status", "?"),
                )
                if attempt < MAX_ATTEMPTS:
                    time.sleep(2 ** (attempt - 1))

        todo.embedding_status = "failed"
        session.commit()
        logger.warning(
            "embedding_failed_final todo_id=%s exc=%s code=%s status=%s",
            todo_id,
            type(last_exc).__name__ if last_exc is not None else "unknown",
            getattr(last_exc, "code", "?"),
            getattr(last_exc, "status", "?"),
        )
    except Exception:  # pragma: no cover - last-resort safety net
        logger.exception("embedding_worker_crashed todo_id=%s", todo_id)
    finally:
        session.close()
