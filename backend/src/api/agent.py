import logging
import queue
import threading
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from src.agent.crew_runner import CrewResult, run_crew, stream_sse
from src.agent.llm import get_llm_for_agent
from src.agent.skills.registry import SKILL_REGISTRY, SkillContext
from src.database import SessionLocal, get_db
from src.exceptions import AppError, ChatMessageNotFoundError
from src.schemas.agent import (
    ChatMessageResponse,
    ChatRequest,
    ChatSessionResponse,
)
from src.services import chat_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent")

# In-memory cancellation map: session_id → {assistant_message_id → Event}.
#
# Story 6.1 CR P23: previously a flat dict keyed by assistant_message_id, which
# made `cancel_chat(session_id)` a global kill-switch (it iterated every entry
# and set every Event). The two-level shape lets `cancel_chat` look up only
# the events for the supplied session_id and leave other sessions untouched.
#
# Story 6.1 CR P27: every mutation goes through `_CANCEL_MAP_LOCK` because the
# chat handler, the worker thread's `finally`, and `cancel_chat` all touch
# this dict concurrently. Single-process only — multi-worker would need
# external state (Redis), already noted as a known limitation.
_CANCEL_MAP: dict[str, dict[str, threading.Event]] = {}
_CANCEL_MAP_LOCK = threading.Lock()

# Internal skill names cannot be invoked directly through the API. The
# intent classifier is registered for `_classify_intent` to use; exposing
# it as a user-facing skill leaks an internal routing primitive.
_INTERNAL_SKILLS: frozenset[str] = frozenset({"intent_classifier"})


def finalise_assistant_message(
    assistant_msg_id: uuid.UUID,
    resolved_skill: str,
    result: CrewResult,
) -> None:
    """Write the final assistant DB row based on the run_crew CrewResult.

    Extracted as a module-level function (Story 6.1 CR Group E TP2) so
    the success / failure / row-vanished branches can be unit-tested
    without driving the full chat handler. Called from inside the worker
    thread spawned by `chat()` and bypasses the request-scoped session
    by opening its own `SessionLocal()`.

    P24: handles success path (update with content=prose, status=complete).
    P28: failure path writes generic 'Agent run failed.' into the
    user-visible content column; raw exception text only goes into the
    `error` column.
    """
    try:
        with SessionLocal() as session:
            if result.success:
                chat_service.update_message(
                    session,
                    assistant_msg_id,
                    content=result.prose,
                    status="complete",
                    skill=resolved_skill,
                )
            else:
                chat_service.update_message(
                    session,
                    assistant_msg_id,
                    content="Agent run failed.",
                    status="failed",
                    skill=resolved_skill,
                    error=result.error,
                )
    except ChatMessageNotFoundError:
        logger.warning(
            "assistant message %s vanished during finalisation",
            assistant_msg_id,
        )


@router.post("/sessions", response_model=ChatSessionResponse)
def create_session(db: Session = Depends(get_db)) -> ChatSessionResponse:
    return chat_service.create_session(db)


@router.get("/sessions", response_model=list[ChatSessionResponse])
def list_sessions(db: Session = Depends(get_db)) -> list[ChatSessionResponse]:
    return chat_service.list_sessions(db)


@router.get("/sessions/{session_id}", response_model=ChatSessionResponse)
def get_session_detail(
    session_id: uuid.UUID, db: Session = Depends(get_db)
) -> ChatSessionResponse:
    """Story 6.1 CR P29: AC 2 explicitly specifies the 404 contract for
    GET /api/agent/sessions/{id}; this endpoint was missing entirely.
    Returns the session row or raises ChatSessionNotFoundError (404)."""
    return ChatSessionResponse.model_validate(chat_service.get_session(db, session_id))


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    chat_service.delete_session(db, session_id)
    return Response(status_code=204)


@router.get("/sessions/{session_id}/messages", response_model=list[ChatMessageResponse])
def get_messages(
    session_id: uuid.UUID, db: Session = Depends(get_db)
) -> list[ChatMessageResponse]:
    return chat_service.list_messages(db, session_id)


@router.post("/sessions/{session_id}/chat")
def chat(
    session_id: uuid.UUID,
    body: ChatRequest,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    chat_service.get_session(db, session_id)

    # Story 6.1 CR P25: also reject internal-only skills explicitly.
    if body.skill is not None and (
        body.skill not in SKILL_REGISTRY or body.skill in _INTERNAL_SKILLS
    ):
        raise AppError(
            error="invalid_skill",
            message=f"Unknown skill: {body.skill!r}",
            status_code=400,
        )

    chat_service.create_message(db, session_id, role="user", content=body.content)
    assistant_msg = chat_service.create_message(
        db, session_id, role="assistant", content="", status="pending"
    )
    assistant_msg_id = assistant_msg.id

    resolved_skill = body.skill
    if resolved_skill is None:
        resolved_skill = _classify_intent(body.content, session_id)

    q: queue.Queue[dict[str, Any] | None] = queue.Queue()
    cancel_event = threading.Event()

    session_key = str(session_id)
    msg_key = str(assistant_msg_id)
    with _CANCEL_MAP_LOCK:
        _CANCEL_MAP.setdefault(session_key, {})[msg_key] = cancel_event

    ctx = SkillContext(
        session_id=session_id,
        user_message=body.content,
        session_factory=SessionLocal,
        llm=get_llm_for_agent(),
        event_queue=q,
    )

    def _run_and_finalise() -> None:
        try:
            result = run_crew(ctx, resolved_skill)
            finalise_assistant_message(assistant_msg_id, resolved_skill, result)
        finally:
            with _CANCEL_MAP_LOCK:
                session_events = _CANCEL_MAP.get(session_key)
                if session_events is not None:
                    session_events.pop(msg_key, None)
                    if not session_events:
                        _CANCEL_MAP.pop(session_key, None)

    t = threading.Thread(target=_run_and_finalise, daemon=True)
    t.start()

    return StreamingResponse(stream_sse(q), media_type="text/event-stream")


@router.post("/sessions/{session_id}/cancel", status_code=202)
def cancel_chat(session_id: uuid.UUID) -> Response:
    """Story 6.1 CR P23: cancel ONLY the events for the supplied session.
    Previously this iterated every entry in `_CANCEL_MAP` and called
    `event.set()` globally — any user could abort every other in-flight
    chat across the entire process."""
    with _CANCEL_MAP_LOCK:
        session_events = _CANCEL_MAP.pop(str(session_id), {})
    for event in session_events.values():
        event.set()
    return Response(status_code=202)


def _classify_intent(user_message: str, session_id: uuid.UUID) -> str:
    """Run the intent classifier synchronously and return a skill name.

    Story 6.1 CR P26: uses `SKILL_REGISTRY["intent_classifier"].builder`
    via the registry that's already imported at module top — drops the
    local-import workaround and the dead `# isort: skip_file` comment.
    """
    q: queue.Queue[dict[str, Any] | None] = queue.Queue()
    ctx = SkillContext(
        session_id=session_id,
        user_message=user_message,
        session_factory=SessionLocal,
        llm=get_llm_for_agent(),
        event_queue=q,
    )
    try:
        crew = SKILL_REGISTRY["intent_classifier"].builder(ctx)
        result = str(crew.kickoff()).strip().lower()
        if result in SKILL_REGISTRY and result not in _INTERNAL_SKILLS:
            return result
    except Exception as exc:  # noqa: BLE001
        logger.debug("Intent classifier failed: %s", exc)
    return "chat"
