import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ChatSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str | None
    created_at: datetime
    updated_at: datetime


class ChatMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    session_id: uuid.UUID
    role: str
    content: str
    skill: str | None
    metadata: dict[str, Any] = Field(alias="metadata_", default_factory=dict)
    status: str
    error: str | None
    created_at: datetime


class ChatRequestContext(BaseModel):
    todo_ids: list[uuid.UUID] = Field(default_factory=list)


class ChatRequest(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    skill: str | None = None
    context: ChatRequestContext = Field(default_factory=ChatRequestContext)
