import pytest
from starlette.testclient import TestClient

from src.main import app


@pytest.fixture
def client() -> TestClient:  # type: ignore[misc]
    with TestClient(app) as c:
        yield c
