import uuid
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from src.database import SessionLocal
from src.exceptions import EmbeddingApiKeyMissingError
from src.models.todo import Todo


@pytest.fixture(autouse=True)
def _no_sleep() -> None:  # type: ignore[misc]
    # Keep tests fast — never sleep in retry backoff.
    with patch("src.workers.embedding_worker.time.sleep", return_value=None):
        yield


def _make_pending_todo(db_session: Session, text: str = "test") -> Todo:
    todo = Todo(text=text)
    db_session.add(todo)
    db_session.commit()
    db_session.refresh(todo)
    return todo


def _reload(db_session: Session, todo_id: uuid.UUID) -> Todo | None:
    db_session.expire_all()
    return db_session.query(Todo).filter(Todo.id == todo_id).first()


def test_worker_happy_path(db_session: Session) -> None:
    from src.workers import embedding_worker

    todo = _make_pending_todo(db_session, "happy")
    values = [0.1] * 768

    with patch(
        "src.workers.embedding_worker.embedding_service.generate_embedding",
        return_value=values,
    ) as gen:
        embedding_worker._run_embedding_worker(todo.id)

    assert gen.call_count == 1
    reloaded = _reload(db_session, todo.id)
    assert reloaded is not None
    assert reloaded.embedding_status == "complete"
    assert reloaded.embedding is not None
    assert len(list(reloaded.embedding)) == 768


def test_worker_retry_then_success(db_session: Session) -> None:
    from src.workers import embedding_worker

    todo = _make_pending_todo(db_session, "retry-success")
    values = [0.2] * 768
    calls = {"n": 0}

    def flaky(_text: str) -> list[float]:
        calls["n"] += 1
        if calls["n"] < 3:
            raise RuntimeError("transient")
        return values

    with patch(
        "src.workers.embedding_worker.embedding_service.generate_embedding",
        side_effect=flaky,
    ):
        embedding_worker._run_embedding_worker(todo.id)

    assert calls["n"] == 3
    reloaded = _reload(db_session, todo.id)
    assert reloaded is not None
    assert reloaded.embedding_status == "complete"


def test_worker_retry_exhausted(db_session: Session) -> None:
    from src.workers import embedding_worker

    todo = _make_pending_todo(db_session, "fail-all")

    with patch(
        "src.workers.embedding_worker.embedding_service.generate_embedding",
        side_effect=RuntimeError("kaboom"),
    ) as gen:
        embedding_worker._run_embedding_worker(todo.id)

    assert gen.call_count == 3
    reloaded = _reload(db_session, todo.id)
    assert reloaded is not None
    assert reloaded.embedding_status == "failed"
    assert reloaded.embedding is None


def test_worker_api_key_missing(db_session: Session) -> None:
    from src.workers import embedding_worker

    todo = _make_pending_todo(db_session, "no-key")

    with patch(
        "src.workers.embedding_worker.embedding_service.generate_embedding",
        side_effect=EmbeddingApiKeyMissingError(),
    ) as gen:
        embedding_worker._run_embedding_worker(todo.id)

    # Short-circuit: exactly 1 attempt, no retries.
    assert gen.call_count == 1
    reloaded = _reload(db_session, todo.id)
    assert reloaded is not None
    assert reloaded.embedding_status == "failed"


def test_worker_todo_deleted_mid_flight(db_session: Session) -> None:
    from src.workers import embedding_worker

    # Use a UUID that doesn't correspond to any row.
    missing_id = uuid.uuid4()

    with patch(
        "src.workers.embedding_worker.embedding_service.generate_embedding",
    ) as gen:
        embedding_worker._run_embedding_worker(missing_id)

    # Never called — worker no-ops on missing row.
    assert gen.call_count == 0


def test_worker_status_already_complete(db_session: Session) -> None:
    from src.workers import embedding_worker

    todo = _make_pending_todo(db_session, "already-done")
    # Pre-stamp with complete status + dummy vector.
    todo.embedding_status = "complete"
    todo.embedding = [0.9] * 768
    db_session.commit()

    with patch(
        "src.workers.embedding_worker.embedding_service.generate_embedding",
    ) as gen:
        embedding_worker._run_embedding_worker(todo.id)

    # No API call — worker refuses to overwrite.
    assert gen.call_count == 0
    reloaded = _reload(db_session, todo.id)
    assert reloaded is not None
    assert reloaded.embedding_status == "complete"
    assert abs(list(reloaded.embedding)[0] - 0.9) < 1e-6


def test_enqueue_no_op_when_executor_unset() -> None:
    from src.workers import embedding_worker

    # Ensure executor is unset.
    embedding_worker.stop_embedding_executor(wait=False)
    assert embedding_worker._executor is None

    # Should not raise and should not submit.
    embedding_worker.enqueue_embedding(uuid.uuid4())


def test_enqueue_submits_to_executor_when_started(db_session: Session) -> None:
    from src.workers import embedding_worker

    todo = _make_pending_todo(db_session, "submit-me")
    values = [0.3] * 768

    embedding_worker.stop_embedding_executor(wait=False)
    embedding_worker.start_embedding_executor(max_workers=1)
    try:
        with patch(
            "src.workers.embedding_worker.embedding_service.generate_embedding",
            return_value=values,
        ):
            embedding_worker.enqueue_embedding(todo.id)
            embedding_worker.stop_embedding_executor(wait=True)
    finally:
        # Ensure clean state for other tests.
        embedding_worker.stop_embedding_executor(wait=False)

    with SessionLocal() as s:
        row = s.query(Todo).filter(Todo.id == todo.id).first()
        assert row is not None
        assert row.embedding_status == "complete"


def test_worker_rejects_wrong_dimension_and_retries(db_session: Session) -> None:
    from src.exceptions import EmbeddingDimensionError
    from src.workers import embedding_worker

    todo = _make_pending_todo(db_session, "bad-dim")

    with patch(
        "src.workers.embedding_worker.embedding_service.generate_embedding",
        side_effect=EmbeddingDimensionError(got=512),
    ) as gen:
        embedding_worker._run_embedding_worker(todo.id)

    assert gen.call_count == 3
    reloaded = _reload(db_session, todo.id)
    assert reloaded is not None
    assert reloaded.embedding_status == "failed"
