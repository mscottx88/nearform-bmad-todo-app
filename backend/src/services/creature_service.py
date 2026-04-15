import random
import uuid

from sqlalchemy.orm import Session

from src.exceptions import TodoNotFoundError
from src.models.creature import Creature
from src.models.todo import Todo
from src.schemas.creature import CreatureCreate

COMMON_CREATURES = ["firefly", "water_strider"]


def select_rarity() -> tuple[str, str]:
    """Select a random creature type and rarity. Currently common only."""
    creature_type = random.choice(COMMON_CREATURES)  # noqa: S311
    return creature_type, "common"


def create_creature(db: Session, data: CreatureCreate) -> Creature:
    """Create a creature linked to a todo."""
    todo = (
        db.query(Todo)
        .filter(Todo.id == data.todo_id, Todo.deleted == False)  # noqa: E712
        .first()
    )
    if not todo:
        raise TodoNotFoundError(str(data.todo_id))

    creature = Creature(
        todo_id=data.todo_id,
        creature_type=data.creature_type,
        rarity=data.rarity,
    )
    db.add(creature)
    db.commit()
    db.refresh(creature)
    return creature


def get_creature_by_todo(
    db: Session,
    todo_id: uuid.UUID,
) -> Creature | None:
    """Get creature linked to a todo, or None."""
    return db.query(Creature).filter(Creature.todo_id == todo_id).first()


def delete_creature_by_todo(
    db: Session,
    todo_id: uuid.UUID,
) -> None:
    """Delete the creature linked to a todo."""
    creature = get_creature_by_todo(db, todo_id)
    if creature:
        db.delete(creature)
        db.commit()
