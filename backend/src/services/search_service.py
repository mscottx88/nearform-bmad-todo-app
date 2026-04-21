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
import math
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

# Per-request HTTP timeout for the query-embedding call on the search
# path. The background worker keeps the service's 15 s default because
# retries give it headroom; the search path is a single-shot call where
# the user is actively waiting, so we bound at 1.5 s and gracefully fall
# back to FTS-only if Google is slow.
SEARCH_EMBED_TIMEOUT_MS = 1_500


def hybrid_search(db: Session, query_text: str) -> SearchResponse:
    q = query_text.strip()
    if not q:
        raise ValueError("Query cannot be empty")

    # Detect empty tsquery up-front (stop-words only, emoji-only, etc.)
    # so we can (a) skip the FTS SQL entirely and (b) tell the client the
    # FTS branch contributed nothing because the query was unparseable,
    # distinct from "FTS ran and found no matches".
    fts_supported = _fts_supported(db, q)
    fts_map = _run_fts(db, q) if fts_supported else {}

    vector_unavailable = False
    vec_map: dict[uuid.UUID, tuple[Todo, float]] = {}
    # Split try blocks so the two failure domains (embedding service vs.
    # pgvector/SQL) log distinctly — otherwise a DB error inside _run_vector
    # is mis-attributed to the external embedding service in operator logs.
    # Do NOT log `q` (potential PII); log exception metadata only, same
    # enriched format as embedding_worker for grep-ability.
    query_vec: list[float] | None = None
    try:
        query_vec = embedding_service.generate_embedding(
            q,
            timeout_ms=SEARCH_EMBED_TIMEOUT_MS,
        )
    except Exception as exc:  # noqa: BLE001 - any embedding failure → FTS-only
        logger.warning(
            "search_embedding_failed exc=%s code=%s status=%s",
            type(exc).__name__,
            getattr(exc, "code", "?"),
            getattr(exc, "status", "?"),
        )
        vector_unavailable = True

    if query_vec is not None:
        try:
            vec_map = _run_vector(db, query_vec)
        except Exception as exc:  # noqa: BLE001 - pgvector/SQL failure → FTS-only
            # Rollback to clear any half-applied transaction state before
            # the session returns to the pool; otherwise the next request
            # on this connection sees PendingRollbackError.
            db.rollback()
            logger.warning(
                "search_vector_query_failed exc=%s",
                type(exc).__name__,
            )
            vector_unavailable = True

    results = _merge(fts_map, vec_map)
    # Echo the CLIENT's input (pre-strip) so the UI can render "results
    # for X" without diverging from what the user actually typed.
    return SearchResponse(
        query=query_text,
        results=results,
        vector_search_unavailable=vector_unavailable,
        fts_supported=fts_supported,
    )


def _fts_supported(db: Session, q: str) -> bool:
    """True if `websearch_to_tsquery('english', q)` produces a non-empty tsquery.

    Postgres `numnode` counts the nodes in the parsed tsquery; stop-words,
    emoji, punctuation, and non-English tokens produce an empty tsquery
    (numnode=0) that silently matches nothing. Checking up-front lets us
    skip the FTS SQL AND tell the client why the FTS branch was empty.
    """
    row = db.execute(
        text("SELECT numnode(websearch_to_tsquery('english', :q)) AS n"),
        {"q": q},
    ).scalar()
    return bool((row or 0) > 0)


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
    # Defence-in-depth: re-apply the active-row filter on ORM re-fetch so
    # a concurrent soft-delete/complete/archive between the two queries
    # can't resurface a tombstoned row.
    todos = (
        db.query(Todo)
        .filter(
            Todo.id.in_(ids_to_raw.keys()),
            Todo.deleted == False,  # noqa: E712
            Todo.completed == False,  # noqa: E712
            Todo.archived == False,  # noqa: E712
        )
        .all()
    )

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
    # Same defence-in-depth filter as _run_fts.
    todos = (
        db.query(Todo)
        .filter(
            Todo.id.in_(ids_to_sim.keys()),
            Todo.deleted == False,  # noqa: E712
            Todo.completed == False,  # noqa: E712
            Todo.archived == False,  # noqa: E712
        )
        .all()
    )

    out: dict[uuid.UUID, tuple[Todo, float]] = {}
    for todo in todos:
        raw_sim = ids_to_sim[todo.id]
        # NaN/Infinity guard — Python's max/min propagate NaN through
        # `a if a >= b else b`, so clamping alone can't sanitise. A
        # corrupt vector would otherwise trip `Field(ge=0.0, le=1.0)`
        # as a 500 downstream.
        if not math.isfinite(raw_sim):
            logger.warning(
                "search_non_finite_similarity todo_id=%s",
                todo.id,
            )
            continue
        # Cosine similarity is natively in [-1, 1]; clamp negatives to 0
        # so the downstream Field constraint always holds even on
        # pathological embeddings.
        sim = max(0.0, min(1.0, raw_sim))
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

    # Sort by score desc, tie-break by created_at desc, then todo.id desc.
    # The id tertiary key keeps ordering deterministic when rows share
    # BOTH score and created_at (e.g., bulk-inserted demo data sharing a
    # single server-default now() timestamp).
    scored.sort(key=lambda t: (t[1], t[0].created_at, t[0].id), reverse=True)
    top = scored[:RESULT_LIMIT]

    return [
        SearchResult(
            todo=TodoResponse.model_validate(todo),
            score=score,
            match_type=match_type,
        )
        for (todo, score, match_type) in top
    ]
