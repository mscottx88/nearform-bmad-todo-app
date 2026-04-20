from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import AfterValidator
from pydantic_core import PydanticCustomError
from sqlalchemy.orm import Session

from src.database import get_db
from src.schemas.search import SearchResponse
from src.services import search_service


def _non_whitespace(value: str) -> str:
    # pydantic's min_length=1 lets a bare space through; this guard turns
    # `?q=%20` into a 422 with the standard validation_error envelope.
    # Using PydanticCustomError (not ValueError) so the error context
    # stays JSON-serialisable when the global validation_error_handler
    # calls `exc.errors()`. Using a custom code (not "value_error") so
    # the frontend can render a specific "please enter a search term"
    # message distinct from other generic validation failures.
    if not value.strip():
        raise PydanticCustomError("query_blank", "Query cannot be empty")
    return value


QParam = Annotated[
    str,
    Query(min_length=1, max_length=500),
    AfterValidator(_non_whitespace),
]


router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("", response_model=SearchResponse)
def search(
    q: QParam,
    db: Session = Depends(get_db),
) -> SearchResponse:
    return search_service.hybrid_search(db, q)
