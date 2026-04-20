"""Hybrid full-text + vector search over todos.

Runs two SQL queries per request and merges them in Python:

1. Postgres full-text via `websearch_to_tsquery` against the GIN index
   on `to_tsvector('english', text)` (created in Epic 1's initial
   migration as `ix_todos_text_search`).
2. pgvector cosine similarity via the `<=>` operator against the HNSW
   index `ix_todos_embedding` (built with `vector_cosine_ops`).

Query-side embedding reuses `embedding_service.generate_embedding` from
Story 5.1. On ANY failure from that call (api-key-missing, HTTP
timeout, `ClientError`, malformed response), the endpoint falls back to
FTS-only results with `vector_search_unavailable=True`. No retries on
the search path — the user is waiting synchronously.

Thread-based only — async/await prohibited (see CLAUDE.md).
"""

import logging
import uuid
from typing import cast

from pgvector.sqlalchemy import Vector
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from src.models.todo import Todo
from src.schemas.search import MatchType, SearchResponse, SearchResult
from src.schemas.todo import TodoResponse
from src.services import embedding_service

logger = logging.getLogger(__name__)

# Weighted merge: FTS contribution caps at FTS_WEIGHT (pure-keyword tops
# at 0.3); pure-semantic tops at VECTOR_WEIGHT (0.7); both sides hitting
# can reach ~0.95. Tune only with real usage data.
FTS_WEIGHT = 0.3
VECTOR_WEIGHT = 0.7

# Per-side candidate pool. Must be ≥ RESULT_LIMIT so the merged top-N is
# drawn from a wide enough pool; not so large that the HNSW scan gets
# expensive on big datasets.
MAX_CANDIDATES_PER_SIDE = 50

# Client-facing result cap. The pond UI (Story 5.3) surfaces/submerges
# ≤ ~30 pads at once; 20 is plenty.
RESULT_LIMIT = 20


def hybrid_search(db: Session, query_text: str) -> SearchResponse:
    q = query_text.strip()
    if not q:
        raise ValueError("Query cannot be empty")

    fts_map = _run_fts(db, q)

    vector_unavailable = False
    vec_map: dict[uuid.UUID, tuple[Todo, float]] = {}
    try:
        query_vec = embedding_service.generate_embedding(q)
        vec_map = _run_vector(db, query_vec)
    except Exception as exc:  # noqa: BLE001 - any failure → FTS-only fallback
        # Do NOT log `q` (potential PII). Log exception metadata only,
        # same enriched format as the embedding worker for grep-ability.
        logger.warning(
            "search_vector_unavailable exc=%s code=%s status=%s",
            type(exc).__name__,
            getattr(exc, "code", "?"),
            getattr(exc, "status", "?"),
        )
        vector_unavailable = True

    results = _merge(fts_map, vec_map)
    return SearchResponse(
        query=q,
        results=results,
        vector_search_unavailable=vector_unavailable,
    )


def _run_fts(db: Session, q: str) -> dict[uuid.UUID, tuple[Todo, float]]:
    # ts_rank_cd is in [0, ∞); `x / (1 + x)` squashes to [0, 1). Keeps
    # the FTS branch's score in the same [0, 1] scale as cosine similarity
    # so the weighted merge is meaningful.
    stmt = text("""
        SELECT id,
               ts_rank_cd(
                   to_tsvector('english', text),
                   websearch_to_tsquery('english', :q)
               ) AS fts_score
          FROM todos
         WHERE to_tsvector('english', text) @@ websearch_to_tsquery('english', :q)
           AND deleted = false
           AND completed = false
           AND archived = false
         ORDER BY fts_score DESC
         LIMIT :max_candidates
    """)
    rows = db.execute(
        stmt,
        {"q": q, "max_candidates": MAX_CANDIDATES_PER_SIDE},
    ).all()

    if not rows:
        return {}

    ids_to_raw: dict[uuid.UUID, float] = {row.id: float(row.fts_score) for row in rows}
    todos = db.query(Todo).filter(Todo.id.in_(ids_to_raw.keys())).all()

    out: dict[uuid.UUID, tuple[Todo, float]] = {}
    for todo in todos:
        raw = ids_to_raw[todo.id]
        normalised = raw / (1.0 + raw)
        out[todo.id] = (todo, normalised)
    return out


def _run_vector(
    db: Session,
    query_vec: list[float],
) -> dict[uuid.UUID, tuple[Todo, float]]:
    # `embedding <=> :query_vec` in ORDER BY is what triggers the HNSW
    # index. Aliasing and ordering by the aliased column would
    # sequential-scan.
    stmt = text("""
        SELECT id,
               1 - (embedding <=> :query_vec) AS similarity
          FROM todos
         WHERE embedding IS NOT NULL
           AND embedding_status = 'complete'
           AND deleted = false
           AND completed = false
           AND archived = false
         ORDER BY embedding <=> :query_vec
         LIMIT :max_candidates
    """).bindparams(bindparam("query_vec", type_=Vector(768)))

    rows = db.execute(
        stmt,
        {"query_vec": query_vec, "max_candidates": MAX_CANDIDATES_PER_SIDE},
    ).all()

    if not rows:
        return {}

    ids_to_sim: dict[uuid.UUID, float] = {row.id: float(row.similarity) for row in rows}
    todos = db.query(Todo).filter(Todo.id.in_(ids_to_sim.keys())).all()

    out: dict[uuid.UUID, tuple[Todo, float]] = {}
    for todo in todos:
        # Cosine similarity is natively in [-1, 1]; clamp negatives to 0
        # so the downstream Field(ge=0.0, le=1.0) constraint always
        # holds even on pathological embeddings.
        sim = max(0.0, min(1.0, ids_to_sim[todo.id]))
        out[todo.id] = (todo, sim)
    return out


def _merge(
    fts_map: dict[uuid.UUID, tuple[Todo, float]],
    vec_map: dict[uuid.UUID, tuple[Todo, float]],
) -> list[SearchResult]:
    all_ids = set(fts_map.keys()) | set(vec_map.keys())
    scored: list[tuple[Todo, float, MatchType]] = []
    for todo_id in all_ids:
        fts_entry = fts_map.get(todo_id)
        vec_entry = vec_map.get(todo_id)

        fts_score = fts_entry[1] if fts_entry is not None else 0.0
        vec_score = vec_entry[1] if vec_entry is not None else 0.0

        combined = FTS_WEIGHT * fts_score + VECTOR_WEIGHT * vec_score
        # Clamp to [0, 1] — both terms are already in [0, 1] by
        # construction, but defend against float drift (e.g., 0.7 + 0.3
        # computed in IEEE-754 can yield 1.0000000000000002).
        combined = max(0.0, min(1.0, combined))

        if fts_entry is not None and vec_entry is not None:
            match_type: MatchType = "hybrid"
            todo = fts_entry[0]
        elif fts_entry is not None:
            match_type = "keyword"
            todo = fts_entry[0]
        else:
            match_type = "semantic"
            # Narrowed: vec_entry must be not-None in this branch.
            todo = cast(tuple[Todo, float], vec_entry)[0]

        scored.append((todo, combined, match_type))

    # Sort by score desc, tie-break by created_at desc (most recent first).
    scored.sort(key=lambda t: (t[1], t[0].created_at), reverse=True)
    top = scored[:RESULT_LIMIT]

    return [
        SearchResult(
            todo=TodoResponse.model_validate(todo),
            score=score,
            match_type=match_type,
        )
        for (todo, score, match_type) in top
    ]
