import queue
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from crewai import Crew
from sqlalchemy.orm import Session


@dataclass(frozen=True)
class SkillContext:
    """Immutable context passed to every skill builder."""

    session_id: uuid.UUID
    user_message: str
    session_factory: Callable[[], Session]
    llm: Any
    event_queue: "queue.Queue[dict[str, Any] | None]"


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


_register_skills()
