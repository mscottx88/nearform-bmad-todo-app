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


# Story 3.3: flag-driven list_todos tests. Seed the canonical mix
# (3 active + 1 completed + 1 deleted) once per test so each permutation
# asserts against the same world.
def _seed_visibility_mix(db_session: Session) -> dict[str, list[str]]:
    active_texts = ["Active-A", "Active-B", "Active-C"]
    for text in active_texts:
        todo_service.create_todo(db_session, TodoCreate(text=text))
    completed = todo_service.create_todo(db_session, TodoCreate(text="Completed-1"))
    todo_service.update_todo(db_session, completed.id, TodoUpdate(completed=True))
    to_delete = todo_service.create_todo(db_session, TodoCreate(text="Deleted-1"))
    todo_service.delete_todo(db_session, to_delete.id)
    return {
        "active": active_texts,
        "completed": ["Completed-1"],
        "deleted": ["Deleted-1"],
    }


def test_list_todos_default_returns_active_only(db_session: Session) -> None:
    seed = _seed_visibility_mix(db_session)
    todos = todo_service.list_todos(db_session)
    assert {t.text for t in todos} == set(seed["active"])


def test_list_todos_include_completed_only(db_session: Session) -> None:
    seed = _seed_visibility_mix(db_session)
    todos = todo_service.list_todos(
        db_session,
        include_active=False,
        include_completed=True,
        include_deleted=False,
    )
    assert {t.text for t in todos} == set(seed["completed"])


def test_list_todos_include_deleted_only(db_session: Session) -> None:
    seed = _seed_visibility_mix(db_session)
    todos = todo_service.list_todos(
        db_session,
        include_active=False,
        include_completed=False,
        include_deleted=True,
    )
    assert {t.text for t in todos} == set(seed["deleted"])


def test_list_todos_all_three_flags_true(db_session: Session) -> None:
    seed = _seed_visibility_mix(db_session)
    todos = todo_service.list_todos(
        db_session,
        include_active=True,
        include_completed=True,
        include_deleted=True,
    )
    expected = set(seed["active"]) | set(seed["completed"]) | set(seed["deleted"])
    assert {t.text for t in todos} == expected


def test_list_todos_all_flags_false_returns_empty(db_session: Session) -> None:
    _seed_visibility_mix(db_session)
    todos = todo_service.list_todos(
        db_session,
        include_active=False,
        include_completed=False,
        include_deleted=False,
    )
    assert todos == []


def test_restore_todo_flips_deleted_back_to_false(db_session: Session) -> None:
    created = todo_service.create_todo(db_session, TodoCreate(text="Restore me"))
    todo_service.delete_todo(db_session, created.id)
    restored = todo_service.restore_todo(db_session, created.id)
    assert restored.deleted is False
    assert restored.deleted_at is None
    # Now reachable via the default active filter again.
    assert created.id in {t.id for t in todo_service.list_todos(db_session)}


def test_restore_todo_not_found(db_session: Session) -> None:
    import uuid as _uuid

    with pytest.raises(TodoNotFoundError):
        todo_service.restore_todo(db_session, _uuid.uuid4())
