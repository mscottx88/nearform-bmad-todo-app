import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError


def _not_whitespace_only(value: str) -> str:
    """Reject blank or whitespace-only chat content.

    Mirrors the helper in `src.schemas.todo` — kept duplicated rather than
    cross-imported to keep the agent bounded context's schema module free
    of dependencies on the todo bounded context.
    """
    if not value.strip():
        raise PydanticCustomError(
            "content_blank",
            "content cannot be blank or whitespace-only",
        )
    return value


class ChatSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str | None
    created_at: datetime
    updated_at: datetime


class ChatMessageResponse(BaseModel):
    # `from_attributes=True` lets `model_validate(orm_row)` read fields by
    # FIELD NAME from the ORM. The ORM's column attr is `metadata_` (the
    # trailing underscore avoids the SQLAlchemy `Base.metadata` reserved
    # name — writing `orm.metadata` returns the global MetaData registry,
    # NOT the JSONB column). So the Pydantic field must also be named
    # `metadata_`.
    #
    # `serialization_alias="metadata"` (NOT plain `alias=`) makes the JSON
    # wire-key the unprefixed form on output, while leaving the input path
    # untouched. Using `alias=` here would set BOTH validation_alias and
    # serialization_alias, and Pydantic would then prefer `getattr(orm,
    # "metadata")` for reads — which returns `Base.metadata` and fails
    # dict validation. `serialization_alias` alone sidesteps that trap.
    #
    # FastAPI's response_model serialisation defaults to `by_alias=True`,
    # so clients see `{"metadata": {...}}`.
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID
    role: str
    content: str
    skill: str | None
    metadata_: dict[str, Any] = Field(
        serialization_alias="metadata",
        default_factory=dict,
    )
    status: str
    error: str | None
    created_at: datetime


class ChatRequestContext(BaseModel):
    # `max_length` caps the fan-out: any endpoint that consumes these IDs
    # (e.g. a future "rephrase these N todos" skill) won't have to walk an
    # unbounded list before validating.
    todo_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class ChatRequest(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    # DB column is `String(64)` — capping here means an over-long skill
    # name fails Pydantic validation cleanly instead of bubbling up as a
    # `StringDataRightTruncation` 500 from the database driver.
    skill: str | None = Field(default=None, max_length=64)
    context: ChatRequestContext = Field(default_factory=ChatRequestContext)

    _validate_content = field_validator("content")(_not_whitespace_only)

    @field_validator("skill")
    @classmethod
    def _normalise_skill(cls, value: str | None) -> str | None:
        # Deferred from Group D: skill names previously had to be exact
        # lowercase matches with no surrounding whitespace, asymmetric
        # with the whitespace-only validator on `content`. Strip + lower
        # so `"  Chat\n"` and `"chat"` route identically.
        if value is None:
            return None
        cleaned = value.strip().lower()
        # An empty result after stripping is semantically invalid — drop
        # to None so the downstream "skill is None → classifier" path
        # kicks in instead of attempting `SKILL_REGISTRY[""]`.
        return cleaned or None
