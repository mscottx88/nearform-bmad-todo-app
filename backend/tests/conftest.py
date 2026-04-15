import pytest
from sqlalchemy.orm import Session
from starlette.testclient import TestClient

from src.database import SessionLocal, engine, get_db
from src.main import app


@pytest.fixture
def db_session() -> Session:  # type: ignore[misc]
    connection = engine.connect()
    transaction = connection.begin()
    session = SessionLocal(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def client(db_session: Session) -> TestClient:  # type: ignore[misc]
    def override_get_db() -> Session:  # type: ignore[misc]
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
