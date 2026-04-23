import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError


def _not_whitespace_only(value: str) -> str:
    # min_length=1 lets `"   "` through; reject whitespace-only text so
    # it doesn't reach the embedding API (3 retries of junk) or render
    # as a blank pad on the pond. PydanticCustomError (not ValueError)
    # keeps the error context JSON-serialisable — the global
    # validation_error_handler calls `exc.errors()` which otherwise
    # leaks a raw ValueError instance.
    if not value.strip():
        raise PydanticCustomError("text_blank", "text cannot be blank or whitespace-only")
    return value


class TodoCreate(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    position_x: float | None = None
    position_y: float | None = None

    _validate_text = field_validator("text")(_not_whitespace_only)


class TodoUpdate(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=1000)
    completed: bool | None = None
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    position_x: float | None = None
    position_y: float | None = None

    @field_validator("text")
    @classmethod
    def _validate_text(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return _not_whitespace_only(value)


class TodoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    text: str
    completed: bool
    color: str
    position_x: float | None
    position_y: float | None
    embedding_status: str
    archived: bool
    archived_at: datetime | None
    deleted: bool
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    # Story 4.6: optional group membership. Populated via the
    # list_todos outer-join against group_memberships; null for
    # solo pads. The Todo ORM model itself has no group_id column
    # (membership lives in the separate join table) so this field
    # is ALWAYS set explicitly by the service — pydantic's
    # from_attributes mode does NOT auto-populate it.
    group_id: uuid.UUID | None = None
    # Story 4.6 (user feedback 2026-04-23): piggyback the group's
    # label and color onto each member so the frontend can rebuild
    # `groupLabels` / `groupColors` on refresh without needing a
    # separate GET /api/groups. Null for solo pads (no group row
    # joined) or when the group's label/color is itself null. The
    # service's outerjoin on Group populates these; solo pads leave
    # them null.
    group_label: str | None = None
    group_color: str | None = None
