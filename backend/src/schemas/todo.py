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
    # No max length — the DB column is `TEXT` (unbounded) and users
    # legitimately want long todos (e.g. LLM-rewritten role-play
    # narratives, embedded checklists, mission scripts). The
    # min_length=1 + whitespace-only validator still reject empty
    # text. Embedding model token cap is handled by the embedding
    # worker, not here.
    text: str = Field(min_length=1)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    position_x: float | None = None
    position_y: float | None = None
    due_date: datetime | None = None

    _validate_text = field_validator("text")(_not_whitespace_only)


class TodoUpdate(BaseModel):
    # Story 6.3 AC 7: defence in depth on the LLM mutation surface.
    # The PATCH /api/todos/{id} route is what `RephraseProposal.tsx`
    # fires when the user clicks Accept on a rephrase suggestion. The
    # LLM picks the `field` slot, so a hallucinated or malicious
    # field name (e.g. `id`, `created_at`) must be rejected with 422
    # before any service code runs. Pydantic v2 raises
    # `ValidationError(type='extra_forbidden')` on any unknown key.
    model_config = ConfigDict(extra="forbid")

    # No max length — see note on TodoCreate.text. The DB column is
    # `TEXT`; rephrase-skill rewrites can exceed 1000 chars (mission
    # narratives, structured checklists). min_length=1 + the
    # whitespace-only validator below still reject empty/blank text.
    text: str | None = Field(default=None, min_length=1)
    completed: bool | None = None
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    position_x: float | None = None
    position_y: float | None = None
    # Story 6.3 user-driven enhancement: real due_date column. The
    # rephrase skill suggests this field when the user supplies a date.
    # Pydantic accepts ISO 8601 date strings ("2026-05-01") and
    # date instances; `None` clears the field.
    due_date: datetime | None = None

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
    # Story 6.3: optional deadline (date + time, timezone-aware).
    # Surfaces in the InfoPopup with a clickable NeonDateTimePicker
    # and is the target of the rephrase skill's `due_date` field
    # suggestions.
    due_date: datetime | None
    embedding_status: str
    archived: bool
    archived_at: datetime | None
    display_metadata: dict[str, Any] = Field(default_factory=dict)
    deleted: bool
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime
