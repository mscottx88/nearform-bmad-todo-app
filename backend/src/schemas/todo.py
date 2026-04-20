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
