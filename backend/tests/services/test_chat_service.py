"""Integration tests for chat_service against the real test database."""

import uuid

import pytest
from sqlalchemy.orm import Session

from src.services import chat_service


class TestChatService:
    def test_create_session(self, db_session: Session) -> None:
        response = chat_service.create_session(db_session)
        assert response.id is not None
        assert response.title is None
        assert response.created_at is not None
        assert response.updated_at is not None

    def test_list_sessions_ordered_by_updated_at_desc(self, db_session: Session) -> None:
        s1 = chat_service.create_session(db_session)
        s2 = chat_service.create_session(db_session)

        results = chat_service.list_sessions(db_session)
        ids = [r.id for r in results]
        assert s2.id in ids
        assert s1.id in ids
        assert ids.index(s2.id) < ids.index(s1.id)

    def test_get_session_not_found(self, db_session: Session) -> None:
        from src.exceptions import ChatSessionNotFoundError

        with pytest.raises(ChatSessionNotFoundError):
            chat_service.get_session(db_session, uuid.uuid4())

    def test_delete_session_cascades_messages(self, db_session: Session) -> None:
        session = chat_service.create_session(db_session)
        chat_service.create_message(db_session, session.id, role="user", content="hi")

        chat_service.delete_session(db_session, session.id)

        from src.exceptions import ChatSessionNotFoundError

        with pytest.raises(ChatSessionNotFoundError):
            chat_service.get_session(db_session, session.id)

    def test_delete_session_not_found(self, db_session: Session) -> None:
        from src.exceptions import ChatSessionNotFoundError

        with pytest.raises(ChatSessionNotFoundError):
            chat_service.delete_session(db_session, uuid.uuid4())

    def test_create_message_auto_titles_session(self, db_session: Session) -> None:
        session = chat_service.create_session(db_session)
        assert session.title is None

        chat_service.create_message(
            db_session, session.id, role="user", content="What are my todos?"
        )

        updated = chat_service.get_session(db_session, session.id)
        assert updated.title == "What are my todos?"

    def test_auto_title_truncates_at_60_chars(self, db_session: Session) -> None:
        session = chat_service.create_session(db_session)
        long_message = "x" * 70
        chat_service.create_message(
            db_session, session.id, role="user", content=long_message
        )
        updated = chat_service.get_session(db_session, session.id)
        assert updated.title == "x" * 60 + "..."

    def test_auto_title_not_overwritten_on_second_message(
        self, db_session: Session
    ) -> None:
        session = chat_service.create_session(db_session)
        chat_service.create_message(
            db_session, session.id, role="user", content="First message"
        )
        chat_service.create_message(
            db_session, session.id, role="user", content="Second message"
        )
        updated = chat_service.get_session(db_session, session.id)
        assert updated.title == "First message"

    def test_list_messages_ordered_by_created_at_asc(self, db_session: Session) -> None:
        session = chat_service.create_session(db_session)
        chat_service.create_message(db_session, session.id, role="user", content="A")
        chat_service.create_message(db_session, session.id, role="assistant", content="B")

        messages = chat_service.list_messages(db_session, session.id)
        assert len(messages) == 2
        assert messages[0].role == "user"
        assert messages[1].role == "assistant"

    def test_update_message_finalises_assistant_row(self, db_session: Session) -> None:
        session = chat_service.create_session(db_session)
        msg = chat_service.create_message(
            db_session, session.id, role="assistant", content="", status="pending"
        )

        chat_service.update_message(
            db_session, msg.id, content="Done!", status="complete", skill="chat"
        )

        messages = chat_service.list_messages(db_session, session.id)
        assert messages[0].content == "Done!"
        assert messages[0].status == "complete"
        assert messages[0].skill == "chat"
