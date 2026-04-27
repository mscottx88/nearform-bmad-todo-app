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
from unittest.mock import MagicMock, patch

from src.agent.skills import chat as chat_skill
from src.agent.skills.chat import _format_task_description
from src.agent.skills.registry import SkillContext
from src.schemas.agent import ChatMessageResponse
from src.schemas.todo import TodoResponse


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
    def test_no_history_prepends_today_anchor_only(self) -> None:
        # 2026-04-26: chat skill now injects the today-date anchor on
        # every turn (was previously rephrase-only). This prevents
        # date hallucinations like "today is May 18, 2025" when the
        # user asks calendar-relative questions ("what's the date two
        # Sundays from now?"). With no history, the description is
        # `<today-line>\n\n<user-message>`.
        ctx = _make_ctx("hello there", history=())
        description = _format_task_description(ctx)
        assert description.endswith("hello there")
        assert "Today's date is" in description

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

        # 2026-04-26: today-anchor must precede the transcript so the
        # LLM can reason about calendar-relative questions ("two
        # Sundays from now") without hallucinating wrong years.
        today_idx = description.index("Today's date is")
        assert today_idx < transcript_idx

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
        description = _format_task_description(ctx)
        assert description.endswith("hi")
        assert "Today's date is" in description

    # 2026-04-26 cross-skill context fix: chat skill pre-loads the
    # user's active todos (id + text) into its task description so
    # the LLM always has UUIDs at hand for `[label](todo://<uuid>)`
    # link emission. Without this the LLM would paraphrase ("the X
    # task") and the rephrase resolver couldn't inherit the target
    # on follow-up turns.
    def test_active_todos_preloaded_with_ids(self) -> None:
        todo_id = uuid.uuid4()
        fake = TodoResponse(
            id=todo_id,
            text="Park hangout with Ryker",
            completed=False,
            color="#39ff14",
            position_x=0.0,
            position_y=0.0,
            rotation_y=0.0,
            drift_seed=0.0,
            due_date=None,
            embedding_status="complete",
            archived=False,
            archived_at=None,
            display_metadata={},
            deleted=False,
            deleted_at=None,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        ctx = _make_ctx("what's on my list?", history=())
        with patch.object(chat_skill.todo_service, "list_todos", return_value=[fake]):
            description = _format_task_description(ctx)
        assert "Your active todos" in description
        assert str(todo_id) in description
        assert "Park hangout with Ryker" in description

    def test_active_todos_preload_empty_when_pond_is_empty(self) -> None:
        ctx = _make_ctx("hello", history=())
        with patch.object(chat_skill.todo_service, "list_todos", return_value=[]):
            description = _format_task_description(ctx)
        # No "Your active todos" header when there are no rows to
        # surface — keeps the prompt clean.
        assert "Your active todos" not in description

    def test_active_todos_preload_swallows_db_failures(self) -> None:
        # If the preload fetch raises (DB blip, transient error),
        # the rest of the chat path stays functional. The block is
        # simply omitted; the LLM falls back to ListTodosTool.
        ctx = _make_ctx("hello", history=())
        with patch.object(
            chat_skill.todo_service,
            "list_todos",
            side_effect=RuntimeError("transient db error"),
        ):
            description = _format_task_description(ctx)
        assert "Your active todos" not in description
        # User message still ends the description as expected.
        assert description.endswith("hello")
