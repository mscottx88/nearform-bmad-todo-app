"""Story 4.6: /api/groups — create/update/delete clusters of pads.

Sync route handlers per CLAUDE.md Principle VI. The service layer
does all validation (group-too-small, member-already-grouped,
unknown-todo) and raises typed AppErrors; the global handler in
`main.py` shapes those into the stable `{error, message, detail}`
envelope, so these handlers stay small.

Note on verbs — there is deliberately no `GET /api/groups/{id}`.
The frontend discovers group membership via `group_id` on each
`TodoResponse`, which is already returned from `GET /api/todos`.
A single-group GET would duplicate state and invite drift.
"""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from src.database import get_db
from src.schemas.group import GroupCreate, GroupResponse, GroupUpdate
from src.services import group_service

router = APIRouter(prefix="/api/groups", tags=["groups"])


@router.post(
    "",
    response_model=GroupResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_group(
    data: GroupCreate,
    db: Session = Depends(get_db),
) -> GroupResponse:
    return group_service.create_group(db, data)


@router.patch(
    "/{group_id}",
    response_model=GroupResponse,
)
def update_group(
    group_id: uuid.UUID,
    data: GroupUpdate,
    db: Session = Depends(get_db),
) -> GroupResponse:
    return group_service.update_group(db, group_id, data)


@router.delete(
    "/{group_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_group(
    group_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> None:
    group_service.delete_group(db, group_id)
