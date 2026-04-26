import queue
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from crewai import Crew
from sqlalchemy.orm import Session

from src.schemas.agent import ChatMessageResponse, ChatRequestContext


@dataclass(frozen=True)
class SkillContext:
    """Immutable context passed to every skill builder."""

    session_id: uuid.UUID
    user_message: str
    session_factory: Callable[[], Session]
    llm: Any
    event_queue: "queue.Queue[dict[str, Any] | None]"
    # Story 6.2 AC 12: pre-loaded chat transcript (oldest → newest) so
    # skills can prepend conversation context to the Task description
    # without paying for a `GetChatHistoryTool` call on every turn.
    # Tuple (not list) because the dataclass is frozen — an empty tuple
    # is a safe immutable default. Call sites that don't need history
    # (intent classifier, synthetic test contexts) can omit the field.
    history: tuple[ChatMessageResponse, ...] = ()
    # Story 6.3 AC 2: explicit selection from the chat request body (e.g.
    # `todo_ids` for rephrase). Pre-existing skills (chat / classifier)
    # ignore this; new skills like rephrase resolve the target todo from
    # `context.todo_ids[0]`. ChatRequestContext is a Pydantic model with
    # a list default — frozen dataclasses can't carry a mutable default
    # directly, so a `default_factory` builds a fresh empty instance per
    # SkillContext. The empty default keeps it backward compatible.
    context: ChatRequestContext = field(default_factory=ChatRequestContext)
    # Story 6.3 AC 4: skills that own a proposal envelope set this so
    # `crew_runner` can fold it into the `proposal.targets` array
    # without re-parsing the user message. None for skills with no
    # canonical target (chat, classifier).
    resolved_target_id: uuid.UUID | None = None
    # Story 6.3 user-driven enhancement: when the rephrase skill's
    # search resolver returns ambiguous results, it stamps the
    # candidates here. `crew_runner` folds them into the proposal
    # envelope payload so the renderer can show them as clickable
    # chips. Default `None` (not empty list) so the proposal payload
    # only carries the field when relevant.
    resolved_candidates: Any = None


@dataclass(frozen=True)
class SkillSpec:
    """Registry entry for a single skill."""

    name: str
    description: str
    proposal_kind: str | None
    builder: Callable[[SkillContext], Crew]


# Populated after skill modules are imported (see bottom of this file).
SKILL_REGISTRY: dict[str, SkillSpec] = {}


def _register_skills() -> None:
    from src.agent.skills.chat import build as build_chat  # noqa: PLC0415
    from src.agent.skills.intent_classifier import (  # noqa: PLC0415
        build as build_classifier,
    )
    from src.agent.skills.rephrase import build as build_rephrase  # noqa: PLC0415

    SKILL_REGISTRY["chat"] = SkillSpec(
        name="chat",
        description=(
            "General-purpose conversational assistant with access to todos"
            " and chat history."
        ),
        proposal_kind=None,
        builder=build_chat,
    )
    SKILL_REGISTRY["intent_classifier"] = SkillSpec(
        name="intent_classifier",
        description=(
            "Internal routing skill — classifies user intent and returns"
            " the best skill name."
        ),
        proposal_kind=None,
        builder=build_classifier,
    )
    # Story 6.3: rephrase produces a structured proposal envelope
    # (`text_rewrite` discriminator on the wire, see crew_runner +
    # frontend/RephraseProposal.tsx). proposal_kind being non-None is
    # what flips crew_runner into the parse-and-emit-proposal pipeline.
    SKILL_REGISTRY["rephrase"] = SkillSpec(
        name="rephrase",
        description=(
            "Edit, rephrase, clarify, or add missing details (due "
            "dates, scope, deadlines, context) to a single existing "
            "todo. Use this for ANY request that changes an existing "
            "todo's text — phrases like 'rephrase X', 'reword X', "
            "'make X clearer', 'add a due date to X', 'edit X', "
            "'tighten up X'. The user's wording does NOT need to "
            "include the verb 'rephrase'."
        ),
        proposal_kind="text_rewrite",
        builder=build_rephrase,
    )


_register_skills()
