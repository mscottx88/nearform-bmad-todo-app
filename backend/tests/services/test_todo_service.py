import pytest
from sqlalchemy.orm import Session

from src.exceptions import TodoNotFoundError
from src.schemas.todo import TodoCreate, TodoUpdate
from src.services import todo_service


def test_create_todo(db_session: Session) -> None:
    data = TodoCreate(text="Buy groceries")
    todo = todo_service.create_todo(db_session, data)
    assert todo.id is not None
    assert todo.text == "Buy groceries"
    assert todo.completed is False
    assert todo.color == "#00ff88"
    assert todo.embedding_status == "pending"
    assert todo.deleted is False


def test_create_todo_with_color(db_session: Session) -> None:
    data = TodoCreate(text="Urgent task", color="#ff10f0")
    todo = todo_service.create_todo(db_session, data)
    assert todo.color == "#ff10f0"


def test_list_todos_returns_active_only(db_session: Session) -> None:
    todo_service.create_todo(
        db_session,
        TodoCreate(text="Active"),
    )
    deleted = todo_service.create_todo(
        db_session,
        TodoCreate(text="Deleted"),
    )
    todo_service.delete_todo(db_session, deleted.id)

    todos = todo_service.list_todos(db_session)
    assert len(todos) == 1
    assert todos[0].text == "Active"


def test_list_todos_excludes_completed(db_session: Session) -> None:
    # Completed todos are terminal — they must not reappear in the pond on
    # refresh (see story 2.4 / 2.6 follow-up). The DB row is preserved for
    # creature FK and future views, but list_todos filters it out.
    todo_service.create_todo(
        db_session,
        TodoCreate(text="Active"),
    )
    completed = todo_service.create_todo(
        db_session,
        TodoCreate(text="Completed"),
    )
    todo_service.update_todo(
        db_session,
        completed.id,
        TodoUpdate(completed=True),
    )

    todos = todo_service.list_todos(db_session)
    assert len(todos) == 1
    assert todos[0].text == "Active"


def test_list_todos_returns_multiple(db_session: Session) -> None:
    todo_service.create_todo(
        db_session,
        TodoCreate(text="First"),
    )
    todo_service.create_todo(
        db_session,
        TodoCreate(text="Second"),
    )
    todos = todo_service.list_todos(db_session)
    assert len(todos) == 2
    texts = {t.text for t in todos}
    assert texts == {"First", "Second"}


def test_get_todo(db_session: Session) -> None:
    created = todo_service.create_todo(
        db_session,
        TodoCreate(text="Find me"),
    )
    found = todo_service.get_todo(db_session, created.id)
    assert found.id == created.id


def test_get_todo_not_found(db_session: Session) -> None:
    import uuid

    with pytest.raises(TodoNotFoundError):
        todo_service.get_todo(db_session, uuid.uuid4())


def test_get_deleted_todo_raises(db_session: Session) -> None:
    created = todo_service.create_todo(
        db_session,
        TodoCreate(text="Delete me"),
    )
    todo_service.delete_todo(db_session, created.id)
    with pytest.raises(TodoNotFoundError):
        todo_service.get_todo(db_session, created.id)


def test_update_todo_partial(db_session: Session) -> None:
    created = todo_service.create_todo(
        db_session,
        TodoCreate(text="Original"),
    )
    updated = todo_service.update_todo(
        db_session,
        created.id,
        TodoUpdate(completed=True),
    )
    assert updated.completed is True
    assert updated.text == "Original"


def test_update_todo_color(db_session: Session) -> None:
    created = todo_service.create_todo(
        db_session,
        TodoCreate(text="Color me"),
    )
    updated = todo_service.update_todo(
        db_session,
        created.id,
        TodoUpdate(color="#39ff14"),
    )
    assert updated.color == "#39ff14"


def test_delete_todo_soft(db_session: Session) -> None:
    created = todo_service.create_todo(
        db_session,
        TodoCreate(text="Soft delete"),
    )
    deleted = todo_service.delete_todo(db_session, created.id)
    assert deleted.deleted is True
    assert deleted.deleted_at is not None
