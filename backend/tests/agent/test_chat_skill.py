"""Tests for the `chat` skill builder — focuses on Task description shape.

Story 6.2 AC 12: the chat skill prepends a transcript of recent messages
to `Task.description` so the agent has conversational continuity without
calling `GetChatHistoryTool` on every turn. These tests drive the
formatter helper directly because building the full `Crew` requires a
real LLM (the CrewAI `Agent` constructor validates that `llm` is
non-empty, which a `MagicMock()` is not).
"""

import queue
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock

from src.agent.skills.chat import _format_task_description
from src.agent.skills.registry import SkillContext
from src.schemas.agent import ChatMessageResponse


def _make_message(
    role: str, content: str, status: str = "complete"
) -> ChatMessageResponse:
    return ChatMessageResponse(
        id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        role=role,
        content=content,
        skill=None,
        metadata_={},
        status=status,
        error=None,
        created_at=datetime.now(UTC),
    )


def _make_ctx(
    user_message: str,
    history: tuple[ChatMessageResponse, ...] = (),
) -> SkillContext:
    q: queue.Queue[dict[str, Any] | None] = queue.Queue()
    return SkillContext(
        session_id=uuid.uuid4(),
        user_message=user_message,
        session_factory=MagicMock(),
        llm=MagicMock(),
        event_queue=q,
        history=history,
    )


class TestChatSkillTaskDescription:
    def test_no_history_keeps_user_message_unchanged(self) -> None:
        ctx = _make_ctx("hello there", history=())
        assert _format_task_description(ctx) == "hello there"

    def test_history_is_prepended_as_transcript_block(self) -> None:
        history = (
            _make_message("user", "what's on my list?"),
            _make_message("assistant", "you have three todos."),
            _make_message("user", "tell me about the first one"),
            _make_message("assistant", "it's about milk."),
        )
        ctx = _make_ctx("and what colour is it?", history=history)
        description = _format_task_description(ctx)

        # Header line must be present.
        assert "Conversation so far:" in description
        # Each history line is rendered "<role>: <content>" in order.
        assert "user: what's on my list?" in description
        assert "assistant: you have three todos." in description
        assert "user: tell me about the first one" in description
        assert "assistant: it's about milk." in description
        # Latest message is appended after the transcript with the
        # explicit AC-12 prefix the spec requires.
        assert "User's latest message: and what colour is it?" in description

        # Order check: transcript block precedes the latest-message line.
        transcript_idx = description.index("Conversation so far:")
        latest_idx = description.index("User's latest message:")
        assert transcript_idx < latest_idx

    def test_default_history_is_empty_tuple(self) -> None:
        # Sanity check on the SkillContext default — the classifier path
        # constructs a context without `history` and must still work.
        q: queue.Queue[dict[str, Any] | None] = queue.Queue()
        ctx = SkillContext(
            session_id=uuid.uuid4(),
            user_message="hi",
            session_factory=MagicMock(),
            llm=MagicMock(),
            event_queue=q,
        )
        assert ctx.history == ()
        assert _format_task_description(ctx) == "hi"
