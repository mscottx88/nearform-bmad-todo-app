import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from src.exceptions import TodoNotFoundError
from src.models.todo import Todo
from src.schemas.todo import (
    TodoCreate,
    TodoPositionEntry,
    TodoResponse,
    TodoUpdate,
)
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


def create_todo(db: Session, data: TodoCreate) -> TodoResponse:
    todo = Todo(**data.model_dump(exclude_unset=True))
    db.add(todo)
    db.commit()
    db.refresh(todo)
    embedding_worker.enqueue_embedding(todo.id)
    return TodoResponse.model_validate(todo)


def list_todos(
    db: Session,
    include_active: bool = True,
    include_completed: bool = False,
    include_deleted: bool = False,
) -> list[TodoResponse]:
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
    rows = (
        db.query(Todo)
        .filter(
            Todo.archived == False,  # noqa: E712
            or_(*clauses),
        )
        .order_by(Todo.created_at.desc())
        .all()
    )
    return [TodoResponse.model_validate(todo) for todo in rows]


def get_todo(db: Session, todo_id: uuid.UUID) -> Todo:
    return _get_active_todo(db, todo_id)


def update_todo(
    db: Session,
    todo_id: uuid.UUID,
    data: TodoUpdate,
) -> TodoResponse:
    todo = _get_active_todo(db, todo_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(todo, field, value)
    db.commit()
    db.refresh(todo)
    return TodoResponse.model_validate(todo)


def update_positions(
    db: Session,
    entries: list[TodoPositionEntry],
) -> list[TodoResponse]:
    """Batch-update positions for many pads in one round-trip.

    Story 4-8. Replaces the per-pad PATCH fan-out that drag-release
    fired for the dragged pad plus each sibling whose cascade nudge
    exceeded the commit threshold — previously N PATCHes per release;
    now exactly one.

    Missing ids are silently skipped — keeps the batch robust against
    the race where a pad is deleted between drag-start and drag-
    release. Soft-deleted rows (`deleted=true`) are NOT filtered out:
    `/show-deleted` renders those pads as interactive, and their
    layout should persist when nudged or dragged just like an active
    pad. Position is a layout attribute, orthogonal to completion /
    deletion state.
    """
    if not entries:
        return []
    ids = [e.id for e in entries]
    rows = db.query(Todo).filter(Todo.id.in_(ids)).all()
    found: dict[uuid.UUID, Todo] = {row.id: row for row in rows}
    # Apply updates in the request's order. Each entry addresses at
    # most one Todo (request ids are expected unique; if duplicated,
    # the LAST entry wins — matches SQL last-write semantics).
    for entry in entries:
        todo = found.get(entry.id)
        if todo is None:
            continue
        todo.position_x = entry.position_x
        todo.position_y = entry.position_y
    db.commit()
    # Return responses in input order, skipping missing ids.
    responses: list[TodoResponse] = []
    for entry in entries:
        todo = found.get(entry.id)
        if todo is None:
            continue
        db.refresh(todo)
        responses.append(TodoResponse.model_validate(todo))
    return responses


def delete_todo(db: Session, todo_id: uuid.UUID) -> TodoResponse:
    todo = _get_active_todo(db, todo_id)
    todo.deleted = True
    todo.deleted_at = datetime.now(UTC)
    db.commit()
    db.refresh(todo)
    return TodoResponse.model_validate(todo)


def restore_todo(db: Session, todo_id: uuid.UUID) -> TodoResponse:
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
    return TodoResponse.model_validate(todo)
