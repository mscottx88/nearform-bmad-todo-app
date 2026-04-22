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
from sqlalchemy import and_, bindparam, or_, text
from sqlalchemy.orm import Query, Session
from sqlalchemy.sql.elements import ColumnElement

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

# Minimum vector cosine similarity to accept as a match. Without this
# floor, pgvector's k-NN ordering returns the top N NEAREST rows
# unconditionally — including weakly-related and unrelated todos —
# which on a small pond (<50 todos) surfaces every row as a match.
#
# Empirically tuned for `gemini-embedding-001` at 768 dims: the model
# produces unusually tight embeddings for short English phrases, so
# two completely unrelated 3-word todos commonly land at 0.50–0.55
# cosine similarity. A floor of 0.60 sits just above that noise
# ceiling (observed via live smoke test: "create" vs. "buy groceries
# today" scored 0.54) while staying below the threshold for
# plausibly-related pairs like "review Q2 roadmap" vs. "quarterly
# retrospective" (0.70+). If usage data later shows real matches
# being dropped, lower to 0.55; if noise still leaks through, raise
# to 0.65. This floor is model-specific — a switch to a sentence-
# transformer-style model with a wider similarity distribution would
# want a much lower value.
MIN_VECTOR_SIMILARITY = 0.60

# Per-request HTTP timeout for the query-embedding call on the search
# path. The background worker keeps the service's 15 s default because
# retries give it headroom; the search path is a single-shot call where
# the user is actively waiting, so we bound at 1.5 s and gracefully fall
# back to FTS-only if Google is slow.
SEARCH_EMBED_TIMEOUT_MS = 1_500


def hybrid_search(
    db: Session,
    query_text: str,
    include_active: bool = True,
    include_completed: bool = False,
    include_deleted: bool = False,
) -> SearchResponse:
    # Story 3.3: search matches every currently-visible pad per the
    # user's visibility flags. Defaults (active-only) preserve the
    # pre-3.3 contract. When all three flags are false the result is
    # trivially empty — no SQL needed.
    q = query_text.strip()
    if not q:
        raise ValueError("Query cannot be empty")

    # Detect empty tsquery up-front (stop-words only, emoji-only, etc.)
    # so we can (a) skip the FTS SQL entirely and (b) tell the client the
    # FTS branch contributed nothing because the query was unparseable,
    # distinct from "FTS ran and found no matches".
    fts_supported = _fts_supported(db, q)
    fts_map = (
        _run_fts(db, q, include_active, include_completed, include_deleted)
        if fts_supported
        else {}
    )

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
            vec_map = _run_vector(
                db,
                query_vec,
                include_active,
                include_completed,
                include_deleted,
            )
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

    On DB failure (missing text-search config, locale drift, transient
    Postgres hiccup) we fall back to `False` and let the vector/embedding
    branch carry on — better a partial result than a 500. Rollback clears
    any half-applied transaction state so the next SQL on this session
    doesn't hit PendingRollbackError.
    """
    try:
        row = db.execute(
            text("SELECT numnode(websearch_to_tsquery('english', :q)) AS n"),
            {"q": q},
        ).scalar()
    except Exception as exc:  # noqa: BLE001 - any DB failure → FTS-unavailable
        db.rollback()
        logger.warning(
            "search_fts_supported_failed exc=%s",
            type(exc).__name__,
        )
        return False
    return bool((row or 0) > 0)


def _visibility_sql_clause(
    include_active: bool,
    include_completed: bool,
    include_deleted: bool,
) -> str:
    # Story 3.3: translate the visibility triple into a SQL fragment
    # compatible with both `_run_fts` and `_run_vector`. The `archived`
    # pre-filter stays outside so archived rows are never surfaced.
    # Empty triple returns `false` so the enclosing query is trivially
    # empty without an "always false" hack.
    parts: list[str] = []
    if include_active:
        parts.append("(completed = false AND deleted = false)")
    if include_completed:
        parts.append("completed = true")
    if include_deleted:
        parts.append("deleted = true")
    if not parts:
        return "false"
    return "(" + " OR ".join(parts) + ")"


def _run_fts(
    db: Session,
    q: str,
    include_active: bool,
    include_completed: bool,
    include_deleted: bool,
) -> dict[uuid.UUID, tuple[Todo, float]]:
    # ts_rank_cd is in [0, ∞); `x / (1 + x)` squashes to [0, 1). Keeps
    # the FTS branch's score in the same [0, 1] scale as cosine similarity
    # so the weighted merge is meaningful.
    visibility = _visibility_sql_clause(
        include_active, include_completed, include_deleted
    )
    # S608 false positive: `visibility` is a closed enum of SQL fragments
    # produced locally from three booleans — never user input. The
    # query parameter that COULD contain user input (`q`) is bound via
    # `:q`, not interpolated.
    stmt = text(f"""
        SELECT id,
               ts_rank_cd(
                   to_tsvector('english', text),
                   websearch_to_tsquery('english', :q)
               ) AS fts_score
          FROM todos
         WHERE to_tsvector('english', text) @@ websearch_to_tsquery('english', :q)
           AND archived = false
           AND {visibility}
         ORDER BY fts_score DESC
         LIMIT :max_candidates
    """)  # noqa: S608
    rows = db.execute(
        stmt,
        {"q": q, "max_candidates": MAX_CANDIDATES_PER_SIDE},
    ).all()

    if not rows:
        return {}

    ids_to_raw: dict[uuid.UUID, float] = {row.id: float(row.fts_score) for row in rows}
    # Defence-in-depth ORM re-fetch. `archived == False` always holds;
    # the visibility-triple filter is reapplied dynamically below.
    query = db.query(Todo).filter(
        Todo.id.in_(ids_to_raw.keys()),
        Todo.archived == False,  # noqa: E712
    )
    query = _apply_visibility_orm_filter(
        query, include_active, include_completed, include_deleted
    )
    todos = query.all()

    out: dict[uuid.UUID, tuple[Todo, float]] = {}
    for todo in todos:
        raw = ids_to_raw[todo.id]
        normalised = raw / (1.0 + raw)
        out[todo.id] = (todo, normalised)
    return out


def _apply_visibility_orm_filter(
    query: "Query[Todo]",
    include_active: bool,
    include_completed: bool,
    include_deleted: bool,
) -> "Query[Todo]":
    # Mirror of `_visibility_sql_clause` but as SQLAlchemy ORM filters —
    # used for the defence-in-depth re-fetch step after raw SQL returns
    # candidate ids.
    clauses: list[ColumnElement[bool]] = []
    if include_active:
        clauses.append(
            and_(
                Todo.completed == False,  # noqa: E712
                Todo.deleted == False,  # noqa: E712
            )
        )
    if include_completed:
        clauses.append(Todo.completed == True)  # noqa: E712
    if include_deleted:
        clauses.append(Todo.deleted == True)  # noqa: E712
    if not clauses:
        # No visibility flag set → force an always-false filter so the
        # re-fetch returns zero rows deterministically.
        return query.filter(text("false"))
    return query.filter(or_(*clauses))


def _run_vector(
    db: Session,
    query_vec: list[float],
    include_active: bool,
    include_completed: bool,
    include_deleted: bool,
) -> dict[uuid.UUID, tuple[Todo, float]]:
    # `embedding <=> :query_vec` in ORDER BY is what triggers the HNSW
    # index. Aliasing and ordering by the aliased column would
    # sequential-scan.
    visibility = _visibility_sql_clause(
        include_active, include_completed, include_deleted
    )
    # S608 false positive: `visibility` is a closed enum of SQL fragments
    # produced locally from three booleans — never user input. The only
    # external value here is the embedding vector, which is bound via
    # :query_vec.
    stmt = text(f"""
        SELECT id,
               1 - (embedding <=> :query_vec) AS similarity
          FROM todos
         WHERE embedding IS NOT NULL
           AND embedding_status = 'complete'
           AND archived = false
           AND {visibility}
         ORDER BY embedding <=> :query_vec
         LIMIT :max_candidates
    """).bindparams(bindparam("query_vec", type_=Vector(768)))  # noqa: S608

    rows = db.execute(
        stmt,
        {"query_vec": query_vec, "max_candidates": MAX_CANDIDATES_PER_SIDE},
    ).all()

    if not rows:
        return {}

    # Drop rows below the MIN_VECTOR_SIMILARITY floor. pgvector's k-NN
    # returns the top N NEAREST rows regardless of how weak that
    # "nearest" actually is — on a small corpus this surfaces every
    # embedded todo as a weak match. Post-filtering in Python
    # preserves HNSW index usage (the ORDER BY stays untouched) while
    # cutting noise before merge. Applied here, not at the SQL WHERE
    # clause, to avoid defeating the HNSW planner.
    ids_to_sim: dict[uuid.UUID, float] = {
        row.id: float(row.similarity)
        for row in rows
        if float(row.similarity) >= MIN_VECTOR_SIMILARITY
    }
    if not ids_to_sim:
        return {}
    # Same defence-in-depth filter as _run_fts.
    query = db.query(Todo).filter(
        Todo.id.in_(ids_to_sim.keys()),
        Todo.archived == False,  # noqa: E712
    )
    query = _apply_visibility_orm_filter(
        query, include_active, include_completed, include_deleted
    )
    todos = query.all()

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
