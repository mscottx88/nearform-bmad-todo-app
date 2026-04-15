import pytest
from sqlalchemy.orm import Session
from starlette.testclient import TestClient

from src.database import SessionLocal, get_db
from src.main import app
from src.models.creature import Creature
from src.models.group import GroupMembership
from src.models.todo import Todo


@pytest.fixture(autouse=True)
def _clean_db() -> None:  # type: ignore[misc]
    """Delete all test data before each test."""
    with SessionLocal() as session:
        session.query(Creature).delete()
        session.query(GroupMembership).delete()
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
