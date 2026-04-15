import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class TodoCreate(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    position_x: float | None = None
    position_y: float | None = None


class TodoUpdate(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=1000)
    completed: bool | None = None
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    position_x: float | None = None
    position_y: float | None = None


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
