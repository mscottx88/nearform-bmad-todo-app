import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from src.database import get_db
from src.schemas.todo import TodoCreate, TodoResponse, TodoUpdate
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
    todo = todo_service.create_todo(db, data)
    return TodoResponse.model_validate(todo)


@router.get("", response_model=list[TodoResponse])
def list_todos(
    db: Session = Depends(get_db),
) -> list[TodoResponse]:
    todos = todo_service.list_todos(db)
    return [TodoResponse.model_validate(t) for t in todos]


@router.patch(
    "/{todo_id}",
    response_model=TodoResponse,
)
def update_todo(
    todo_id: uuid.UUID,
    data: TodoUpdate,
    db: Session = Depends(get_db),
) -> TodoResponse:
    todo = todo_service.update_todo(db, todo_id, data)
    return TodoResponse.model_validate(todo)


@router.delete(
    "/{todo_id}",
    response_model=TodoResponse,
)
def delete_todo(
    todo_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> TodoResponse:
    todo = todo_service.delete_todo(db, todo_id)
    return TodoResponse.model_validate(todo)
