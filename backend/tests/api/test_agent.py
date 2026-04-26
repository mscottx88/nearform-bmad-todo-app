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

    # Story 6.1 CR Group E TP4: P25 internal-skill rejection.
    def test_chat_intent_classifier_skill_returns_400(
        self, client: TestClient, db_session: Session
    ) -> None:
        session = chat_service.create_session(db_session)
        resp = client.post(
            f"/api/agent/sessions/{session.id}/chat",
            json={"content": "hi", "skill": "intent_classifier"},
        )
        assert resp.status_code == 400
        assert resp.json()["error"] == "invalid_skill"

    # Story 6.2 AC 12: chat handler must load recent history and filter
    # to complete user/assistant rows (excluding the in-flight assistant
    # placeholder) before building the SkillContext.
    def test_chat_loads_history_into_skill_context(
        self, client: TestClient, db_session: Session
    ) -> None:
        session = chat_service.create_session(db_session)
        chat_service.create_message(
            db_session, session.id, role="user", content="first turn"
        )
        chat_service.create_message(
            db_session, session.id, role="assistant", content="first reply"
        )
        # A failed assistant row must be filtered OUT of history.
        chat_service.create_message(
            db_session,
            session.id,
            role="assistant",
            content="oops",
            status="failed",
        )

        captured: dict[str, Any] = {}

        def _capture_run(
            ctx: Any, _skill: str, _msg_id: Any, _cancel_event: Any = None
        ) -> Any:
            from src.agent.crew_runner import CrewResult  # noqa: PLC0415

            captured["history"] = ctx.history
            return CrewResult(success=True, prose="ok", error=None)

        def _fake_stream(_q: Any) -> Iterator[str]:
            yield 'data: {"type":"done"}\n\n'

        # Synchronously execute the worker so we can observe its
        # SkillContext — bypasses the daemon thread entirely.
        class _ImmediateThread:
            def __init__(self, target: Any, daemon: bool = False) -> None:
                self._target = target

            def start(self) -> None:
                self._target()

        with (
            patch("src.api.agent.threading.Thread", _ImmediateThread),
            patch("src.api.agent._classify_intent", return_value="chat"),
            patch("src.api.agent.get_llm_for_agent", return_value=MagicMock()),
            patch("src.api.agent.run_crew", side_effect=_capture_run),
            patch("src.api.agent.stream_sse", side_effect=_fake_stream),
        ):
            resp = client.post(
                f"/api/agent/sessions/{session.id}/chat",
                json={"content": "second turn"},
            )

        assert resp.status_code == 200
        history = captured["history"]
        # Tuple, not list — SkillContext is frozen.
        assert isinstance(history, tuple)
        # First-turn pair survived; failed row filtered out; in-flight
        # assistant placeholder filtered out; AND the just-inserted user
        # message ("second turn") is filtered out — the chat skill feeds
        # `ctx.user_message` separately as "User's latest message:" so
        # including it in the transcript would double it up.
        roles_and_content = [(m.role, m.content) for m in history]
        assert ("user", "first turn") in roles_and_content
        assert ("assistant", "first reply") in roles_and_content
        assert ("assistant", "oops") not in roles_and_content
        assert ("user", "second turn") not in roles_and_content
        # All surviving rows are complete user/assistant turns.
        for m in history:
            assert m.status == "complete"
            assert m.role in ("user", "assistant")

    # Story 6.2 AC 12: when a session is longer than the history window,
    # the chat handler must use the MOST-RECENT-N strategy. Otherwise
    # the agent gets the oldest 20 messages and silently loses context
    # on long-running conversations.
    def test_chat_history_picks_latest_messages_for_long_sessions(
        self, client: TestClient, db_session: Session
    ) -> None:
        from src.api.agent import _HISTORY_WINDOW  # noqa: PLC0415

        session = chat_service.create_session(db_session)
        # Seed the session with strictly more than the history window so
        # the OLDEST-N vs LATEST-N branches diverge.
        seed_count = _HISTORY_WINDOW + 5
        for i in range(seed_count):
            chat_service.create_message(
                db_session, session.id, role="user", content=f"old-{i}"
            )

        captured: dict[str, Any] = {}

        def _capture_run(
            ctx: Any, _skill: str, _msg_id: Any, _cancel_event: Any = None
        ) -> Any:
            from src.agent.crew_runner import CrewResult  # noqa: PLC0415

            captured["history"] = ctx.history
            return CrewResult(success=True, prose="ok", error=None)

        def _fake_stream(_q: Any) -> Iterator[str]:
            yield 'data: {"type":"done"}\n\n'

        class _ImmediateThread:
            def __init__(self, target: Any, daemon: bool = False) -> None:
                self._target = target

            def start(self) -> None:
                self._target()

        with (
            patch("src.api.agent.threading.Thread", _ImmediateThread),
            patch("src.api.agent._classify_intent", return_value="chat"),
            patch("src.api.agent.get_llm_for_agent", return_value=MagicMock()),
            patch("src.api.agent.run_crew", side_effect=_capture_run),
            patch("src.api.agent.stream_sse", side_effect=_fake_stream),
        ):
            resp = client.post(
                f"/api/agent/sessions/{session.id}/chat",
                json={"content": "the latest user turn"},
            )
        assert resp.status_code == 200

        history = captured["history"]
        # Window is filled — the chat handler fetches WINDOW + 2 to
        # absorb the latest user message and the assistant placeholder
        # that get filtered out, so the surviving history is exactly
        # `_HISTORY_WINDOW` rows of useful context.
        assert len(history) == _HISTORY_WINDOW
        contents = [m.content for m in history]
        # The OLDEST seeded message must NOT appear (out of window).
        assert "old-0" not in contents
        # The latest user turn was filtered out (handed to the skill
        # via ctx.user_message separately).
        assert "the latest user turn" not in contents
        # The most-recent seeded rows are inside the window.
        assert f"old-{seed_count - 1}" in contents
        # Specifically: the surviving messages are old-{seed_count -
        # _HISTORY_WINDOW} through old-{seed_count - 1}, in order.
        expected_first_in_window = f"old-{seed_count - _HISTORY_WINDOW}"
        assert contents[0] == expected_first_in_window
        assert contents[-1] == f"old-{seed_count - 1}"


# Story 6.1 CR Group E TP3: P29 GET /sessions/{id} endpoint.
class TestGetSessionDetail:
    def test_returns_session(self, client: TestClient, db_session: Session) -> None:
        session = chat_service.create_session(db_session)
        resp = client.get(f"/api/agent/sessions/{session.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == str(session.id)
        assert body["title"] is None

    def test_404_when_missing(self, client: TestClient) -> None:
        resp = client.get(f"/api/agent/sessions/{uuid.uuid4()}")
        assert resp.status_code == 404
        body = resp.json()
        assert body["error"] == "not_found"


# Story 6.1 CR Group E TP1: P23 cancel_chat session-scoped semantics.
# Tests touch the module-level _CANCEL_MAP directly because the public
# cancel handler doesn't otherwise expose its before/after state.
class TestCancelChat:
    def _seed_cancel_entries(
        self, session_id: str, msg_ids: list[str]
    ) -> dict[str, "object"]:
        import threading  # noqa: PLC0415

        from src.api.agent import _CANCEL_MAP, _CANCEL_MAP_LOCK  # noqa: PLC0415

        events = {mid: threading.Event() for mid in msg_ids}
        with _CANCEL_MAP_LOCK:
            _CANCEL_MAP.setdefault(session_id, {}).update(events)
        return events  # type: ignore[return-value]

    def _clear_map(self) -> None:
        from src.api.agent import _CANCEL_MAP, _CANCEL_MAP_LOCK  # noqa: PLC0415

        with _CANCEL_MAP_LOCK:
            _CANCEL_MAP.clear()

    def test_cancel_only_affects_target_session(self, client: TestClient) -> None:
        # The whole point of P23: cancelling session A must NOT fire
        # session B's events. Previously cancel_chat iterated the
        # global map.
        self._clear_map()
        sa = str(uuid.uuid4())
        sb = str(uuid.uuid4())
        events_a = self._seed_cancel_entries(sa, [str(uuid.uuid4())])
        events_b = self._seed_cancel_entries(sb, [str(uuid.uuid4())])

        resp = client.post(f"/api/agent/sessions/{sa}/cancel")
        assert resp.status_code == 202

        # All of A's events fired:
        for ev in events_a.values():
            assert ev.is_set()  # type: ignore[attr-defined]
        # None of B's events fired:
        for ev in events_b.values():
            assert not ev.is_set()  # type: ignore[attr-defined]

        self._clear_map()

    def test_cancel_unknown_session_is_idempotent(self, client: TestClient) -> None:
        self._clear_map()
        resp = client.post(f"/api/agent/sessions/{uuid.uuid4()}/cancel")
        assert resp.status_code == 202

    def test_cancel_pops_session_entry(self, client: TestClient) -> None:
        from src.api.agent import _CANCEL_MAP  # noqa: PLC0415

        self._clear_map()
        sa = str(uuid.uuid4())
        self._seed_cancel_entries(sa, [str(uuid.uuid4())])
        assert sa in _CANCEL_MAP

        client.post(f"/api/agent/sessions/{sa}/cancel")
        assert sa not in _CANCEL_MAP

        self._clear_map()


# Story 6.1 CR Group E TP2: finalise_assistant_message helper for P24+P28.
# Driven directly (no thread, no API) so each branch is observable.
class TestFinaliseAssistantMessage:
    def test_success_path_writes_complete_status_and_prose(
        self, db_session: Session
    ) -> None:
        from src.agent.crew_runner import CrewResult  # noqa: PLC0415
        from src.api.agent import finalise_assistant_message  # noqa: PLC0415

        session = chat_service.create_session(db_session)
        msg = chat_service.create_message(
            db_session,
            session.id,
            role="assistant",
            content="",
            status="pending",
        )

        finalise_assistant_message(
            msg.id,
            "chat",
            CrewResult(success=True, prose="here is the answer", error=None),
        )

        rows = chat_service.list_messages(db_session, session.id)
        assert rows[0].content == "here is the answer"
        assert rows[0].status == "complete"
        assert rows[0].skill == "chat"
        assert rows[0].error is None

    def test_failure_path_writes_generic_content_and_raw_error(
        self, db_session: Session
    ) -> None:
        # P28: the EXC string must NOT leak into `content` (could carry
        # API key / prompt). Generic "Agent run failed." in `content`;
        # raw error text only into `error`.
        from src.agent.crew_runner import CrewResult  # noqa: PLC0415
        from src.api.agent import finalise_assistant_message  # noqa: PLC0415

        session = chat_service.create_session(db_session)
        msg = chat_service.create_message(
            db_session,
            session.id,
            role="assistant",
            content="",
            status="pending",
        )

        finalise_assistant_message(
            msg.id,
            "chat",
            CrewResult(
                success=False,
                prose="",
                error="anthropic api error: sk-ant-leaked-key",
            ),
        )

        rows = chat_service.list_messages(db_session, session.id)
        assert rows[0].content == "Agent run failed."
        assert rows[0].status == "failed"
        assert rows[0].error == "anthropic api error: sk-ant-leaked-key"
        # P28 contract: the raw error string must NOT appear in content.
        assert "sk-ant-leaked-key" not in rows[0].content

    def test_vanished_message_is_logged_not_raised(self, db_session: Session) -> None:
        # If the assistant row was deleted mid-stream (e.g. delete_session
        # cascaded), update_message raises ChatMessageNotFoundError; the
        # helper must catch it and log instead of bubbling.
        from src.agent.crew_runner import CrewResult  # noqa: PLC0415
        from src.api.agent import finalise_assistant_message  # noqa: PLC0415

        # Pass a UUID that doesn't exist in the DB; should NOT raise.
        finalise_assistant_message(
            uuid.uuid4(),
            "chat",
            CrewResult(success=True, prose="x", error=None),
        )

    # Story 6.2 Group A CR P1: cancelled CrewResult writes status='cancelled'
    # rather than 'failed' so the row is visually distinct in the UI.
    def test_cancelled_path_writes_cancelled_status(self, db_session: Session) -> None:
        from src.agent.crew_runner import CrewResult  # noqa: PLC0415
        from src.api.agent import finalise_assistant_message  # noqa: PLC0415

        session = chat_service.create_session(db_session)
        msg = chat_service.create_message(
            db_session,
            session.id,
            role="assistant",
            content="",
            status="pending",
        )
        finalise_assistant_message(
            msg.id,
            "chat",
            CrewResult(
                success=False,
                prose="partial response that streamed before cancel",
                error="cancelled",
                cancelled=True,
            ),
        )
        rows = chat_service.list_messages(db_session, session.id)
        assert rows[0].status == "cancelled"
        # Whatever prose did stream is preserved so the user sees what
        # they got before cancelling, rather than a generic message.
        assert rows[0].content == "partial response that streamed before cancel"

    def test_cancelled_path_with_no_prose_writes_default_content(
        self, db_session: Session
    ) -> None:
        # Cancel-before-first-chunk: prose is empty; we don't want an
        # empty bubble in the UI.
        from src.agent.crew_runner import CrewResult  # noqa: PLC0415
        from src.api.agent import finalise_assistant_message  # noqa: PLC0415

        session = chat_service.create_session(db_session)
        msg = chat_service.create_message(
            db_session,
            session.id,
            role="assistant",
            content="",
            status="pending",
        )
        finalise_assistant_message(
            msg.id,
            "chat",
            CrewResult(success=False, prose="", error="cancelled", cancelled=True),
        )
        rows = chat_service.list_messages(db_session, session.id)
        assert rows[0].status == "cancelled"
        assert rows[0].content == "Cancelled."

    # Story 6.3: success path with metadata writes the envelope to the
    # JSONB metadata column so the frontend can rehydrate the proposal
    # block on panel reopen.
    def test_success_with_metadata_writes_proposal_envelope(
        self, db_session: Session
    ) -> None:
        from src.agent.crew_runner import CrewResult  # noqa: PLC0415
        from src.api.agent import finalise_assistant_message  # noqa: PLC0415

        session = chat_service.create_session(db_session)
        msg = chat_service.create_message(
            db_session,
            session.id,
            role="assistant",
            content="",
            status="pending",
        )

        envelope = {
            "proposal": {
                "kind": "text_rewrite",
                "payload": {
                    "suggestions": [
                        {
                            "field": "text",
                            "original": "old",
                            "revised": "new",
                            "reason": "clearer",
                        }
                    ],
                    "missing_fields": ["due_date"],
                },
                "targets": [str(uuid.uuid4())],
                "reasoning": "Made it crisper.",
            }
        }
        finalise_assistant_message(
            msg.id,
            "rephrase",
            CrewResult(
                success=True,
                prose="Made it crisper.",
                error=None,
                metadata=envelope,
            ),
        )

        rows = chat_service.list_messages(db_session, session.id)
        assert rows[0].content == "Made it crisper."
        assert rows[0].status == "complete"
        assert rows[0].skill == "rephrase"
        # Pydantic exposes the JSONB column under `metadata_` (the
        # trailing underscore avoids the Base.metadata clash).
        assert rows[0].metadata_ == envelope


class TestRephraseRoute:
    """Story 6.3 E2E coverage of the /chat route with the rephrase skill."""

    def test_chat_threads_context_through_to_skill(
        self, client: TestClient, db_session: Session
    ) -> None:
        """`body.context.todo_ids` must arrive in `SkillContext.context`
        so the rephrase skill can resolve `target_id` from it.
        """
        session = chat_service.create_session(db_session)
        target_id = uuid.uuid4()

        captured: dict[str, Any] = {}

        def _capture_run(
            ctx: Any, _skill: str, _msg_id: Any, _cancel_event: Any = None
        ) -> Any:
            from src.agent.crew_runner import CrewResult  # noqa: PLC0415

            captured["context"] = ctx.context
            return CrewResult(success=True, prose="ok", error=None)

        def _fake_stream(_q: Any) -> Iterator[str]:
            yield 'data: {"type":"done"}\n\n'

        class _ImmediateThread:
            def __init__(self, target: Any, daemon: bool = False) -> None:
                self._target = target

            def start(self) -> None:
                self._target()

        with (
            patch("src.api.agent.threading.Thread", _ImmediateThread),
            patch("src.api.agent.get_llm_for_agent", return_value=MagicMock()),
            patch("src.api.agent.run_crew", side_effect=_capture_run),
            patch("src.api.agent.stream_sse", side_effect=_fake_stream),
        ):
            resp = client.post(
                f"/api/agent/sessions/{session.id}/chat",
                json={
                    "content": "rephrase this",
                    "skill": "rephrase",
                    "context": {"todo_ids": [str(target_id)]},
                },
            )
        assert resp.status_code == 200
        assert captured["context"].todo_ids == [target_id]

    def test_chat_omitting_context_uses_empty_default(
        self, client: TestClient, db_session: Session
    ) -> None:
        """Pre-existing call sites (no `context`) keep working — the
        body schema fills in an empty ChatRequestContext."""
        session = chat_service.create_session(db_session)

        captured: dict[str, Any] = {}

        def _capture_run(
            ctx: Any, _skill: str, _msg_id: Any, _cancel_event: Any = None
        ) -> Any:
            from src.agent.crew_runner import CrewResult  # noqa: PLC0415

            captured["context"] = ctx.context
            return CrewResult(success=True, prose="ok", error=None)

        def _fake_stream(_q: Any) -> Iterator[str]:
            yield 'data: {"type":"done"}\n\n'

        class _ImmediateThread:
            def __init__(self, target: Any, daemon: bool = False) -> None:
                self._target = target

            def start(self) -> None:
                self._target()

        with (
            patch("src.api.agent.threading.Thread", _ImmediateThread),
            patch("src.api.agent._classify_intent", return_value="chat"),
            patch("src.api.agent.get_llm_for_agent", return_value=MagicMock()),
            patch("src.api.agent.run_crew", side_effect=_capture_run),
            patch("src.api.agent.stream_sse", side_effect=_fake_stream),
        ):
            resp = client.post(
                f"/api/agent/sessions/{session.id}/chat",
                json={"content": "hi"},
            )
        assert resp.status_code == 200
        assert captured["context"].todo_ids == []
