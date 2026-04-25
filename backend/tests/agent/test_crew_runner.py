"""Unit tests for crew_runner chunking and SSE streaming logic."""

import queue
import threading
import uuid
from unittest.mock import MagicMock, patch

from src.agent.crew_runner import (
    AGENT_CHUNK_DELAY_MS,
    MAX_CHUNKS_PER_RUN,
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

    # Story 6.2 Group A CR P3: `\r\n` line endings must round-trip via
    # raw concat. Previously `text.split("\n")` left a trailing `\r` on
    # every line, which `line.split()` then dropped — round-trip lost
    # `\r` chars. We normalize `\r\n` and bare `\r` to `\n` up front.
    def test_crlf_line_endings_round_trip(self) -> None:
        original = "first line\r\nsecond line\r\nthird line"
        chunks = _chunk_words(original)
        # Reconstruction matches the normalized form (CRLF → LF). We
        # don't promise to preserve the exact `\r` byte; we promise the
        # logical paragraph structure round-trips.
        assert "".join(chunks) == original.replace("\r\n", "\n")
        # And there are exactly two newline-separator chunks for the
        # two line breaks.
        assert chunks.count("\n") == 2

    def test_bare_cr_normalized_to_newline(self) -> None:
        # Old Mac-style `\r`-only line endings — uncommon, but if an LLM
        # ever emits them we still want clean chunking instead of
        # silently dropping the `\r`.
        chunks = _chunk_words("a\rb\rc")
        assert "".join(chunks) == "a\nb\nc"
        assert chunks.count("\n") == 2

    # Story 6.2 Group A CR P9: fenced code blocks stream verbatim so
    # leading whitespace and multi-space runs survive byte-level concat.
    def test_fenced_code_block_preserves_indentation(self) -> None:
        text = "Here's the fix:\n```python\n    def foo():\n        return 42\n```\nDone."
        chunks = _chunk_words(text)
        # Round-trip is exact for the fenced content — previously
        # `   def foo():` would have had its leading spaces collapsed
        # by the prose path's `line.split()`.
        assert "".join(chunks) == text
        # The fence lines are emitted as their own verbatim chunks.
        assert "```python" in chunks
        assert "```" in chunks
        # The indented lines appear verbatim — not word-tokenized.
        assert "    def foo():" in chunks
        assert "        return 42" in chunks

    def test_fenced_block_respects_max_chunks_cap(self) -> None:
        # A fenced block of MAX+1 lines must still hit the cap and
        # surface the truncation marker — verbatim emission can't be a
        # bypass route around `MAX_CHUNKS_PER_RUN`.
        body = "\n".join(["line"] * (MAX_CHUNKS_PER_RUN + 50))
        text = f"```\n{body}\n```"
        chunks = _chunk_words(text)
        assert chunks[-1] == "…[truncated]"

    # Story 6.2 Group A CR P4: a pathological response of 1000 empty
    # lines must still hit the cap. Previously the unconditional
    # `chunks.append("\n")` after each line could push past the cap
    # because the cap was only checked inside the word-grouping loop,
    # which an empty line skips.
    def test_empty_line_run_respects_max_chunks_cap(self) -> None:
        # 1000 empty lines → 999 newline-separator chunks if uncapped;
        # MAX_CHUNKS_PER_RUN should stop us well before that.
        text = "\n" * 1000
        chunks = _chunk_words(text)
        # The truncation marker is the last chunk on overflow.
        assert chunks[-1] == "…[truncated]"
        # Total chunk count is bounded by the cap + 1 for the marker.
        assert len(chunks) <= MAX_CHUNKS_PER_RUN + 1


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

    # Story 6.2 Group A CR P5: a missing skill name must produce a
    # controlled `unknown_skill` error code rather than leaking the
    # `KeyError(<bad name>)` repr through the broad-except path.
    def test_unknown_skill_emits_controlled_error(self) -> None:
        q: queue.Queue[dict | None] = queue.Queue()
        ctx = _make_ctx(q)
        with patch("src.agent.crew_runner.SKILL_REGISTRY", {}):
            result = run_crew(ctx, "no_such_skill", uuid.uuid4())
        assert result.success is False
        assert result.error == "unknown_skill"
        events = []
        while not q.empty():
            events.append(q.get())
        error_events = [
            e for e in events if isinstance(e, dict) and e.get("type") == "error"
        ]
        assert len(error_events) == 1
        assert error_events[0]["code"] == "unknown_skill"
        # The bad skill name itself MUST NOT appear in the user-visible
        # error message — that was the leak P5 is fixing.
        assert "no_such_skill" not in error_events[0]["message"]
        # Sentinel terminates the stream so the SSE consumer unblocks.
        assert events[-1] is None

    # Story 6.2 Group A CR P1: cancel_event short-circuits chunk
    # streaming. The LLM call itself isn't interruptible from outside,
    # but once the user clicks Cancel we must stop emitting further
    # chunks and write status='cancelled' rather than streaming the
    # full response.
    def test_cancel_event_stops_chunk_emission(self) -> None:
        q: queue.Queue[dict | None] = queue.Queue()
        ctx = _make_ctx(q)
        cancel_event = threading.Event()
        # Pre-set the cancel event so run_crew sees it as soon as the
        # post-kickoff check fires — cleaner than racing a real thread.
        cancel_event.set()

        mock_crew = MagicMock()
        mock_crew.kickoff.return_value = "this response should never stream"

        registry = {"chat": _mock_skill(mock_crew)}
        with (
            patch("src.agent.crew_runner.SKILL_REGISTRY", registry),
            patch("src.agent.crew_runner.time.sleep"),
        ):
            result = run_crew(ctx, "chat", uuid.uuid4(), cancel_event)

        assert result.cancelled is True
        assert result.success is False
        assert result.error == "cancelled"
        events = []
        while not q.empty():
            events.append(q.get())
        # The `cancelled` event was emitted; no `chunk` events made it
        # through the post-kickoff cancel check.
        cancelled_events = [
            e for e in events if isinstance(e, dict) and e.get("type") == "cancelled"
        ]
        chunk_events = [
            e for e in events if isinstance(e, dict) and e.get("type") == "chunk"
        ]
        assert len(cancelled_events) == 1
        assert chunk_events == []
        # `done` is NOT emitted on the cancel path.
        done_events = [
            e for e in events if isinstance(e, dict) and e.get("type") == "done"
        ]
        assert done_events == []
        assert events[-1] is None

    def test_cancel_event_pre_kickoff_skips_llm_call(self) -> None:
        # If cancel fires before crew.kickoff(), we must not pay for
        # the LLM round-trip at all.
        q: queue.Queue[dict | None] = queue.Queue()
        ctx = _make_ctx(q)
        cancel_event = threading.Event()
        cancel_event.set()

        mock_crew = MagicMock()
        registry = {"chat": _mock_skill(mock_crew)}
        with (
            patch("src.agent.crew_runner.SKILL_REGISTRY", registry),
            patch("src.agent.crew_runner.time.sleep"),
        ):
            result = run_crew(ctx, "chat", uuid.uuid4(), cancel_event)

        assert result.cancelled is True
        assert mock_crew.kickoff.call_count == 0


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
