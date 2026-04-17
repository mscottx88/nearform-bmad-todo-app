import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from src.exceptions import TodoNotFoundError
from src.models.todo import Todo
from src.schemas.todo import TodoCreate, TodoUpdate


def _get_active_todo(
    db: Session,
    todo_id: uuid.UUID,
) -> Todo:
    todo = (
        db.query(Todo)
        .filter(
            Todo.id == todo_id,
            Todo.deleted == False,  # noqa: E712
        )
        .first()
    )
    if not todo:
        raise TodoNotFoundError(str(todo_id))
    return todo


def create_todo(db: Session, data: TodoCreate) -> Todo:
    todo = Todo(**data.model_dump(exclude_unset=True))
    db.add(todo)
    db.commit()
    db.refresh(todo)
    return todo


def list_todos(db: Session) -> list[Todo]:
    # Completed todos are hidden from the pond — completion is terminal
    # and there is no uncomplete path in the product (see story 2.4). The
    # DB row is preserved (creatures reference it; future views may
    # surface completed history) but the pond never re-renders it, so
    # refreshing the page doesn't resurrect a pad the user already finished.
    return (
        db.query(Todo)
        .filter(
            Todo.deleted == False,  # noqa: E712
            Todo.archived == False,  # noqa: E712
            Todo.completed == False,  # noqa: E712
        )
        .order_by(Todo.created_at.desc())
        .all()
    )


def get_todo(db: Session, todo_id: uuid.UUID) -> Todo:
    return _get_active_todo(db, todo_id)


def update_todo(
    db: Session,
    todo_id: uuid.UUID,
    data: TodoUpdate,
) -> Todo:
    todo = _get_active_todo(db, todo_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(todo, field, value)
    db.commit()
    db.refresh(todo)
    return todo


def delete_todo(db: Session, todo_id: uuid.UUID) -> Todo:
    todo = _get_active_todo(db, todo_id)
    todo.deleted = True
    todo.deleted_at = datetime.now(UTC)
    db.commit()
    db.refresh(todo)
    return todo
