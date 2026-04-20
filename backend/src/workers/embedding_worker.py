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
    _executor = None
    executor.shutdown(wait=wait, cancel_futures=False)


def enqueue_embedding(todo_id: uuid.UUID) -> None:
    if _executor is None:
        logger.debug("embedding_enqueue_skipped: executor not initialized")
        return
    _executor.submit(_run_embedding_worker, todo_id)


def _run_embedding_worker(todo_id: uuid.UUID) -> None:
    session = SessionLocal()
    try:
        todo = session.query(Todo).filter(Todo.id == todo_id).first()
        if todo is None:
            logger.info("embedding_skipped: todo_not_found todo_id=%s", todo_id)
            return
        if todo.embedding_status != "pending":
            logger.info(
                "embedding_skipped: status_not_pending todo_id=%s status=%s",
                todo_id,
                todo.embedding_status,
            )
            return

        text = todo.text
        for attempt in (1, 2, 3):
            try:
                values = embedding_service.generate_embedding(text)
                todo.embedding = values
                todo.embedding_status = "complete"
                session.commit()
                return
            except EmbeddingApiKeyMissingError:
                todo.embedding_status = "failed"
                session.commit()
                logger.warning(
                    "embedding_skipped: api_key_not_configured todo_id=%s",
                    todo_id,
                )
                return
            except Exception as exc:  # noqa: BLE001 - deliberate catch-all for retry
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
        logger.warning("embedding_failed_final todo_id=%s", todo_id)
    except Exception:  # pragma: no cover - last-resort safety net
        logger.exception("embedding_worker_crashed todo_id=%s", todo_id)
    finally:
        session.close()
