"""End-to-end integration tests for agent tools.

Story 6.1 CR follow-up: `test_tools.py` covers unit behaviour by mocking
`session_factory` and every `*_service` function. These tests exercise
the REAL service → DB round-trip so schema + SQL + ORM wiring stays
covered end-to-end.

Each test:
  1. uses the `db_session` fixture from conftest.py (which is wrapped
     around a real connection to `todo_pond_test`);
  2. inserts real rows via the same services the tools call;
  3. constructs the tool with a `session_factory` that yields the test
     session as a context-manager; and
  4. asserts the tool's JSON return against the DB state.
"""

import json
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any

import pytest
from sqlalchemy.orm import Session

from src.agent.tools.get_chat_history import GetChatHistoryTool
from src.agent.tools.get_todo import GetTodoTool
from src.agent.tools.list_todos import ListTodosTool
from src.agent.tools.search_todos import SearchTodosTool
from src.schemas.todo import TodoCreate
from src.services import chat_service, todo_service


@pytest.fixture
def session_factory(db_session: Session) -> Any:
    """Wrap the already-open test session as a context-manager-returning factory.

    Tools call `with self._session_factory() as session:`. Production uses
    `SessionLocal`; tests use the pre-opened `db_session` (teardown is
    handled by the `_clean_db` autouse fixture in conftest.py, so the
    factory MUST NOT close the session).

    Return type is `Any` to match the existing test_tools.py pattern —
    the production `session_factory` signature is `Callable[[], Session]`
    (Session is a context manager in SQLAlchemy 2.x) while our test
    wrapper is `Callable[[], AbstractContextManager[Session]]`. Both
    work at runtime with `with factory() as session:`; documenting the
    mismatch via `Any` is cleaner than scattering `# type: ignore` at
    every call-site.
    """

    @contextmanager
    def factory() -> Generator[Session]:
        yield db_session

    return factory


class TestListTodosToolIntegration:
    def test_returns_real_active_todos(
        self,
        db_session: Session,
        session_factory: Any,
    ) -> None:
        todo_service.create_todo(db_session, TodoCreate(text="buy milk"))
        todo_service.create_todo(db_session, TodoCreate(text="call doctor"))
        db_session.commit()

        tool = ListTodosTool(session_factory=session_factory)
        result = tool._run(filter="active")
        data = json.loads(result)

        texts = {row["text"] for row in data}
        assert texts == {"buy milk", "call doctor"}
        # Compact-field contract per AC 7: id, text, done, color, x, z, created
        for row in data:
            assert set(row.keys()) == {
                "id",
                "text",
                "done",
                "color",
                "x",
                "z",
                "created",
            }
            assert row["done"] is False

    def test_bad_filter_returns_json_error_not_raw_traceback(
        self,
        session_factory: Any,
    ) -> None:
        # P15: service raises ValueError on unknown filter; tool must
        # still return a JSON string (not bubble the exception).
        tool = ListTodosTool(session_factory=session_factory)
        result = tool._run(filter="pending")
        data = json.loads(result)
        assert "error" in data
        assert "filter must be one of" in data["error"]

    def test_limit_pushed_to_sql(
        self,
        db_session: Session,
        session_factory: Any,
    ) -> None:
        # Create more rows than we ask for; verify the tool returns the
        # limited subset (LIMIT applied at SQL level per P8).
        for i in range(5):
            todo_service.create_todo(db_session, TodoCreate(text=f"task {i}"))
        db_session.commit()

        tool = ListTodosTool(session_factory=session_factory)
        result = tool._run(limit=3)
        data = json.loads(result)
        assert len(data) == 3


class TestGetTodoToolIntegration:
    def test_returns_single_todo(
        self,
        db_session: Session,
        session_factory: Any,
    ) -> None:
        created = todo_service.create_todo(db_session, TodoCreate(text="unique task"))
        db_session.commit()

        tool = GetTodoTool(session_factory=session_factory)
        result = tool._run(id=str(created.id))
        data = json.loads(result)

        assert data["id"] == str(created.id)
        assert data["text"] == "unique task"
        assert data["done"] is False

    def test_not_found_returns_json_error(
        self,
        session_factory: Any,
    ) -> None:
        tool = GetTodoTool(session_factory=session_factory)
        result = tool._run(id=str(uuid.uuid4()))
        data = json.loads(result)
        assert "error" in data

    def test_invalid_uuid_returns_json_error(
        self,
        session_factory: Any,
    ) -> None:
        tool = GetTodoTool(session_factory=session_factory)
        result = tool._run(id="not-a-uuid")
        data = json.loads(result)
        assert "error" in data
        assert "Invalid UUID" in data["error"]


class TestSearchTodosToolIntegration:
    def test_hybrid_search_returns_matching_todos(
        self,
        db_session: Session,
        session_factory: Any,
    ) -> None:
        todo_service.create_todo(db_session, TodoCreate(text="visit the dentist"))
        todo_service.create_todo(db_session, TodoCreate(text="water the plants"))
        db_session.commit()

        tool = SearchTodosTool(session_factory=session_factory)
        result = tool._run(text="dentist", limit=5)
        data = json.loads(result)

        assert len(data) >= 1
        assert any("dentist" in row["text"] for row in data)

    def test_empty_query_returns_json_error(
        self,
        session_factory: Any,
    ) -> None:
        # P15: hybrid_search raises ValueError on empty/whitespace query.
        tool = SearchTodosTool(session_factory=session_factory)
        result = tool._run(text="   ")
        data = json.loads(result)
        assert "error" in data


class TestGetChatHistoryToolIntegration:
    def test_returns_session_messages_in_order(
        self,
        db_session: Session,
        session_factory: Any,
    ) -> None:
        session = chat_service.create_session(db_session)
        chat_service.create_message(db_session, session.id, role="user", content="first")
        chat_service.create_message(
            db_session, session.id, role="assistant", content="second"
        )

        tool = GetChatHistoryTool(session_factory=session_factory, session_id=session.id)
        result = tool._run(limit=10)
        data = json.loads(result)

        assert len(data) == 2
        assert data[0]["role"] == "user"
        assert data[0]["content"] == "first"
        assert data[1]["role"] == "assistant"
        assert data[1]["content"] == "second"

    def test_cross_session_isolation(
        self,
        db_session: Session,
        session_factory: Any,
    ) -> None:
        # P19: session_id is injected at construction, not supplied by
        # the LLM. A tool bound to session A MUST NOT see messages
        # belonging to session B, even if both exist in the same DB.
        session_a = chat_service.create_session(db_session)
        session_b = chat_service.create_session(db_session)
        chat_service.create_message(
            db_session, session_a.id, role="user", content="for A"
        )
        chat_service.create_message(
            db_session, session_b.id, role="user", content="for B"
        )

        tool_a = GetChatHistoryTool(
            session_factory=session_factory, session_id=session_a.id
        )
        result_a = json.loads(tool_a._run())
        assert [m["content"] for m in result_a] == ["for A"]

        tool_b = GetChatHistoryTool(
            session_factory=session_factory, session_id=session_b.id
        )
        result_b = json.loads(tool_b._run())
        assert [m["content"] for m in result_b] == ["for B"]

    def test_unknown_session_id_returns_json_error(
        self,
        session_factory: Any,
    ) -> None:
        # P15: a session that doesn't exist raises
        # ChatSessionNotFoundError inside list_messages; the tool must
        # convert it to a JSON error string.
        tool = GetChatHistoryTool(
            session_factory=session_factory, session_id=uuid.uuid4()
        )
        result = tool._run()
        data = json.loads(result)
        assert "error" in data
        assert "not found" in data["error"].lower()
