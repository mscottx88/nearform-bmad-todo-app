"""Unit tests for agent tool classes."""

import json
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock, patch

from src.agent.tools.get_chat_history import GetChatHistoryTool
from src.agent.tools.get_todo import GetTodoTool
from src.agent.tools.list_todos import ListTodosTool
from src.agent.tools.search_todos import SearchTodosTool
from src.exceptions import TodoNotFoundError
from src.schemas.agent import ChatMessageResponse
from src.schemas.search import SearchResponse, SearchResult
from src.schemas.todo import TodoResponse


def _make_todo(**overrides: Any) -> TodoResponse:
    data: dict[str, Any] = {
        "id": uuid.uuid4(),
        "text": "test todo",
        "completed": False,
        "color": "#00ff88",
        "position_x": None,
        "position_y": None,
        "rotation_y": 0.0,
        "drift_seed": 0.0,
        "embedding_status": "complete",
        "archived": False,
        "archived_at": None,
        "display_metadata": {},
        "deleted": False,
        "deleted_at": None,
        "created_at": datetime(2026, 1, 1, tzinfo=UTC),
        "updated_at": datetime(2026, 1, 1, tzinfo=UTC),
    }
    data.update(overrides)
    return TodoResponse(**data)


def _make_session_factory(mock_session: MagicMock) -> Any:
    @contextmanager
    def factory() -> Generator[MagicMock]:
        yield mock_session

    return factory


class TestListTodosTool:
    def test_happy_path(self) -> None:
        todo = _make_todo(text="buy milk")
        mock_session = MagicMock()
        factory = _make_session_factory(mock_session)

        with patch(
            "src.agent.tools.list_todos.todo_service.list_for_agent",
            return_value=[todo],
        ) as mock_list:
            tool = ListTodosTool(session_factory=factory)
            result = tool._run(filter="active", limit=10)

        data = json.loads(result)
        assert len(data) == 1
        assert data[0]["text"] == "buy milk"
        mock_list.assert_called_once_with(mock_session, filter="active", limit=10)

    def test_service_returns_empty(self) -> None:
        mock_session = MagicMock()
        factory = _make_session_factory(mock_session)

        with patch(
            "src.agent.tools.list_todos.todo_service.list_for_agent", return_value=[]
        ):
            tool = ListTodosTool(session_factory=factory)
            result = tool._run()

        assert json.loads(result) == []


class TestGetTodoTool:
    def test_happy_path(self) -> None:
        todo_id = uuid.uuid4()
        todo_orm = MagicMock()
        todo_orm.id = todo_id
        todo_orm.text = "go shopping"
        todo_orm.completed = False
        todo_orm.color = "#00ff88"
        todo_orm.position_x = None
        todo_orm.position_y = None
        todo_orm.created_at = datetime(2026, 1, 1, tzinfo=UTC)

        mock_session = MagicMock()
        factory = _make_session_factory(mock_session)

        with patch(
            "src.agent.tools.get_todo.todo_service.get_todo", return_value=todo_orm
        ):
            tool = GetTodoTool(session_factory=factory)
            result = tool._run(id=str(todo_id))

        data = json.loads(result)
        assert data["text"] == "go shopping"

    def test_invalid_uuid(self) -> None:
        mock_session = MagicMock()
        factory = _make_session_factory(mock_session)
        tool = GetTodoTool(session_factory=factory)
        result = tool._run(id="not-a-uuid")
        data = json.loads(result)
        assert "error" in data

    def test_not_found(self) -> None:
        todo_id = uuid.uuid4()
        mock_session = MagicMock()
        factory = _make_session_factory(mock_session)

        with patch(
            "src.agent.tools.get_todo.todo_service.get_todo",
            side_effect=TodoNotFoundError(str(todo_id)),
        ):
            tool = GetTodoTool(session_factory=factory)
            result = tool._run(id=str(todo_id))

        data = json.loads(result)
        assert "error" in data


class TestSearchTodosTool:
    def test_happy_path(self) -> None:
        todo = _make_todo(text="call doctor")
        sr = SearchResult(todo=todo, score=0.9, match_type="hybrid")
        response = SearchResponse(
            query="doctor",
            results=[sr],
            vector_search_unavailable=False,
            fts_supported=True,
        )

        mock_session = MagicMock()
        factory = _make_session_factory(mock_session)

        with patch(
            "src.agent.tools.search_todos.search_service.hybrid_search",
            return_value=response,
        ):
            tool = SearchTodosTool(session_factory=factory)
            result = tool._run(text="doctor", limit=5)

        data = json.loads(result)
        assert len(data) == 1
        assert data[0]["text"] == "call doctor"

    def test_empty_results(self) -> None:
        response = SearchResponse(
            query="xyz",
            results=[],
            vector_search_unavailable=True,
            fts_supported=False,
        )
        mock_session = MagicMock()
        factory = _make_session_factory(mock_session)

        with patch(
            "src.agent.tools.search_todos.search_service.hybrid_search",
            return_value=response,
        ):
            tool = SearchTodosTool(session_factory=factory)
            result = tool._run(text="xyz")

        assert json.loads(result) == []


class TestGetChatHistoryTool:
    def test_happy_path(self) -> None:
        session_id = uuid.uuid4()
        msg = ChatMessageResponse(
            id=uuid.uuid4(),
            session_id=session_id,
            role="user",
            content="hello",
            skill=None,
            metadata_={},
            status="complete",
            error=None,
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
        )

        mock_session = MagicMock()
        factory = _make_session_factory(mock_session)

        with patch(
            "src.agent.tools.get_chat_history.chat_service.list_messages",
            return_value=[msg],
        ) as mock_list:
            # Story 6.1 CR P19: session_id is now injected at construction
            # time, not taken as a tool arg.
            tool = GetChatHistoryTool(session_factory=factory, session_id=session_id)
            result = tool._run(limit=10)

        data = json.loads(result)
        assert len(data) == 1
        assert data[0]["role"] == "user"
        assert data[0]["content"] == "hello"
        # Verify the injected session_id was used.
        mock_list.assert_called_once_with(mock_session, session_id, limit=10)

    def test_returns_error_on_service_failure(self) -> None:
        # P15: any exception from the service layer becomes a JSON error
        # string, satisfying the CrewAI `_run -> str` contract.
        session_id = uuid.uuid4()
        mock_session = MagicMock()
        factory = _make_session_factory(mock_session)

        with patch(
            "src.agent.tools.get_chat_history.chat_service.list_messages",
            side_effect=RuntimeError("db down"),
        ):
            tool = GetChatHistoryTool(session_factory=factory, session_id=session_id)
            result = tool._run(limit=10)

        data = json.loads(result)
        assert "error" in data
        assert "db down" in data["error"]
