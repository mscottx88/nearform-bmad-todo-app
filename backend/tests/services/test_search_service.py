from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from src.exceptions import EmbeddingApiKeyMissingError
from src.models.todo import Todo


def _vec(index: int, value: float = 1.0) -> list[float]:
    """Build a 768-dim one-hot vector for deterministic cosine similarity.

    Two vectors built with the same `index` yield cosine similarity 1.0;
    two vectors built with different indexes yield 0.0. This makes the
    expected hybrid score computable by hand.
    """
    v = [0.0] * 768
    v[index] = value
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


def test_hybrid_search_keyword_only_hits_fts(db_session: Session) -> None:
    # One todo matches 'review' via FTS; none have embeddings at all.
    from src.services import search_service

    todo = _seed_todo(db_session, "Review Q2 roadmap")

    # generate_embedding returns a vec that shouldn't match anything.
    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(0),
    ):
        resp = search_service.hybrid_search(db_session, "review")

    assert resp.vector_search_unavailable is False
    assert len(resp.results) == 1
    result = resp.results[0]
    assert result.todo.id == todo.id
    assert result.match_type == "keyword"
    # FTS contribution caps at FTS_WEIGHT (0.3) with vec_score=0.0.
    assert result.score <= search_service.FTS_WEIGHT + 1e-6
    assert result.score > 0.0


def test_hybrid_search_semantic_only_hits_vector(db_session: Session) -> None:
    # Todo text has no word overlap with the query; its embedding is the
    # same one-hot vector as the query embedding → cosine similarity 1.0.
    from src.services import search_service

    todo = _seed_todo(
        db_session,
        "Refactor the authentication middleware",
        embedding=_vec(7),
        embedding_status="complete",
    )

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(7),
    ):
        resp = search_service.hybrid_search(db_session, "zzzzzz")

    assert resp.vector_search_unavailable is False
    assert len(resp.results) == 1
    result = resp.results[0]
    assert result.todo.id == todo.id
    assert result.match_type == "semantic"
    # Pure-semantic ~= VECTOR_WEIGHT (0.7) for similarity 1.0.
    assert result.score == pytest.approx(search_service.VECTOR_WEIGHT, abs=1e-4)


def test_hybrid_search_mixed_returns_combined(db_session: Session) -> None:
    # Todo matches on BOTH sides: FTS hits the word 'review' AND its
    # embedding matches the query embedding exactly.
    from src.services import search_service

    hybrid_todo = _seed_todo(
        db_session,
        "Review Q2 roadmap",
        embedding=_vec(3),
        embedding_status="complete",
    )

    # Another todo matches only via FTS — ensure the hybrid ranks above.
    keyword_only = _seed_todo(db_session, "Review dentist appointment")

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(3),
    ):
        resp = search_service.hybrid_search(db_session, "review")

    assert resp.vector_search_unavailable is False
    assert len(resp.results) == 2
    # Hybrid match must rank first.
    assert resp.results[0].todo.id == hybrid_todo.id
    assert resp.results[0].match_type == "hybrid"
    assert resp.results[1].todo.id == keyword_only.id
    assert resp.results[1].match_type == "keyword"
    # Hybrid score strictly higher than keyword-only score.
    assert resp.results[0].score > resp.results[1].score


def test_hybrid_search_excludes_deleted(db_session: Session) -> None:
    from src.services import search_service

    _seed_todo(
        db_session,
        "Review the deleted todo",
        deleted=True,
        embedding=_vec(0),
        embedding_status="complete",
    )

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(0),
    ):
        resp = search_service.hybrid_search(db_session, "review")

    assert resp.results == []


def test_hybrid_search_excludes_completed(db_session: Session) -> None:
    from src.services import search_service

    _seed_todo(
        db_session,
        "Review the completed todo",
        completed=True,
        embedding=_vec(0),
        embedding_status="complete",
    )

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(0),
    ):
        resp = search_service.hybrid_search(db_session, "review")

    assert resp.results == []


def test_hybrid_search_pending_embedding_not_in_vector_results(
    db_session: Session,
) -> None:
    # Pending-embedding todo must NOT contribute to the vector branch,
    # but CAN still match via FTS.
    from src.services import search_service

    todo = _seed_todo(
        db_session,
        "Review pending embedding",
        embedding=None,  # no embedding written yet
        embedding_status="pending",
    )

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(42),
    ):
        resp = search_service.hybrid_search(db_session, "review")

    assert len(resp.results) == 1
    result = resp.results[0]
    assert result.todo.id == todo.id
    # Must be keyword-only — no vector score contribution.
    assert result.match_type == "keyword"


def test_hybrid_search_embedding_service_failure_falls_back_to_fts(
    db_session: Session,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from src.services import search_service

    todo = _seed_todo(
        db_session,
        "Review Q2 roadmap",
        embedding=_vec(5),
        embedding_status="complete",
    )

    with (
        patch(
            "src.services.search_service.embedding_service.generate_embedding",
            side_effect=EmbeddingApiKeyMissingError(),
        ),
        caplog.at_level("WARNING"),
    ):
        resp = search_service.hybrid_search(db_session, "review")

    assert resp.vector_search_unavailable is True
    # FTS still returns the todo (keyword match); vector branch skipped.
    assert len(resp.results) == 1
    assert resp.results[0].todo.id == todo.id
    assert resp.results[0].match_type == "keyword"
    # WARNING logged with exception type (no PII).
    assert any(
        "search_vector_unavailable" in rec.message
        and "EmbeddingApiKeyMissingError" in rec.message
        for rec in caplog.records
    )


def test_hybrid_search_empty_query_after_strip_raises(
    db_session: Session,
) -> None:
    from src.services import search_service

    with pytest.raises(ValueError, match="empty"):
        search_service.hybrid_search(db_session, "   ")


def test_hybrid_search_result_limit_respected(db_session: Session) -> None:
    # Seed 30 todos all matching 'widget'; assert only RESULT_LIMIT
    # (20) come back.
    from src.services import search_service

    for i in range(30):
        _seed_todo(db_session, f"widget number {i}")

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(0),
    ):
        resp = search_service.hybrid_search(db_session, "widget")

    assert len(resp.results) == search_service.RESULT_LIMIT


def test_hybrid_search_candidate_limit_respected(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Tighten RESULT_LIMIT so the test checks the per-side cap rather
    # than the result cap. With MAX_CANDIDATES_PER_SIDE=50 and 60 FTS
    # matches, exactly 50 should make it into the merge pool.
    from src.services import search_service

    monkeypatch.setattr(search_service, "RESULT_LIMIT", 100)

    for i in range(60):
        _seed_todo(db_session, f"widget number {i}")

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(0),
    ):
        resp = search_service.hybrid_search(db_session, "widget")

    assert len(resp.results) == search_service.MAX_CANDIDATES_PER_SIDE


def test_hybrid_search_empty_result_set_returns_empty_list(
    db_session: Session,
) -> None:
    # No todos match — response is valid, just empty.
    from src.services import search_service

    _seed_todo(db_session, "unrelated text")

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(0),
    ):
        resp = search_service.hybrid_search(db_session, "nothingmatchesthis")

    assert resp.results == []
    assert resp.vector_search_unavailable is False
    assert resp.query == "nothingmatchesthis"
