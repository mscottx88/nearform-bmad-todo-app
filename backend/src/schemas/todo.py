import uuid
from datetime import datetime
from typing import Any

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


class TodoPositionEntry(BaseModel):
    """Single pad's new position + rotation in a batch update.

    Story 4-8: part of the `PATCH /api/todos/positions` batch body.
    All fields are required. 2026-04-23: rotation_y is now part of
    the batch so pushed-aside pads persist their cascade-rotated
    facing direction. The dragger sends its CURRENT rotation (no
    change). Each cascaded sibling sends the rotation it lerped to
    during the push.
    """

    id: uuid.UUID
    position_x: float
    position_y: float
    rotation_y: float


class TodoPositionsUpdate(BaseModel):
    """Batch position update body.

    Story 4-8: `min_length=1` rejects empty batches (no reason to hit
    the endpoint with nothing to do); `max_length=500` caps the
    payload against pathological requests (current largest expected
    batch is a full pond of ~30 pads after a drag release + cascade).
    """

    positions: list[TodoPositionEntry] = Field(min_length=1, max_length=500)


class TodoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    text: str
    completed: bool
    color: str
    position_x: float | None
    position_y: float | None
    # 2026-04-23: server-assigned Y rotation (radians). Initial value
    # is random at insert; cascade-driven rotation updates persist via
    # the batch position endpoint.
    rotation_y: float
    # 2026-04-23: server-assigned random drift phase. Write-once —
    # stable across reloads so ambient motion stays consistent.
    drift_seed: float
    embedding_status: str
    archived: bool
    archived_at: datetime | None
    display_metadata: dict[str, Any] = Field(default_factory=dict)
    deleted: bool
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime
