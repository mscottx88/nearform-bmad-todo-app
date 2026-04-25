import pytest
from sqlalchemy.orm import Session
from starlette.testclient import TestClient

from src.config import settings
from src.database import SessionLocal, get_db
from src.main import app
from src.models.chat_message import ChatMessage
from src.models.chat_session import ChatSession
from src.models.creature import Creature
from src.models.todo import Todo
from tests._safeguard import require_test_database


# Session-scoped autouse fixture — runs once before any test. The
# logic lives in `tests._safeguard` so it can be imported and tested
# on its own (see test_safeguard.py) without fighting the fixture
# machinery.
@pytest.fixture(scope="session", autouse=True)
def _safeguard_test_database() -> None:  # type: ignore[misc]
    require_test_database(settings.database_url)


# Deferred from Group C CR (story 6.1): pgvector's HNSW index over an
# embedding column intermittently fails to return the very first row
# searched right after a fresh `alembic upgrade head` on an empty
# table — the index graph appears to need at least one
# insert+query cycle before reliable retrieval. Symptom:
# `test_hybrid_search_semantic_only_hits_vector` asserts `len == 1`
# but receives 0. Once "warmed", subsequent runs are stable.
#
# This session-scoped autouse fixture inserts one dummy embedded todo,
# runs a vector query against it, then deletes the row. The HNSW graph
# is now primed for the rest of the session. `_clean_db` runs after
# this (per-test, function scope), so no test sees the warmup row.
@pytest.fixture(scope="session", autouse=True)
def _warm_hnsw_index(_safeguard_test_database: None) -> None:  # type: ignore[misc]
    from sqlalchemy import text

    warmup_vec = [0.0] * 768
    warmup_vec[0] = 1.0
    with SessionLocal() as session:
        todo = Todo(text="hnsw-warmup", embedding_status="complete")
        todo.embedding = warmup_vec
        session.add(todo)
        session.commit()
        # Touch the index with a vector query so the HNSW graph
        # navigation has executed at least once before any test runs.
        session.execute(
            text(
                "SELECT id FROM todos WHERE embedding IS NOT NULL "
                "ORDER BY embedding <=> :qv LIMIT 1"
            ),
            {"qv": str(warmup_vec)},
        ).all()
        session.delete(todo)
        session.commit()


@pytest.fixture(autouse=True)
def _clean_db() -> None:  # type: ignore[misc]
    """Delete all test data before each test."""
    with SessionLocal() as session:
        session.query(ChatMessage).delete()
        session.query(ChatSession).delete()
        session.query(Creature).delete()
        session.query(Todo).delete()
        session.commit()


@pytest.fixture
def db_session() -> Session:  # type: ignore[misc]
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client(db_session: Session) -> TestClient:  # type: ignore[misc]
    def override_get_db() -> Session:  # type: ignore[misc]
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
