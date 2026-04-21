from unittest.mock import patch

from sqlalchemy.orm import Session
from starlette.testclient import TestClient

from src.exceptions import EmbeddingApiKeyMissingError
from src.models.todo import Todo


def _vec(index: int) -> list[float]:
    v = [0.0] * 768
    v[index] = 1.0
    return v


def _seed_todo(
    db: Session,
    text: str,
    *,
    embedding: list[float] | None = None,
    embedding_status: str = "pending",
    completed: bool = False,
    deleted: bool = False,
) -> Todo:
    todo = Todo(text=text, completed=completed, deleted=deleted)
    if embedding is not None:
        todo.embedding = embedding
        todo.embedding_status = embedding_status
    elif embedding_status != "pending":
        todo.embedding_status = embedding_status
    db.add(todo)
    db.commit()
    db.refresh(todo)
    return todo


def test_search_missing_q_param(client: TestClient) -> None:
    response = client.get("/api/search")
    assert response.status_code == 422
    assert response.json()["error"] == "validation_error"


def test_search_empty_q(client: TestClient) -> None:
    response = client.get("/api/search?q=")
    assert response.status_code == 422
    assert response.json()["error"] == "validation_error"


def test_search_whitespace_only_q(client: TestClient) -> None:
    response = client.get("/api/search?q=   ")
    assert response.status_code == 422
    assert response.json()["error"] == "validation_error"


def test_search_too_long_q(client: TestClient) -> None:
    response = client.get("/api/search", params={"q": "x" * 501})
    assert response.status_code == 422
    assert response.json()["error"] == "validation_error"


def test_search_returns_expected_shape(
    client: TestClient,
    db_session: Session,
) -> None:
    _seed_todo(
        db_session,
        "Review Q2 roadmap",
        embedding=_vec(3),
        embedding_status="complete",
    )

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(3),
    ):
        response = client.get("/api/search", params={"q": "review"})

    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {
        "query",
        "results",
        "vector_search_unavailable",
        "fts_supported",
    }
    assert body["query"] == "review"
    assert body["vector_search_unavailable"] is False
    assert len(body["results"]) == 1
    result = body["results"][0]
    assert set(result.keys()) == {"todo", "score", "match_type"}
    assert 0.0 <= result["score"] <= 1.0
    assert result["match_type"] in {"keyword", "semantic", "hybrid"}
    # The nested todo uses the same TodoResponse shape as /api/todos.
    assert "id" in result["todo"]
    assert "text" in result["todo"]
    assert "embedding_status" in result["todo"]


def test_search_graceful_degradation_without_api_key(
    client: TestClient,
    db_session: Session,
) -> None:
    # A todo whose text matches the query; embedding missing because the
    # service call will fail.
    _seed_todo(db_session, "Review Q2 roadmap")

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        side_effect=EmbeddingApiKeyMissingError(),
    ):
        response = client.get("/api/search", params={"q": "review"})

    assert response.status_code == 200
    body = response.json()
    assert body["vector_search_unavailable"] is True
    assert len(body["results"]) == 1
    assert body["results"][0]["match_type"] == "keyword"


def test_search_does_not_return_completed_or_deleted(
    client: TestClient,
    db_session: Session,
) -> None:
    _seed_todo(
        db_session,
        "Review completed todo",
        completed=True,
        embedding=_vec(1),
        embedding_status="complete",
    )
    _seed_todo(
        db_session,
        "Review deleted todo",
        deleted=True,
        embedding=_vec(1),
        embedding_status="complete",
    )

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(1),
    ):
        response = client.get("/api/search", params={"q": "review"})

    assert response.status_code == 200
    assert response.json()["results"] == []


def test_search_rejects_duplicate_q_param(client: TestClient) -> None:
    # FastAPI would otherwise silently take the last `q` value. Surface
    # the ambiguity as a 422 so clients know something's off.
    response = client.get("/api/search?q=foo&q=bar")
    assert response.status_code == 422
    assert "multiple values" in response.json()["detail"].lower()


def test_search_passes_short_timeout_to_embedding_service(
    client: TestClient,
    db_session: Session,
) -> None:
    # Verify the search path uses the tight timeout (SEARCH_EMBED_TIMEOUT_MS)
    # rather than the default 15s — a slow embedding endpoint shouldn't
    # pin a search request at the worker's budget.
    from src.services import search_service

    _seed_todo(db_session, "Review Q2 roadmap")

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(0),
    ) as mock_gen:
        response = client.get("/api/search", params={"q": "review"})

    assert response.status_code == 200
    mock_gen.assert_called_once()
    call_kwargs = mock_gen.call_args.kwargs
    assert call_kwargs["timeout_ms"] == search_service.SEARCH_EMBED_TIMEOUT_MS
    assert call_kwargs["timeout_ms"] < 15_000  # tighter than worker's default


def test_search_openapi_schema_includes_endpoint(client: TestClient) -> None:
    response = client.get("/openapi.json")
    assert response.status_code == 200
    paths = response.json()["paths"]
    assert "/api/search" in paths
    assert "get" in paths["/api/search"]
    # Route is tagged so it shows up under a search group in the docs.
    assert "search" in paths["/api/search"]["get"]["tags"]
