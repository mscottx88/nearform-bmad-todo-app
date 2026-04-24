"""API-level tests for /api/agent/* endpoints."""

import uuid
from collections.abc import Iterator
from typing import Any
from unittest.mock import MagicMock, patch

from sqlalchemy.orm import Session
from starlette.testclient import TestClient

from src.services import chat_service


class TestSessionCRUD:
    def test_create_session(self, client: TestClient) -> None:
        resp = client.post("/api/agent/sessions")
        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert data["title"] is None

    def test_list_sessions(self, client: TestClient, db_session: Session) -> None:
        chat_service.create_session(db_session)
        chat_service.create_session(db_session)
        resp = client.get("/api/agent/sessions")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_delete_session_returns_204(
        self, client: TestClient, db_session: Session
    ) -> None:
        session = chat_service.create_session(db_session)
        resp = client.delete(f"/api/agent/sessions/{session.id}")
        assert resp.status_code == 204

    def test_delete_session_not_found(self, client: TestClient) -> None:
        resp = client.delete(f"/api/agent/sessions/{uuid.uuid4()}")
        assert resp.status_code == 404

    def test_get_messages_returns_ordered_list(
        self, client: TestClient, db_session: Session
    ) -> None:
        session = chat_service.create_session(db_session)
        chat_service.create_message(db_session, session.id, role="user", content="hi")
        chat_service.create_message(
            db_session, session.id, role="assistant", content="hello"
        )

        resp = client.get(f"/api/agent/sessions/{session.id}/messages")
        assert resp.status_code == 200
        messages = resp.json()
        assert len(messages) == 2
        assert messages[0]["role"] == "user"
        assert messages[1]["role"] == "assistant"

    def test_get_messages_session_not_found(self, client: TestClient) -> None:
        resp = client.get(f"/api/agent/sessions/{uuid.uuid4()}/messages")
        assert resp.status_code == 404


class TestChatEndpoint:
    def test_chat_returns_event_stream(
        self, client: TestClient, db_session: Session
    ) -> None:
        session = chat_service.create_session(db_session)

        def _fake_stream(_q: Any) -> Iterator[str]:
            yield 'data: {"type":"done"}\n\n'

        with (
            patch("src.api.agent.threading.Thread") as mock_thread_cls,
            patch("src.api.agent._classify_intent", return_value="chat"),
            patch("src.api.agent.get_llm_for_agent", return_value=MagicMock()),
            patch("src.api.agent.stream_sse", side_effect=_fake_stream),
        ):
            mock_thread_cls.return_value = MagicMock()

            resp = client.post(
                f"/api/agent/sessions/{session.id}/chat",
                json={"content": "hello"},
            )

        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]

    def test_chat_unknown_skill_returns_400(
        self, client: TestClient, db_session: Session
    ) -> None:
        session = chat_service.create_session(db_session)

        resp = client.post(
            f"/api/agent/sessions/{session.id}/chat",
            json={"content": "hi", "skill": "nonexistent_skill"},
        )
        assert resp.status_code == 400

    def test_chat_session_not_found(self, client: TestClient) -> None:
        resp = client.post(
            f"/api/agent/sessions/{uuid.uuid4()}/chat",
            json={"content": "hello"},
        )
        assert resp.status_code == 404
