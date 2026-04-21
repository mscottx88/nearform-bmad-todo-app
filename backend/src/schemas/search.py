from typing import Literal

from pydantic import BaseModel, Field

from src.schemas.todo import TodoResponse

MatchType = Literal["keyword", "semantic", "hybrid"]


class SearchResult(BaseModel):
    todo: TodoResponse
    score: float = Field(ge=0.0, le=1.0)
    match_type: MatchType


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResult]
    vector_search_unavailable: bool
    # False when `websearch_to_tsquery` returned an empty tsquery — the
    # query was stop-words-only, emoji-only, punctuation-only, or a
    # language the FTS configuration (`english`) does not tokenise. The
    # client can distinguish "your query had no searchable terms" from
    # "no rows matched your query" and render a helpful empty state.
    fts_supported: bool = True
