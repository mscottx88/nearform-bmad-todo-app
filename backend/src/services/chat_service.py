import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from src.exceptions import ChatSessionNotFoundError
from src.models.chat_message import ChatMessage, ChatMessageStatus, ChatRole
from src.models.chat_session import ChatSession
from src.schemas.agent import ChatMessageResponse, ChatSessionResponse

_TITLE_MAX_CHARS = 60


def create_session(db: Session) -> ChatSessionResponse:
    session = ChatSession()
    db.add(session)
    db.commit()
    db.refresh(session)
    return ChatSessionResponse.model_validate(session)


def list_sessions(db: Session) -> list[ChatSessionResponse]:
    rows = db.query(ChatSession).order_by(ChatSession.updated_at.desc()).all()
    return [ChatSessionResponse.model_validate(r) for r in rows]


def get_session(db: Session, session_id: uuid.UUID) -> ChatSession:
    row = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not row:
        raise ChatSessionNotFoundError(str(session_id))
    return row


def delete_session(db: Session, session_id: uuid.UUID) -> None:
    row = get_session(db, session_id)
    db.delete(row)
    db.commit()


def list_messages(
    db: Session,
    session_id: uuid.UUID,
    limit: int = 100,
) -> list[ChatMessageResponse]:
    get_session(db, session_id)
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
        .limit(limit)
        .all()
    )
    return [ChatMessageResponse.model_validate(r) for r in rows]


def create_message(
    db: Session,
    session_id: uuid.UUID,
    role: ChatRole,
    content: str,
    *,
    skill: str | None = None,
    status: ChatMessageStatus = "complete",
) -> ChatMessage:
    session_row = get_session(db, session_id)

    if role == "user" and session_row.title is None:
        trimmed = content[:_TITLE_MAX_CHARS]
        if len(content) > _TITLE_MAX_CHARS:
            trimmed += "..."
        session_row.title = trimmed

    message = ChatMessage(
        session_id=session_id,
        role=role,
        content=content,
        skill=skill,
        status=status,
    )
    db.add(message)
    session_row.updated_at = datetime.now(UTC)
    db.flush()
    db.commit()
    db.refresh(message)
    return message


def update_message(
    db: Session,
    message_id: uuid.UUID,
    *,
    content: str,
    status: ChatMessageStatus,
    skill: str | None = None,
    error: str | None = None,
) -> None:
    row = db.query(ChatMessage).filter(ChatMessage.id == message_id).first()
    if not row:
        return
    row.content = content
    row.status = status
    if skill is not None:
        row.skill = skill
    if error is not None:
        row.error = error
    db.commit()
