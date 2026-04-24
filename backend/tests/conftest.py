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
