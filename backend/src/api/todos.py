import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from src.database import get_db
from src.schemas.todo import (
    TodoCreate,
    TodoPositionsUpdate,
    TodoResponse,
    TodoUpdate,
)
from src.services import todo_service

router = APIRouter(prefix="/api/todos", tags=["todos"])


@router.post(
    "",
    response_model=TodoResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_todo(
    data: TodoCreate,
    db: Session = Depends(get_db),
) -> TodoResponse:
    return todo_service.create_todo(db, data)


@router.get("", response_model=list[TodoResponse])
def list_todos(
    include_active: bool = Query(default=True),
    include_completed: bool = Query(default=False),
    include_deleted: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[TodoResponse]:
    # Story 3.3: flag-driven visibility. Defaults preserve pre-3.3 contract.
    return todo_service.list_todos(
        db,
        include_active=include_active,
        include_completed=include_completed,
        include_deleted=include_deleted,
    )


# Story 4-8: batch position endpoint. Registered BEFORE the
# parameterized `/{todo_id}` PATCH so FastAPI's route matcher picks
# the literal "positions" path segment instead of trying to parse it
# as a UUID (which would fail but still churn through validation).
@router.patch(
    "/positions",
    response_model=list[TodoResponse],
)
def update_positions(
    data: TodoPositionsUpdate,
    db: Session = Depends(get_db),
) -> list[TodoResponse]:
    return todo_service.update_positions(db, data.positions)


# Story 4-9: navigator.sendBeacon is POST-only, so a POST alias is
# provided alongside the PATCH route. Both accept the same payload and
# delegate to the same service function. sendBeacon is the preferred
# exit-flush path on the frontend; fetch({keepalive: true, method:PATCH})
# is the fallback for environments without sendBeacon support.
@router.post(
    "/positions",
    response_model=list[TodoResponse],
)
def update_positions_beacon(
    data: TodoPositionsUpdate,
    db: Session = Depends(get_db),
) -> list[TodoResponse]:
    return todo_service.update_positions(db, data.positions)


@router.patch(
    "/{todo_id}",
    response_model=TodoResponse,
)
def update_todo(
    todo_id: uuid.UUID,
    data: TodoUpdate,
    db: Session = Depends(get_db),
) -> TodoResponse:
    return todo_service.update_todo(db, todo_id, data)


@router.delete(
    "/{todo_id}",
    response_model=TodoResponse,
)
def delete_todo(
    todo_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> TodoResponse:
    return todo_service.delete_todo(db, todo_id)


@router.post(
    "/{todo_id}/restore",
    response_model=TodoResponse,
)
def restore_todo(
    todo_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> TodoResponse:
    # Story 3.3: undelete a soft-deleted todo so it re-surfaces as
    # active. The popup on a deleted pad uses this instead of the
    # PATCH flow because PATCH's `_get_active_todo` rejects deleted rows.
    return todo_service.restore_todo(db, todo_id)
