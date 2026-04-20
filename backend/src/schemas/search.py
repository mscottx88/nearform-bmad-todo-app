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
