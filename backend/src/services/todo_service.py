import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from src.exceptions import TodoNotFoundError
from src.models.group import Group, GroupMembership
from src.models.todo import Todo
from src.schemas.todo import TodoCreate, TodoResponse, TodoUpdate
from src.workers import embedding_worker


def _build_response(
    todo: Todo,
    group_id: uuid.UUID | None,
    group_label: str | None = None,
    group_color: str | None = None,
) -> TodoResponse:
    """Shape a Todo ORM row + its (optional) group membership into
    a TodoResponse. Story 4.6 — `group_id` is not a column on the
    Todo model; callers pass the join-table-derived value explicitly.
    `group_label` / `group_color` default to None; solo pads never
    have them, and only list_todos (which has the three-way join)
    populates them today — the single-row mutation paths look up
    the row separately via `_group_meta_for`.
    """
    return TodoResponse.model_validate(
        {
            **TodoResponse.model_validate(todo).model_dump(),
            "group_id": group_id,
            "group_label": group_label,
            "group_color": group_color,
        }
    )


def _group_meta_for(
    db: Session, todo_id: uuid.UUID
) -> tuple[uuid.UUID | None, str | None, str | None]:
    """Single-row lookup of a pad's group membership + label + color.
    Returns (None, None, None) for solo pads. Used by update/delete/
    restore/create paths to echo the CURRENT group metadata back in
    the response without duplicating the join each time.
    """
    row = (
        db.query(GroupMembership.group_id, Group.label, Group.color)
        .join(Group, GroupMembership.group_id == Group.id)
        .filter(GroupMembership.todo_id == todo_id)
        .first()
    )
    if row is None:
        return None, None, None
    return row[0], row[1], row[2]


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
    # New todos are always solo — no membership possible until a
    # subsequent POST /api/groups references the id.
    return _build_response(todo, None)


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
    #
    # Story 4.6: also joins `GroupMembership` so each row carries its
    # optional `group_id`. Left-outer-join so solo pads (no membership)
    # still appear with `group_id = None`. The join is CHEAP — a
    # single index hit per row on `group_memberships.todo_id` (PK).
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
        db.query(Todo, GroupMembership.group_id, Group.label, Group.color)
        .outerjoin(
            GroupMembership,
            Todo.id == GroupMembership.todo_id,
        )
        .outerjoin(
            Group,
            GroupMembership.group_id == Group.id,
        )
        .filter(
            Todo.archived == False,  # noqa: E712
            or_(*clauses),
        )
        .order_by(Todo.created_at.desc())
        .all()
    )
    return [
        _build_response(todo, gid, glabel, gcolor) for todo, gid, glabel, gcolor in rows
    ]


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
    gid, glabel, gcolor = _group_meta_for(db, todo.id)
    return _build_response(todo, gid, glabel, gcolor)


def delete_todo(db: Session, todo_id: uuid.UUID) -> TodoResponse:
    todo = _get_active_todo(db, todo_id)
    todo.deleted = True
    todo.deleted_at = datetime.now(UTC)
    db.commit()
    db.refresh(todo)
    gid, glabel, gcolor = _group_meta_for(db, todo.id)
    return _build_response(todo, gid, glabel, gcolor)


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
    gid, glabel, gcolor = _group_meta_for(db, todo.id)
    return _build_response(todo, gid, glabel, gcolor)
