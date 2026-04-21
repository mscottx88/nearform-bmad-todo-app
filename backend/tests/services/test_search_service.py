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


def _vec_with_similarity_to_ref(similarity: float) -> list[float]:
    """Build a 768-dim unit vector with exact cosine `similarity` to `_vec(0)`.

    Math: let reference `a = [1, 0, 0, ..., 0]`. Construct
    `b = [S, sqrt(1 - S²), 0, 0, ..., 0]`. Then:
      - `||a|| = ||b|| = 1`
      - `a · b = S`
      - `cos(a, b) = S`

    So `_vec_with_similarity_to_ref(0.54)` produces a vector whose
    cosine similarity to `_vec(0)` is exactly 0.54 — the same value
    that was observed on production for "create" vs. "buy groceries
    today", surfaced during live smoke testing. This lets us seed the
    test DB with embeddings at KNOWN similarities and assert the
    threshold behaviour without calling the real Google API.
    """
    import math

    v = [0.0] * 768
    v[0] = similarity
    v[1] = math.sqrt(max(0.0, 1.0 - similarity * similarity))
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
    # WARNING logged with exception type (no PII). The log name is
    # `search_embedding_failed` (distinct from `search_vector_query_failed`
    # which would mean the SQL side failed, not the external API).
    assert any(
        "search_embedding_failed" in rec.message
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


def test_hybrid_search_combined_score_within_epsilon(db_session: Session) -> None:
    # Pin the merge math: observe each side's score directly, then verify
    # the response's combined score equals FTS_WEIGHT * fts + VECTOR_WEIGHT
    # * vec to within a small epsilon. Satisfies AC #9's
    # "score-ordering-correctness … to within a small epsilon".
    from src.services import search_service

    todo = _seed_todo(
        db_session,
        "Review Q2 roadmap",
        embedding=_vec(3),
        embedding_status="complete",
    )
    query_vec = _vec(3)  # cosine similarity 1.0 against _vec(3)

    fts_map = search_service._run_fts(db_session, "review")
    vec_map = search_service._run_vector(db_session, query_vec)

    assert todo.id in fts_map
    assert todo.id in vec_map
    _, fts_normalised = fts_map[todo.id]
    _, vec_sim = vec_map[todo.id]

    expected_score = (
        search_service.FTS_WEIGHT * fts_normalised
        + search_service.VECTOR_WEIGHT * vec_sim
    )

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=query_vec,
    ):
        resp = search_service.hybrid_search(db_session, "review")

    assert len(resp.results) == 1
    assert resp.results[0].todo.id == todo.id
    assert resp.results[0].match_type == "hybrid"
    assert resp.results[0].score == pytest.approx(expected_score, abs=1e-4)


def test_hybrid_search_tie_break_deterministic_by_id(
    db_session: Session,
) -> None:
    # Two todos with identical text (→ identical fts_score) and no
    # embeddings; vector branch contributes nothing so combined scores
    # are equal. created_at also sorts equal when rows are inserted in
    # the same second under the server-default. Tertiary id tie-break
    # must yield deterministic order across repeated invocations.
    # (Using "xylophone" not "same" — the latter is a Postgres English
    # stopword and is stripped by websearch_to_tsquery.)
    from src.services import search_service

    todo_a = _seed_todo(db_session, "xylophone widget")
    todo_b = _seed_todo(db_session, "xylophone widget")

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(99),
    ):
        resp1 = search_service.hybrid_search(db_session, "xylophone")
        resp2 = search_service.hybrid_search(db_session, "xylophone")

    # Both responses must be in the exact same order, regardless of
    # insertion order or internal set/dict ordering.
    ids1 = [r.todo.id for r in resp1.results]
    ids2 = [r.todo.id for r in resp2.results]
    assert ids1 == ids2
    assert {todo_a.id, todo_b.id} == set(ids1)


def test_hybrid_search_echoes_raw_query_input(db_session: Session) -> None:
    # SearchResponse.query must mirror the client's raw input, including
    # any leading/trailing whitespace, so the UI's "results for <X>" label
    # matches what the user typed.
    from src.services import search_service

    _seed_todo(db_session, "Review Q2 roadmap")

    raw = "  review  "
    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(0),
    ):
        resp = search_service.hybrid_search(db_session, raw)

    assert resp.query == raw  # NOT stripped


def test_hybrid_search_fts_unsupported_for_stopwords_only(
    db_session: Session,
) -> None:
    # Postgres English stopwords produce an empty tsquery; response must
    # flag fts_supported=False so the client can distinguish "no matches"
    # from "your query had no searchable terms".
    from src.services import search_service

    _seed_todo(db_session, "Review Q2 roadmap")

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(42),
    ):
        resp = search_service.hybrid_search(db_session, "the and of")

    assert resp.fts_supported is False


def test_hybrid_search_fts_supported_true_for_real_word(
    db_session: Session,
) -> None:
    from src.services import search_service

    _seed_todo(db_session, "Review Q2 roadmap")

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(0),
    ):
        resp = search_service.hybrid_search(db_session, "review")

    assert resp.fts_supported is True


@pytest.mark.parametrize(
    "similarity,expected_in_results",
    [
        (0.30, False),  # deep noise — far below floor
        (0.50, False),  # mid-noise band
        (0.54, False),  # EXACT value observed on live "create" vs. "buy groceries"
        (0.58, False),  # noise-ceiling observed on gemini-embedding-001
        (0.59, False),  # boundary — just below threshold (0.60)
        (0.61, True),  # boundary — just above threshold
        (0.70, True),  # plausibly-related
        (0.95, True),  # near-identical
    ],
)
def test_hybrid_search_vector_threshold_boundary(
    db_session: Session,
    similarity: float,
    expected_in_results: bool,
) -> None:
    # Regression guard for the live "create matches every lily pad"
    # bug. Seeds a todo whose text has NO overlap with the query, and
    # whose embedding has EXACT cosine similarity to the query-embed
    # at the value under test. The only way the todo can surface is
    # via the vector branch — so this test pins which similarities
    # pass MIN_VECTOR_SIMILARITY and which get filtered.
    #
    # If a future refactor lowers the floor below 0.60, the 0.54 /
    # 0.58 / 0.59 cases will start returning True and fail here
    # BEFORE the bug reaches the UI. If the floor is raised above
    # 0.61, the 0.61 case fails, surfacing that real matches are
    # being dropped.
    from src.services import search_service

    todo = _seed_todo(
        db_session,
        "completely unrelated text",
        embedding=_vec_with_similarity_to_ref(similarity),
        embedding_status="complete",
    )

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(0),  # `_vec_with_similarity_to_ref` is tuned against this
    ):
        resp = search_service.hybrid_search(db_session, "zzzzzzz")

    if expected_in_results:
        assert len(resp.results) == 1
        assert resp.results[0].todo.id == todo.id
        assert resp.results[0].match_type == "semantic"
    else:
        assert resp.results == [], (
            f"similarity={similarity} should be below the threshold and "
            f"filtered out, but {len(resp.results)} result(s) came back"
        )


def test_hybrid_search_noise_scenario_three_unrelated_todos(
    db_session: Session,
) -> None:
    # Direct regression guard for the exact situation the user hit:
    # three todos, none of which have any textual or semantic
    # relationship to the query, but whose gemini-embedding-001
    # cosine similarities to the query happen to sit in the 0.5-0.6
    # noise band (a quirk of the model — short English phrases pack
    # into a narrow embedding cone).
    #
    # Before the MIN_VECTOR_SIMILARITY floor was introduced AND tuned
    # to 0.60, all three surfaced as matches on the pond. This test
    # asserts the correct behaviour: all three get filtered, the UI
    # goes quiet, the user sees "no matches" via the empty response.
    from src.services import search_service

    _seed_todo(
        db_session,
        "buy groceries today",
        embedding=_vec_with_similarity_to_ref(0.54),  # ← the real value
        embedding_status="complete",
    )
    _seed_todo(
        db_session,
        "finish the todo app before the end of the month",
        embedding=_vec_with_similarity_to_ref(0.53),
        embedding_status="complete",
    )
    _seed_todo(
        db_session,
        "pick up the dry cleaning",
        embedding=_vec_with_similarity_to_ref(0.42),
        embedding_status="complete",
    )

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(0),
    ):
        resp = search_service.hybrid_search(db_session, "create")

    assert resp.results == [], (
        "Three unrelated todos with similarities in the noise band "
        "(0.42, 0.53, 0.54) should all be filtered — they are "
        "completely unrelated to the query 'create'. If they come "
        "back as matches, the pond UI surfaces every lily pad and "
        "the user sees false positives (reported live on 2026-04-21)."
    )


def test_hybrid_search_keyword_match_survives_below_vector_floor(
    db_session: Session,
) -> None:
    # An FTS-only hit must still surface even when the same row's
    # embedding similarity is below the vector floor. The vector
    # filter only affects the vector branch; the keyword branch is
    # independent. Without this guard, a future refactor that unified
    # the filters could silently drop keyword matches.
    from src.services import search_service

    todo = _seed_todo(
        db_session,
        "create a wireframe for the new feature",  # `create` keyword match
        embedding=_vec_with_similarity_to_ref(0.40),  # below floor — noise
        embedding_status="complete",
    )

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(0),
    ):
        resp = search_service.hybrid_search(db_session, "create")

    assert len(resp.results) == 1
    assert resp.results[0].todo.id == todo.id
    # Vector branch contributed nothing (below floor) → keyword-only.
    assert resp.results[0].match_type == "keyword"


def test_hybrid_search_semantic_and_keyword_rank_correctly(
    db_session: Session,
) -> None:
    # End-to-end ranking sanity check with a realistic mix:
    #
    #   - strong_keyword   : text contains "create", similarity 0.40 (below floor)
    #                        → keyword-only match
    #   - strong_semantic  : no word overlap, similarity 0.80 (strong)
    #                        → semantic-only match, very high score
    #   - weak_noise       : no word overlap, similarity 0.55 (noise)
    #                        → FILTERED (below floor)
    #
    # Expected order:
    #   strong_semantic ranks FIRST (0.7 * 0.80 = 0.56)
    #   strong_keyword  ranks SECOND (0.3 * something < 0.30)
    #   weak_noise      is absent
    from src.services import search_service

    strong_keyword = _seed_todo(
        db_session,
        "create a wireframe",
        embedding=_vec_with_similarity_to_ref(0.40),
        embedding_status="complete",
    )
    strong_semantic = _seed_todo(
        db_session,
        "make a new design",
        embedding=_vec_with_similarity_to_ref(0.80),
        embedding_status="complete",
    )
    _seed_todo(
        db_session,
        "buy groceries today",
        embedding=_vec_with_similarity_to_ref(0.55),
        embedding_status="complete",
    )

    with patch(
        "src.services.search_service.embedding_service.generate_embedding",
        return_value=_vec(0),
    ):
        resp = search_service.hybrid_search(db_session, "create")

    result_ids = [r.todo.id for r in resp.results]
    assert strong_semantic.id in result_ids, "strong-semantic should survive"
    assert strong_keyword.id in result_ids, "keyword-only hit should survive"
    assert len(resp.results) == 2, (
        f"noise todo (similarity 0.55) must be filtered — only 2 hits expected, "
        f"got {len(resp.results)}"
    )
    assert resp.results[0].todo.id == strong_semantic.id, (
        "semantic at 0.80 (score 0.56) must rank above keyword-only (score < 0.30)"
    )
    assert resp.results[0].match_type == "semantic"
    assert resp.results[1].match_type == "keyword"


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
