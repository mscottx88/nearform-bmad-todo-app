"""Unit tests for crew_runner chunking and SSE streaming logic."""

import queue
import uuid
from unittest.mock import MagicMock, patch

from src.agent.crew_runner import (
    AGENT_CHUNK_DELAY_MS,
    CrewResult,
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
        # Story 6.2: chunks now carry their own leading whitespace so
        # raw concatenation reconstructs the original prose. Previously
        # the test joined with " " — that masked the bug where the
        # frontend's byte-level concat produced "onetwo" instead of
        # "one two".
        assert "".join(chunks) == text

    def test_empty_string(self) -> None:
        assert _chunk_words("") == []

    def test_single_word(self) -> None:
        chunks = _chunk_words("hello")
        assert chunks == ["hello"]

    # Story 6.1 CR Group E TP5: P18 paragraph preservation.
    def test_preserves_line_breaks_with_newline_chunks(self) -> None:
        chunks = _chunk_words("first line here\nsecond line here")
        # The "\n" chunk must appear between the two lines.
        assert "\n" in chunks
        # Story 6.2: raw concat must reconstruct exactly.
        assert "".join(chunks) == "first line here\nsecond line here"

    def test_preserves_blank_line_between_paragraphs(self) -> None:
        # `"a\n\nb"` produces three lines: "a", "", "b". The empty line
        # contributes no word chunks, but TWO "\n" separator chunks
        # mark the blank-line boundary.
        chunks = _chunk_words("a\n\nb")
        assert chunks.count("\n") == 2

    # Story 6.2: explicit guard for the run-together-words bug. Two
    # adjacent chunks on the same line MUST round-trip with the inter-
    # chunk space preserved when concatenated raw.
    def test_chunks_concatenate_with_correct_word_spacing(self) -> None:
        text = "I'm sorry but I don't have access to weather information for Tumwater WA"
        chunks = _chunk_words(text)
        assert "".join(chunks) == text
        # Sanity: there is more than one chunk so we're actually
        # exercising the boundary case.
        word_chunks = [c for c in chunks if c != "\n"]
        assert len(word_chunks) > 1

    # Story 6.2: the chunk after a "\n" must NOT pick up a leading
    # space — that would surface as a leading whitespace at the start
    # of every line in the rendered chat bubble.
    def test_first_chunk_after_newline_has_no_leading_space(self) -> None:
        chunks = _chunk_words("first line here\nsecond line here")
        nl_idx = chunks.index("\n")
        # The chunk immediately after "\n" starts with a non-space
        # character (the first word of line two). Chunk-size is
        # random.randint(2, 5) so the exact word grouping varies, but
        # the leading-space invariant is deterministic.
        assert not chunks[nl_idx + 1].startswith(" ")


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

        assistant_id = uuid.uuid4()
        registry = {"chat": _mock_skill(mock_crew)}
        with (
            patch("src.agent.crew_runner.SKILL_REGISTRY", registry),
            patch("src.agent.crew_runner.time.sleep") as mock_sleep,
        ):
            result = run_crew(ctx, "chat", assistant_id)

        # Story 6.1 CR Group E TP7: assert the CrewResult contract.
        assert result.success is True
        assert result.prose == prose
        assert result.error is None
        # Deferred from Group E: assert sleep was actually called so a
        # regression that drops the chunk-pacing entirely (returning
        # empty list, no sleep, no `done`) would fail this test.
        assert mock_sleep.call_count >= 1

        events: list[dict | None] = []
        while not q.empty():
            events.append(q.get())

        first = events[0]
        assert isinstance(first, dict)
        assert first["type"] == "start"
        assert first["skill"] == "chat"
        # Story 6.2 AC 11: start payload echoes the assistant message id.
        assert first["message_id"] == str(assistant_id)

        chunk_events = [
            e for e in events if isinstance(e, dict) and e.get("type") == "chunk"
        ]
        assert len(chunk_events) >= 1
        # Story 6.2: chunks self-include leading whitespace so the SSE
        # consumer can do byte-level concat without losing word
        # boundaries.
        all_text = "".join(e["text"] for e in chunk_events)
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
            run_crew(ctx, "chat", uuid.uuid4())

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
            result = run_crew(ctx, "chat", uuid.uuid4())

        # TP7: CrewResult on the error path.
        assert result.success is False
        assert result.prose == ""
        assert result.error == "boom"

        events = []
        while not q.empty():
            events.append(q.get())

        error_events = [e for e in events if e is not None and e.get("type") == "error"]
        assert len(error_events) == 1
        assert error_events[0]["code"] == "agent_crew_failed"
        assert events[-1] is None

    # Story 6.1 CR Group E TP6: P20 empty-prose path.
    def test_empty_prose_emits_agent_empty_response_error(self) -> None:
        q: queue.Queue[dict | None] = queue.Queue()
        ctx = _make_ctx(q)

        mock_crew = MagicMock()
        mock_crew.kickoff.return_value = "   "  # whitespace only → strip → ""

        registry = {"chat": _mock_skill(mock_crew)}
        with (
            patch("src.agent.crew_runner.SKILL_REGISTRY", registry),
            patch("src.agent.crew_runner.time.sleep"),
        ):
            result = run_crew(ctx, "chat", uuid.uuid4())

        # TP7: CrewResult on the empty-prose path is a failure.
        assert isinstance(result, CrewResult)
        assert result.success is False
        assert result.prose == ""
        assert result.error == "agent returned no content"

        events = []
        while not q.empty():
            events.append(q.get())

        # Exactly one error event with the expected code, then None.
        error_events = [
            e for e in events if isinstance(e, dict) and e.get("type") == "error"
        ]
        assert len(error_events) == 1
        assert error_events[0]["code"] == "agent_empty_response"
        # No `done` event on the empty path.
        done_events = [
            e for e in events if isinstance(e, dict) and e.get("type") == "done"
        ]
        assert done_events == []
        # Sentinel terminates the stream.
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
