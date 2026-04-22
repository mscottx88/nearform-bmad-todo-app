import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from src.exceptions import TodoNotFoundError
from src.models.todo import Todo
from src.schemas.todo import TodoCreate, TodoUpdate
from src.workers import embedding_worker


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
    embedding_worker.enqueue_embedding(todo.id)
    return todo


def list_todos(
    db: Session,
    include_active: bool = True,
    include_completed: bool = False,
    include_deleted: bool = False,
) -> list[Todo]:
    # Story 3.3: flag-driven visibility. Defaults preserve the pre-3.3
    # contract (active-only) so every caller that hasn't opted in sees
    # exactly the same pond. `archived` is never surfaced (out of scope
    # for 3.3 — see story Dev Notes § "Archived is still out of scope").
    clauses: list[ColumnElement[bool]] = []
    if include_active:
        clauses.append(
            and_(
                Todo.completed == False,  # noqa: E712
                Todo.deleted == False,  # noqa: E712
            )
        )
    if include_completed:
        clauses.append(Todo.completed == True)  # noqa: E712
    if include_deleted:
        clauses.append(Todo.deleted == True)  # noqa: E712
    if not clauses:
        # All three flags off → "show nothing" is a valid state. Do NOT
        # coerce to active-only; the empty pond is the feature.
        return []
    return (
        db.query(Todo)
        .filter(
            Todo.archived == False,  # noqa: E712
            or_(*clauses),
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


def restore_todo(db: Session, todo_id: uuid.UUID) -> Todo:
    # Story 3.3: flip `deleted=false` on a soft-deleted todo so it
    # re-surfaces as an active pad. Bypasses the `_get_active_todo`
    # filter (which rejects deleted rows) by querying directly. No-op
    # if the row is already active.
    todo = db.query(Todo).filter(Todo.id == todo_id).first()
    if not todo:
        raise TodoNotFoundError(str(todo_id))
    todo.deleted = False
    todo.deleted_at = None
    db.commit()
    db.refresh(todo)
    return todo
