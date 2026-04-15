import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from src.database import get_db
from src.schemas.creature import CreatureCreate, CreatureResponse
from src.services import creature_service

router = APIRouter(prefix="/api/creatures", tags=["creatures"])


@router.post(
    "",
    response_model=CreatureResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_creature(
    data: CreatureCreate,
    db: Session = Depends(get_db),
) -> CreatureResponse:
    creature = creature_service.create_creature(db, data)
    return CreatureResponse.model_validate(creature)


@router.delete(
    "/todo/{todo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_creature_by_todo(
    todo_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> None:
    creature_service.delete_creature_by_todo(db, todo_id)
