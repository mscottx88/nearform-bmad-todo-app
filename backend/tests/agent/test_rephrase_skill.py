"""Story 6.3 — rephrase skill tests.

Target-todo resolution + task description shape. The full Crew is built
inside `build()`; CrewAI's Agent constructor validates `llm` so building
a real `Crew` requires either a real LLM or a careful mock.
`MagicMock()` works as `llm=`.
"""

import queue
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock, patch

from crewai import Crew

from src.agent.skills import rephrase
from src.agent.skills.registry import SKILL_REGISTRY, SkillContext
from src.schemas.agent import ChatMessageResponse, ChatRequestContext, RephraseEnvelope


def _make_ctx(
    user_message: str = "rephrase this",
    todo_ids: list[uuid.UUID] | None = None,
    history: tuple[ChatMessageResponse, ...] = (),
) -> SkillContext:
    q: queue.Queue[dict[str, Any] | None] = queue.Queue()
    context = ChatRequestContext(todo_ids=todo_ids or [])
    return SkillContext(
        session_id=uuid.uuid4(),
        user_message=user_message,
        session_factory=MagicMock(),
        llm=MagicMock(),
        event_queue=q,
        history=history,
        context=context,
    )


def _make_assistant_message_with_proposal(
    target_id: uuid.UUID,
) -> ChatMessageResponse:
    """Helper: assistant turn whose `metadata.proposal.targets` points
    at `target_id`. Used to test cross-turn history inheritance."""
    return ChatMessageResponse(
        id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        role="assistant",
        content="Here's a rewrite suggestion.",
        skill="rephrase",
        metadata_={
            "proposal": {
                "kind": "text_rewrite",
                "payload": {"suggestions": [], "missing_fields": []},
                "targets": [str(target_id)],
                "reasoning": "test",
            }
        },
        status="complete",
        error=None,
        created_at=datetime.now(UTC),
    )


# ─── Resolution helpers ──────────────────────────────────────────────


class TestTargetTodoResolution:
    def test_explicit_todo_ids_first_match_wins(self) -> None:
        wanted = uuid.uuid4()
        other = uuid.uuid4()
        ctx = _make_ctx(todo_ids=[wanted, other])
        assert rephrase._resolve_explicit_target_id(ctx) == wanted

    def test_uuid_extracted_from_user_message(self) -> None:
        wanted = uuid.uuid4()
        ctx = _make_ctx(
            user_message=f"please rephrase the todo with id {wanted}",
            todo_ids=[],
        )
        assert rephrase._resolve_explicit_target_id(ctx) == wanted

    def test_explicit_id_wins_over_message_uuid(self) -> None:
        # When BOTH are present, explicit selection (todo_ids) takes
        # precedence over a UUID-shaped substring in the message.
        wanted = uuid.uuid4()
        message_uuid = uuid.uuid4()
        ctx = _make_ctx(
            user_message=f"rephrase {message_uuid}",
            todo_ids=[wanted],
        )
        assert rephrase._resolve_explicit_target_id(ctx) == wanted

    def test_no_id_anywhere_returns_none(self) -> None:
        ctx = _make_ctx(user_message="rephrase this please", todo_ids=[])
        assert rephrase._resolve_explicit_target_id(ctx) is None


class TestHistoryResolver:
    """Cross-turn target inheritance: 'rephrase the dashboard task' →
    'add a due date' should pick up the dashboard target from the
    previous assistant turn's proposal."""

    def test_inherits_from_immediate_prior_assistant_proposal(self) -> None:
        wanted = uuid.uuid4()
        history = (
            _make_message("user", "rephrase the dashboard task"),
            _make_assistant_message_with_proposal(wanted),
        )
        ctx = _make_ctx(user_message="add a due date", todo_ids=[], history=history)
        assert rephrase._resolve_from_history(ctx) == wanted

    def test_returns_none_when_prior_assistant_had_no_proposal(self) -> None:
        # An assistant turn from a chat skill (not rephrase) leaves
        # metadata empty — we MUST NOT inherit a target from
        # unrelated context.
        plain = ChatMessageResponse(
            id=uuid.uuid4(),
            session_id=uuid.uuid4(),
            role="assistant",
            content="You have three todos.",
            skill="chat",
            metadata_={},
            status="complete",
            error=None,
            created_at=datetime.now(UTC),
        )
        history = (_make_message("user", "what's on my list?"), plain)
        ctx = _make_ctx(user_message="add a due date", history=history)
        assert rephrase._resolve_from_history(ctx) is None

    def test_returns_none_when_history_is_empty(self) -> None:
        ctx = _make_ctx(user_message="add a due date", history=())
        assert rephrase._resolve_from_history(ctx) is None

    def test_only_immediate_prior_assistant_is_consulted(self) -> None:
        # Even if an OLDER assistant turn had a proposal, the IMMEDIATE
        # prior assistant turn (which has no proposal) shadows it. We
        # don't reach back further — stale targets shouldn't leak.
        old_target = uuid.uuid4()
        history = (
            _make_message("user", "rephrase the dashboard task"),
            _make_assistant_message_with_proposal(old_target),
            _make_message("user", "what colour is my login pad?"),
            ChatMessageResponse(
                id=uuid.uuid4(),
                session_id=uuid.uuid4(),
                role="assistant",
                content="Cyan.",
                skill="chat",
                metadata_={},
                status="complete",
                error=None,
                created_at=datetime.now(UTC),
            ),
        )
        ctx = _make_ctx(user_message="add a due date", history=history)
        # The most-recent assistant turn was the chat reply with no
        # proposal — we must NOT reach back to the dashboard target.
        assert rephrase._resolve_from_history(ctx) is None

    # 2026-04-26 cross-skill context fix: when the chat skill names a
    # specific todo via the `[label](todo://<uuid>)` markdown link
    # convention (per BASE_SYSTEM_PROMPT REFERENCING TODOS rule), the
    # rephrase skill must inherit that target on the next user turn.
    # Without this, "How about the park date?" → "Yes let's add a date"
    # falls through to noisy hybrid-search results.
    def test_inherits_from_chat_turn_with_todo_link(self) -> None:
        wanted = uuid.uuid4()
        chat_reply = ChatMessageResponse(
            id=uuid.uuid4(),
            session_id=uuid.uuid4(),
            role="assistant",
            content=(
                f"You've got [Go hang out with Ryker at the park](todo://{wanted}) — "
                "no due date set yet."
            ),
            skill="chat",
            metadata_={},
            status="complete",
            error=None,
            created_at=datetime.now(UTC),
        )
        history = (_make_message("user", "How about a park date?"), chat_reply)
        ctx = _make_ctx(
            user_message="Yes let's add a date, two weekends from now",
            history=history,
        )
        assert rephrase._resolve_from_history(ctx) == wanted

    def test_chat_turn_without_todo_link_returns_none(self) -> None:
        # Chat reply that doesn't name a specific todo (just answers
        # the question generically) MUST NOT be mined for a link —
        # there isn't one to find.
        chat_reply = ChatMessageResponse(
            id=uuid.uuid4(),
            session_id=uuid.uuid4(),
            role="assistant",
            content="You have three todos in total.",
            skill="chat",
            metadata_={},
            status="complete",
            error=None,
            created_at=datetime.now(UTC),
        )
        history = (_make_message("user", "how many todos?"), chat_reply)
        ctx = _make_ctx(user_message="add a due date to it", history=history)
        assert rephrase._resolve_from_history(ctx) is None

    def test_chat_turn_with_multiple_todo_links_uses_first(self) -> None:
        # Multi-link replies (e.g. a list of todos) bias toward the
        # first one, which is usually the foregrounded reference. If
        # the user wanted a different one they'd phrase the request
        # more specifically.
        first = uuid.uuid4()
        second = uuid.uuid4()
        chat_reply = ChatMessageResponse(
            id=uuid.uuid4(),
            session_id=uuid.uuid4(),
            role="assistant",
            content=(
                f"You've got [first task](todo://{first}) and "
                f"[second task](todo://{second})."
            ),
            skill="chat",
            metadata_={},
            status="complete",
            error=None,
            created_at=datetime.now(UTC),
        )
        history = (_make_message("user", "what's on my list?"), chat_reply)
        ctx = _make_ctx(user_message="rephrase that", history=history)
        assert rephrase._resolve_from_history(ctx) == first

    def test_proposal_target_takes_priority_over_chat_link(self) -> None:
        # When the immediate prior assistant turn was BOTH a proposal
        # AND its content happens to embed a todo:// link (e.g. the
        # rephrase skill quoted another todo in its reasoning), the
        # proposal-targets path wins — that's the canonical inheritance.
        proposal_target = uuid.uuid4()
        link_target = uuid.uuid4()
        # Build a proposal message whose reasoning content also has a
        # link to a different todo.
        proposal_msg = ChatMessageResponse(
            id=uuid.uuid4(),
            session_id=uuid.uuid4(),
            role="assistant",
            content=(f"Made it crisper — see [related](todo://{link_target})."),
            skill="rephrase",
            metadata_={
                "proposal": {
                    "kind": "text_rewrite",
                    "targets": [str(proposal_target)],
                    "payload": {},
                    "reasoning": "x",
                }
            },
            status="complete",
            error=None,
            created_at=datetime.now(UTC),
        )
        history = (_make_message("user", "rephrase X"), proposal_msg)
        ctx = _make_ctx(user_message="add a due date", history=history)
        assert rephrase._resolve_from_history(ctx) == proposal_target


class TestSearchResolver:
    """Tests for `_resolve_via_search` — server-side disambiguation."""

    def _make_response(self, hits: list[tuple[uuid.UUID, str, float]]) -> Any:
        from src.schemas.search import SearchResponse, SearchResult  # noqa: PLC0415
        from src.schemas.todo import TodoResponse  # noqa: PLC0415

        results = []
        for tid, text, score in hits:
            todo = TodoResponse(
                id=tid,
                text=text,
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
            results.append(SearchResult(todo=todo, score=score, match_type="hybrid"))
        return SearchResponse(
            query="x",
            results=results,
            vector_search_unavailable=False,
            fts_supported=True,
        )

    def test_clear_winner_auto_resolves(self) -> None:
        wanted = uuid.uuid4()
        other = uuid.uuid4()
        ctx = _make_ctx(user_message="rephrase the dashboard task", todo_ids=[])
        with patch.object(
            rephrase.search_service,
            "hybrid_search",
            return_value=self._make_response(
                [(wanted, "Dashboard refactor", 0.95), (other, "Login fix", 0.30)]
            ),
        ):
            target_id, _target_todo, candidates = rephrase._resolve_via_search(ctx)
        assert target_id == wanted
        assert candidates == []

    def test_ambiguous_results_surface_candidate_chips(self) -> None:
        a = uuid.uuid4()
        b = uuid.uuid4()
        c = uuid.uuid4()
        ctx = _make_ctx(user_message="rephrase the dashboard task", todo_ids=[])
        with patch.object(
            rephrase.search_service,
            "hybrid_search",
            return_value=self._make_response(
                [
                    (a, "Dashboard refactor", 0.55),
                    (b, "Update dashboard tests", 0.50),
                    (c, "Dashboard auth flow", 0.45),
                ]
            ),
        ):
            target_id, _target_todo, candidates = rephrase._resolve_via_search(ctx)
        assert target_id is None
        assert len(candidates) == 3
        assert {c.id for c in candidates} == {a, b, c}

    def test_no_results_returns_empty(self) -> None:
        ctx = _make_ctx(user_message="rephrase the dashboard task", todo_ids=[])
        with patch.object(
            rephrase.search_service,
            "hybrid_search",
            return_value=self._make_response([]),
        ):
            target_id, _target_todo, candidates = rephrase._resolve_via_search(ctx)
        assert target_id is None
        assert candidates == []

    def test_search_failure_swallowed(self) -> None:
        # Embedding outage / DB failure → the skill silently degrades
        # to the empty-target fallback rather than crashing.
        ctx = _make_ctx(user_message="rephrase whatever", todo_ids=[])
        with patch.object(
            rephrase.search_service,
            "hybrid_search",
            side_effect=RuntimeError("embedding unreachable"),
        ):
            target_id, _target_todo, candidates = rephrase._resolve_via_search(ctx)
        assert target_id is None
        assert candidates == []

    def test_low_top_score_below_floor_does_not_auto_resolve(self) -> None:
        # Top hit has a clear gap to second-best but score < floor —
        # surface as candidates rather than auto-picking a weak match.
        a = uuid.uuid4()
        b = uuid.uuid4()
        ctx = _make_ctx(user_message="rephrase", todo_ids=[])
        with patch.object(
            rephrase.search_service,
            "hybrid_search",
            return_value=self._make_response(
                [(a, "barely matched", 0.20), (b, "even less", 0.04)]
            ),
        ):
            target_id, _target_todo, candidates = rephrase._resolve_via_search(ctx)
        assert target_id is None
        assert len(candidates) == 2

    # 2026-04-26 cross-skill context fix: when the user's bare message
    # is too generic for FTS to find the discussed todo (real-user
    # case: "rephrase the army base task to add mechanized units" on
    # a long Fort-Thunder thread), the resolver retries with an
    # ENRICHED query that appends the immediate-prior chat-skill
    # content. The prior turn's prose carries specific keywords that
    # match the actual todo text.
    def test_enriches_search_query_with_prior_chat_content_when_primary_weak(
        self,
    ) -> None:
        wanted = uuid.uuid4()
        # Prior chat-skill turn discussing the todo by name (no
        # `todo://` link — the symptom we're patching around).
        chat_reply = ChatMessageResponse(
            id=uuid.uuid4(),
            session_id=uuid.uuid4(),
            role="assistant",
            content=(
                "Based on the army base task — Fort Thunder, Commander Rex, "
                "Sergeant Bolt, Private Stone — there are no mechanized units."
            ),
            skill="chat",
            metadata_={},
            status="complete",
            error=None,
            created_at=datetime.now(UTC),
        )
        ctx = _make_ctx(
            user_message=("rephrase the army base task to add mechanized units"),
            todo_ids=[],
            history=(_make_message("user", "are there mechanized units?"), chat_reply),
        )
        # First search call (bare user message) returns nothing
        # useful; second call (enriched with chat content) hits the
        # Fort Thunder todo via FTS.
        weak_resp = self._make_response([])
        strong_resp = self._make_response(
            [(wanted, "Fort Thunder mission with Commander Rex", 0.78)]
        )
        with patch.object(
            rephrase.search_service,
            "hybrid_search",
            side_effect=[weak_resp, strong_resp],
        ):
            target_id, target_todo, candidates = rephrase._resolve_via_search(ctx)
        assert target_id == wanted
        assert target_todo is not None
        assert candidates == []

    def test_does_not_enrich_when_primary_search_was_strong(self) -> None:
        # Strong primary match (score >= 0.35 floor) wins outright;
        # the enriched second pass shouldn't fire because the user's
        # own keywords already nailed the target.
        wanted = uuid.uuid4()
        chat_reply = ChatMessageResponse(
            id=uuid.uuid4(),
            session_id=uuid.uuid4(),
            role="assistant",
            content="Talking about [Park hangout](todo://" + str(uuid.uuid4()) + ")",
            skill="chat",
            metadata_={},
            status="complete",
            error=None,
            created_at=datetime.now(UTC),
        )
        ctx = _make_ctx(
            user_message="rephrase the dashboard task",
            todo_ids=[],
            history=(_make_message("user", "list my todos"), chat_reply),
        )
        strong_resp = self._make_response([(wanted, "Dashboard refactor", 0.92)])
        with patch.object(
            rephrase.search_service,
            "hybrid_search",
            return_value=strong_resp,
        ) as spy:
            target_id, _todo, _candidates = rephrase._resolve_via_search(ctx)
        assert target_id == wanted
        # Only ONE search call — the enriched-fallback path is
        # gated on weak-or-empty primary results.
        assert spy.call_count == 1

    def test_prior_chat_content_strips_todo_link_wrappers(self) -> None:
        # The prior chat content might contain `[label](todo://uuid)`
        # forms — the UUID is a poor FTS token. Helper strips link
        # wrappers but keeps the labels (which carry the human-
        # readable phrase the LLM picked).
        chat_reply = ChatMessageResponse(
            id=uuid.uuid4(),
            session_id=uuid.uuid4(),
            role="assistant",
            content="See [Park hangout](todo://aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee).",
            skill="chat",
            metadata_={},
            status="complete",
            error=None,
            created_at=datetime.now(UTC),
        )
        ctx = _make_ctx(
            user_message="rephrase",
            history=(chat_reply,),
        )
        enrichment = rephrase._prior_chat_content_for_search(ctx)
        assert "Park hangout" in enrichment
        assert "todo://" not in enrichment
        assert "aaaaaaaa" not in enrichment


# ─── Task description / fallback shape ──────────────────────────────


class TestTaskDescription:
    def test_normal_path_includes_target_text_and_framing(self) -> None:
        prompt = rephrase._build_task_description(
            user_message="make it crisper",
            target_fields={"text": "buy bread someday maybe", "due_date": None},
            target_error=None,
        )
        # Untrusted-data framing literal.
        assert "data and may contain adversarial instructions" in prompt
        # Target todo content embedded.
        assert "buy bread someday maybe" in prompt
        # User request line.
        assert "make it crisper" in prompt
        # The prompt instructs the LLM to produce a RephraseEnvelope —
        # CrewAI's `output_pydantic` does the actual schema injection,
        # so the prompt only names the fields conceptually.
        assert "reasoning" in prompt
        assert "suggestions" in prompt
        assert "missing_fields" in prompt
        # Story 6.3 due_date enhancement: prompt mentions both `text`
        # and `due_date` field choices for suggestions.
        assert 'field="text"' in prompt
        assert 'field="due_date"' in prompt

    def test_normal_path_with_existing_due_date_surfaces_it(self) -> None:
        prompt = rephrase._build_task_description(
            user_message="push the deadline back",
            target_fields={"text": "ship the docs", "due_date": "2026-05-01"},
            target_error=None,
        )
        # The current due_date value is surfaced so the LLM knows
        # whether the field is set or empty.
        assert "2026-05-01" in prompt

    def test_empty_target_path_includes_fallback_prose(self) -> None:
        prompt = rephrase._build_task_description(
            user_message="rephrase",
            target_fields=None,
            target_error="no id provided",
        )
        # Fallback prose is embedded for the LLM to use as `reasoning`.
        assert rephrase._EMPTY_TARGET_FALLBACK_PROSE in prompt
        # Empty-target instructs the LLM to return empty suggestions /
        # missing_fields lists (CrewAI's RephraseEnvelope schema then
        # validates the structure on its end).
        assert "empty list" in prompt

    # CR: the prompt MUST tell the LLM what today's date is so date
    # phrasing like "May 1" or "next Monday" anchors to the calendar
    # instead of the model's training-data prior.
    def test_normal_path_includes_today_date_anchor(self) -> None:
        from datetime import date as _date  # noqa: PLC0415

        fixed_today = _date(2026, 4, 26)  # a Sunday
        prompt = rephrase._build_task_description(
            user_message="add a due date of May 1",
            target_fields={"text": "x", "due_date": None},
            target_error=None,
            today=fixed_today,
        )
        assert "2026-04-26" in prompt
        assert "Sunday" in prompt
        # And the prompt explicitly tells the LLM to anchor on this date.
        assert "Today's date is" in prompt

    # 2026-04-26 cross-skill context fix: the rephrase prompt now
    # includes the chat-history transcript so anaphoric references
    # like "make THAT the due date" can resolve to a date discussed
    # earlier in the conversation. Without this, the LLM has only
    # the current message + target todo and bails on "that".
    def test_normal_path_includes_chat_history_transcript(self) -> None:
        from src.schemas.agent import ChatMessageResponse  # noqa: PLC0415

        history = (
            ChatMessageResponse(
                id=uuid.uuid4(),
                session_id=uuid.uuid4(),
                role="user",
                content="What's the date two Sundays from now?",
                skill=None,
                metadata_={},
                status="complete",
                error=None,
                created_at=datetime.now(UTC),
            ),
            ChatMessageResponse(
                id=uuid.uuid4(),
                session_id=uuid.uuid4(),
                role="assistant",
                content="Two Sundays from now is May 10, 2026.",
                skill="chat",
                metadata_={},
                status="complete",
                error=None,
                created_at=datetime.now(UTC),
            ),
        )
        prompt = rephrase._build_task_description(
            user_message="Make that the due date for the park todo",
            target_fields={"text": "park hangout", "due_date": None},
            target_error=None,
            history=history,
        )
        # Transcript header + both turns rendered in the prompt.
        assert "Conversation so far" in prompt
        assert "user: What's the date two Sundays from now?" in prompt
        assert "assistant: Two Sundays from now is May 10, 2026." in prompt
        # Transcript precedes the User-request line so the LLM reads
        # context before the actionable request.
        transcript_idx = prompt.index("Conversation so far")
        request_idx = prompt.index("User request:")
        assert transcript_idx < request_idx

    def test_normal_path_omits_transcript_block_when_history_empty(
        self,
    ) -> None:
        # No history → no transcript-block markers leak into the prompt
        # (avoids the LLM seeing a header for an empty section).
        prompt = rephrase._build_task_description(
            user_message="add a due date",
            target_fields={"text": "x", "due_date": None},
            target_error=None,
            history=(),
        )
        assert "Conversation so far" not in prompt


# ─── Build crew with mocked tool fetch ──────────────────────────────


class TestBuildCrew:
    """build() invokes CrewAI's Agent + Task + Crew constructors which
    validate `llm` against `BaseLLM`. To exercise build() in unit
    tests without a real LLM client we patch the three constructor
    seams. The patched constructors capture their kwargs for
    assertion."""

    def _build_with_stubbed_crewai(
        self, ctx: SkillContext
    ) -> tuple[Crew, dict[str, Any]]:
        captured: dict[str, Any] = {}
        agent_sentinel = MagicMock(name="agent")
        task_sentinel = MagicMock(name="task")
        crew_sentinel = MagicMock(name="crew")
        crew_sentinel.tasks = [task_sentinel]
        crew_sentinel.agents = [agent_sentinel]

        def _fake_agent(**kwargs: Any) -> MagicMock:
            captured["agent_kwargs"] = kwargs
            return agent_sentinel

        def _fake_task(**kwargs: Any) -> MagicMock:
            captured["task_kwargs"] = kwargs
            for k, v in kwargs.items():
                setattr(task_sentinel, k, v)
            return task_sentinel

        def _fake_crew(**kwargs: Any) -> MagicMock:
            captured["crew_kwargs"] = kwargs
            return crew_sentinel

        with (
            patch.object(rephrase, "build_base_agent", side_effect=_fake_agent),
            patch.object(rephrase, "Task", side_effect=_fake_task),
            patch.object(rephrase, "Crew", side_effect=_fake_crew),
        ):
            crew = rephrase.build(ctx)
        return crew, captured

    def test_build_publishes_resolved_target_id_via_object_setattr(self) -> None:
        wanted = uuid.uuid4()
        ctx = _make_ctx(todo_ids=[wanted])
        with patch.object(
            rephrase,
            "_fetch_todo_content",
            return_value=(
                {"text": "some todo text", "due_date": None},
                None,
            ),
        ):
            _crew, captured = self._build_with_stubbed_crewai(ctx)
        assert ctx.resolved_target_id == wanted
        # Single-agent, single-task, sequential crew.
        crew_kwargs = captured["crew_kwargs"]
        assert len(crew_kwargs["agents"]) == 1
        assert len(crew_kwargs["tasks"]) == 1
        # Target text was front-loaded into the task description.
        assert "some todo text" in captured["task_kwargs"]["description"]

    def test_build_falls_back_when_tool_returns_error(self) -> None:
        # If the up-front fetch errors (todo not found / soft-deleted),
        # the skill must hard-flip to the empty-target fallback path so
        # the LLM produces helpful prose instead of "tool failed".
        wanted = uuid.uuid4()
        ctx = _make_ctx(todo_ids=[wanted])
        with patch.object(
            rephrase,
            "_fetch_todo_content",
            return_value=(None, "Todo not found"),
        ):
            _crew, captured = self._build_with_stubbed_crewai(ctx)
        # resolved_target_id must be reset to None on the fallback path
        # — we're no longer rephrasing a specific row.
        assert ctx.resolved_target_id is None
        # Task description carries the fallback prose.
        prompt = captured["task_kwargs"]["description"]
        assert rephrase._EMPTY_TARGET_FALLBACK_PROSE in prompt

    # CR: when the user explicitly named a target (todo_ids[0]) and
    # the fetch fails, we must NOT fall through to history+search —
    # that would surface unrelated chips for "rephrase this" instead
    # of the specific todo they meant. Verify the explicit-id failure
    # short-circuits to empty-target.
    def test_explicit_id_failure_does_not_fall_through_to_search(self) -> None:
        wanted = uuid.uuid4()
        ctx = _make_ctx(user_message="rephrase the dashboard task", todo_ids=[wanted])
        with (
            patch.object(
                rephrase,
                "_fetch_todo_content",
                return_value=(None, "Todo not found"),
            ),
            patch.object(rephrase, "_resolve_via_search") as search_spy,
            patch.object(rephrase, "_resolve_from_history") as history_spy,
        ):
            _crew, captured = self._build_with_stubbed_crewai(ctx)
        # Neither secondary resolver should run on the explicit-id
        # failure path — the user named THAT todo, period.
        search_spy.assert_not_called()
        history_spy.assert_not_called()
        assert ctx.resolved_target_id is None
        prompt = captured["task_kwargs"]["description"]
        assert rephrase._EMPTY_TARGET_FALLBACK_PROSE in prompt

    def test_build_with_no_id_anywhere_uses_fallback(self) -> None:
        ctx = _make_ctx(user_message="rephrase this", todo_ids=[])
        # Should NOT call _fetch_todo_content because there's no id.
        with patch.object(rephrase, "_fetch_todo_content") as mock_fetch:
            _crew, captured = self._build_with_stubbed_crewai(ctx)
        mock_fetch.assert_not_called()
        assert ctx.resolved_target_id is None
        prompt = captured["task_kwargs"]["description"]
        assert rephrase._EMPTY_TARGET_FALLBACK_PROSE in prompt

    def test_task_uses_output_pydantic_for_structured_output(self) -> None:
        # CrewAI's `output_pydantic=RephraseEnvelope` is the contract
        # surface — it makes CrewAI parse the LLM response as the
        # Pydantic model, validate it, and expose the instance via
        # `CrewOutput.pydantic`. crew_runner reads that, so the model
        # MUST be wired on the Task.
        ctx = _make_ctx(user_message="rephrase", todo_ids=[])
        _crew, captured = self._build_with_stubbed_crewai(ctx)
        assert captured["task_kwargs"]["output_pydantic"] is RephraseEnvelope


# ─── Registry registration ──────────────────────────────────────────


class TestRegistryRegistration:
    def test_rephrase_registered_with_text_rewrite_proposal_kind(self) -> None:
        assert "rephrase" in SKILL_REGISTRY
        spec = SKILL_REGISTRY["rephrase"]
        assert spec.proposal_kind == "text_rewrite"
        assert spec.builder is rephrase.build

    def test_chat_proposal_kind_remains_none(self) -> None:
        # Pre-existing skills must NOT pick up a proposal_kind by
        # accident — the parse-and-emit pipeline only fires for skills
        # whose registry entry declares one.
        assert SKILL_REGISTRY["chat"].proposal_kind is None
        assert SKILL_REGISTRY["intent_classifier"].proposal_kind is None


# ─── ChatRequestContext default propagation ─────────────────────────


def test_skillcontext_default_context_is_empty() -> None:
    """Pre-existing call sites omit `context=`; the default must be a
    fresh empty ChatRequestContext (no shared mutable state across
    calls)."""
    q: queue.Queue[dict[str, Any] | None] = queue.Queue()
    ctx_a = SkillContext(
        session_id=uuid.uuid4(),
        user_message="hi",
        session_factory=MagicMock(),
        llm=MagicMock(),
        event_queue=q,
    )
    ctx_b = SkillContext(
        session_id=uuid.uuid4(),
        user_message="hi",
        session_factory=MagicMock(),
        llm=MagicMock(),
        event_queue=q,
    )
    assert ctx_a.context.todo_ids == []
    assert ctx_b.context.todo_ids == []
    # Different instances — appending to one must not affect the other
    # (default_factory, not a shared default).
    ctx_a.context.todo_ids.append(uuid.uuid4())
    assert ctx_b.context.todo_ids == []


def _make_message(role: str, content: str) -> ChatMessageResponse:
    """History-row helper kept to satisfy the import in the regression
    sketch below; it would be used if we wanted to assert history
    propagation through the rephrase skill."""
    return ChatMessageResponse(
        id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        role=role,
        content=content,
        skill=None,
        metadata_={},
        status="complete",
        error=None,
        created_at=datetime.now(UTC),
    )
