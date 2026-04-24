import queue
import threading
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from src.agent.crew_runner import run_crew, stream_sse
from src.agent.llm import get_llm_for_agent
from src.agent.skills.registry import SKILL_REGISTRY, SkillContext
from src.database import SessionLocal, get_db
from src.exceptions import AppError
from src.schemas.agent import (
    ChatMessageResponse,
    ChatRequest,
    ChatSessionResponse,
)
from src.services import chat_service

router = APIRouter(prefix="/api/agent")

# In-memory cancellation map: assistant message id → cancel Event.
# Single-process only; a multi-worker deployment would require external state.
_CANCEL_MAP: dict[str, threading.Event] = {}


@router.post("/sessions", response_model=ChatSessionResponse)
def create_session(db: Session = Depends(get_db)) -> ChatSessionResponse:
    return chat_service.create_session(db)


@router.get("/sessions", response_model=list[ChatSessionResponse])
def list_sessions(db: Session = Depends(get_db)) -> list[ChatSessionResponse]:
    return chat_service.list_sessions(db)


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

    if body.skill is not None and body.skill not in SKILL_REGISTRY:
        raise AppError(
            error="invalid_skill",
            message=f"Unknown skill: {body.skill!r}",
            status_code=400,
        )

    user_msg = chat_service.create_message(
        db, session_id, role="user", content=body.content
    )
    assistant_msg = chat_service.create_message(
        db, session_id, role="assistant", content="", status="pending"
    )

    resolved_skill = body.skill
    if resolved_skill is None:
        resolved_skill = _classify_intent(body.content, session_id)

    q: queue.Queue[dict[str, Any] | None] = queue.Queue()
    cancel_event = threading.Event()
    _CANCEL_MAP[str(assistant_msg.id)] = cancel_event

    ctx = SkillContext(
        session_id=session_id,
        user_message=body.content,
        session_factory=SessionLocal,
        llm=get_llm_for_agent(),
        event_queue=q,
    )

    def _run_and_finalise() -> None:
        try:
            run_crew(ctx, resolved_skill)
            # Collect final prose from queue events that were already emitted,
            # then update the assistant row.
        except Exception as exc:  # noqa: BLE001
            with SessionLocal() as session:
                chat_service.update_message(
                    session,
                    assistant_msg.id,
                    content=str(exc),
                    status="failed",
                    error=str(exc),
                )
        finally:
            _CANCEL_MAP.pop(str(assistant_msg.id), None)

    t = threading.Thread(target=_run_and_finalise, daemon=True)
    t.start()

    _ = user_msg  # referenced above; suppress unused warning
    return StreamingResponse(stream_sse(q), media_type="text/event-stream")


@router.post("/sessions/{session_id}/cancel", status_code=202)
def cancel_chat(session_id: uuid.UUID) -> Response:
    for msg_id, event in list(_CANCEL_MAP.items()):
        event.set()
        _CANCEL_MAP.pop(msg_id, None)
    return Response(status_code=202)


def _classify_intent(user_message: str, session_id: uuid.UUID) -> str:
    """Run the intent classifier synchronously and return a skill name."""
    import logging  # noqa: PLC0415, I001
    from src.agent.skills.intent_classifier import (  # noqa: PLC0415
        build as build_classifier,
    )

    # isort: skip_file is not applicable here; local imports are intentional
    # to avoid circular imports at module load time.

    q: queue.Queue[dict[str, Any] | None] = queue.Queue()
    ctx = SkillContext(
        session_id=session_id,
        user_message=user_message,
        session_factory=SessionLocal,
        llm=get_llm_for_agent(),
        event_queue=q,
    )
    try:
        crew = build_classifier(ctx)
        result = str(crew.kickoff()).strip().lower()
        if result in SKILL_REGISTRY and result != "intent_classifier":
            return result
    except Exception as exc:  # noqa: BLE001
        logging.getLogger(__name__).debug("Intent classifier failed: %s", exc)
    return "chat"
