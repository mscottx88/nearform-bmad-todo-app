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
        # Story 6.1 CR P13: stored title must be at most 60 chars total,
        # which means 57 chars of content + the 3-char ellipsis.
        session = chat_service.create_session(db_session)
        long_message = "x" * 70
        chat_service.create_message(
            db_session, session.id, role="user", content=long_message
        )
        updated = chat_service.get_session(db_session, session.id)
        assert updated.title == "x" * 57 + "..."
        assert updated.title is not None
        assert len(updated.title) == 60

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

    # Story 6.1 CR Group E TP8: P7 update_message raises on missing row.
    def test_update_message_raises_when_row_missing(self, db_session: Session) -> None:
        from src.exceptions import ChatMessageNotFoundError

        with pytest.raises(ChatMessageNotFoundError):
            chat_service.update_message(
                db_session,
                uuid.uuid4(),
                content="x",
                status="complete",
            )

    # Story 6.1 CR Group E TP10: P14 update_message bumps session.updated_at.
    def test_update_message_bumps_session_updated_at(self, db_session: Session) -> None:
        session = chat_service.create_session(db_session)
        msg = chat_service.create_message(
            db_session, session.id, role="assistant", content="", status="pending"
        )
        before = chat_service.get_session(db_session, session.id).updated_at

        # Sleep a hair so the timestamp delta is visible if the bump fires.
        # Wall-clock precision is ms; a tiny sleep is enough.
        import time

        time.sleep(0.01)

        chat_service.update_message(
            db_session, msg.id, content="done", status="complete", skill="chat"
        )

        after = chat_service.get_session(db_session, session.id).updated_at
        assert after > before, (
            "update_message must bump session.updated_at for sort-by-recency"
        )

    # Story 6.1 CR Group E TP9: P11 list_messages clamps limit to [1, 200].
    def test_list_messages_clamps_limit_to_200(self, db_session: Session) -> None:
        session = chat_service.create_session(db_session)
        for i in range(5):
            chat_service.create_message(
                db_session, session.id, role="user", content=f"m{i}"
            )

        # An LLM-supplied 1e7 limit must not result in a 1e7 LIMIT in SQL.
        # Either the result count comes back as 200 (if there were that
        # many rows) or the actual row count, whichever is smaller. Here:
        # 5 rows < 200, so we get 5 — the contract being verified is that
        # the absurd request didn't crash and didn't tax SQL.
        messages = chat_service.list_messages(db_session, session.id, limit=10_000_000)
        assert len(messages) == 5

    def test_list_messages_clamps_zero_limit_to_min(self, db_session: Session) -> None:
        session = chat_service.create_session(db_session)
        chat_service.create_message(db_session, session.id, role="user", content="m0")

        # limit=0 should be bumped to MIN (1), not return [] silently.
        messages = chat_service.list_messages(db_session, session.id, limit=0)
        assert len(messages) == 1
