"""Unit tests for crew_runner chunking and SSE streaming logic."""

import queue
import uuid
from unittest.mock import MagicMock, patch

from src.agent.crew_runner import (
    AGENT_CHUNK_DELAY_MS,
    _chunk_words,
    run_crew,
    stream_sse,
)
from src.agent.skills.registry import SkillContext


def _make_ctx(q: "queue.Queue[dict | None]") -> SkillContext:
    return SkillContext(
        session_id=uuid.uuid4(),
        user_message="help me",
        session_factory=MagicMock(),
        llm=MagicMock(),
        event_queue=q,
    )


class TestChunkWords:
    def test_splits_into_groups(self) -> None:
        text = "one two three four five six seven eight nine ten"
        chunks = _chunk_words(text)
        joined = " ".join(chunks)
        assert joined == text

    def test_empty_string(self) -> None:
        assert _chunk_words("") == []

    def test_single_word(self) -> None:
        chunks = _chunk_words("hello")
        assert chunks == ["hello"]


def _mock_skill(crew: MagicMock) -> MagicMock:
    spec = MagicMock()
    spec.builder = lambda c: crew
    return spec


class TestRunCrew:
    def test_emits_start_chunks_done_sentinel(self) -> None:
        q: queue.Queue[dict | None] = queue.Queue()
        ctx = _make_ctx(q)
        prose = "Hello world how are you today"

        mock_crew = MagicMock()
        mock_crew.kickoff.return_value = prose

        registry = {"chat": _mock_skill(mock_crew)}
        with (
            patch("src.agent.crew_runner.SKILL_REGISTRY", registry),
            patch("src.agent.crew_runner.time.sleep"),
        ):
            run_crew(ctx, "chat")

        events: list[dict | None] = []
        while not q.empty():
            events.append(q.get())

        first = events[0]
        assert isinstance(first, dict)
        assert first["type"] == "start"
        assert first["skill"] == "chat"

        chunk_events = [
            e for e in events if isinstance(e, dict) and e.get("type") == "chunk"
        ]
        assert len(chunk_events) >= 1
        all_text = " ".join(e["text"] for e in chunk_events)
        assert all_text == prose

        non_none = [e for e in events if isinstance(e, dict)]
        assert non_none[-1]["type"] == "done"
        assert events[-1] is None

    def test_3s_delay_cap(self) -> None:
        q: queue.Queue[dict | None] = queue.Queue()
        ctx = _make_ctx(q)

        many_words = " ".join(["word"] * 100)
        mock_crew = MagicMock()
        mock_crew.kickoff.return_value = many_words

        sleep_calls: list[float] = []

        def capture_sleep(delay: float) -> None:
            sleep_calls.append(delay)

        registry = {"chat": _mock_skill(mock_crew)}
        with (
            patch("src.agent.crew_runner.SKILL_REGISTRY", registry),
            patch("src.agent.crew_runner.time.sleep", side_effect=capture_sleep),
        ):
            run_crew(ctx, "chat")

        chunks = _chunk_words(many_words)
        chunk_count = len(chunks)
        if chunk_count * (AGENT_CHUNK_DELAY_MS / 1000) > 3.0:
            expected_delay = 3.0 / chunk_count
            for delay in sleep_calls:
                assert abs(delay - expected_delay) < 1e-9

    def test_error_enqueues_error_event(self) -> None:
        q: queue.Queue[dict | None] = queue.Queue()
        ctx = _make_ctx(q)

        mock_crew = MagicMock()
        mock_crew.kickoff.side_effect = RuntimeError("boom")

        registry = {"chat": _mock_skill(mock_crew)}
        with (
            patch("src.agent.crew_runner.SKILL_REGISTRY", registry),
            patch("src.agent.crew_runner.time.sleep"),
        ):
            run_crew(ctx, "chat")

        events = []
        while not q.empty():
            events.append(q.get())

        error_events = [e for e in events if e is not None and e.get("type") == "error"]
        assert len(error_events) == 1
        assert error_events[0]["code"] == "agent_crew_failed"
        assert events[-1] is None


class TestStreamSSE:
    def test_yields_sse_lines(self) -> None:
        q: queue.Queue[dict | None] = queue.Queue()
        q.put({"type": "chunk", "text": "hello"})
        q.put({"type": "done"})
        q.put(None)

        lines = list(stream_sse(q))
        assert len(lines) == 2
        assert lines[0].startswith("data: ")
        assert lines[0].endswith("\n\n")

    def test_stops_on_sentinel(self) -> None:
        q: queue.Queue[dict | None] = queue.Queue()
        q.put(None)
        lines = list(stream_sse(q))
        assert lines == []
