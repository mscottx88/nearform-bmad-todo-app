import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CreatureCreate(BaseModel):
    todo_id: uuid.UUID
    creature_type: str = Field(min_length=1, max_length=50)
    rarity: str = Field(min_length=1, max_length=20)


class CreatureResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    todo_id: uuid.UUID | None
    creature_type: str
    rarity: str
    created_at: datetime
