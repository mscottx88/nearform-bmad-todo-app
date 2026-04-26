import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from src.exceptions import ChatMessageNotFoundError, ChatSessionNotFoundError
from src.models.chat_message import ChatMessage, ChatMessageStatus, ChatRole
from src.models.chat_session import ChatSession
from src.schemas.agent import ChatMessageResponse, ChatSessionResponse

_TITLE_MAX_CHARS = 60
# Story 6.1 CR P11: hard cap on the agent-tool side of `list_messages`.
# The HTTP route doesn't pass `limit`, but `GetChatHistoryTool` forwards
# an LLM-supplied value — without a ceiling a hallucinated `limit=1e7`
# materialises the entire table and blows the agent's context window.
_LIST_MESSAGES_HARD_CAP = 200
_LIST_MESSAGES_MIN = 1


def create_session(db: Session) -> ChatSessionResponse:
    session = ChatSession()
    db.add(session)
    db.commit()
    db.refresh(session)
    return ChatSessionResponse.model_validate(session)


def list_sessions(db: Session) -> list[ChatSessionResponse]:
    # Deferred from Group E: `updated_at`-only ordering flakes when two
    # sessions land in the same `func.now()` tick. Add `id` as the
    # secondary key so ordering stays deterministic across calls.
    rows = (
        db.query(ChatSession)
        .order_by(ChatSession.updated_at.desc(), ChatSession.id.desc())
        .all()
    )
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
    effective_limit = max(_LIST_MESSAGES_MIN, min(limit, _LIST_MESSAGES_HARD_CAP))
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
        .limit(effective_limit)
        .all()
    )
    return [ChatMessageResponse.model_validate(r) for r in rows]


def list_recent_messages(
    db: Session,
    session_id: uuid.UUID,
    limit: int,
) -> list[ChatMessageResponse]:
    """Return the MOST RECENT `limit` messages, oldest → newest.

    Story 6.2 AC 12: the chat handler needs the last N messages as a
    sliding context window — `list_messages` orders ASC + LIMIT, which
    silently returns the OLDEST N when the session has more than `limit`
    rows (exactly the opposite of what we want for context). This helper
    queries DESC + LIMIT then flips back to chronological order so the
    transcript reads naturally when prepended to the agent prompt.
    """
    get_session(db, session_id)
    effective_limit = max(_LIST_MESSAGES_MIN, min(limit, _LIST_MESSAGES_HARD_CAP))
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        # Tiebreak on `id` for determinism when two rows share a
        # microsecond-precision created_at (mirrors `list_sessions`'
        # post-CR ordering — same problem, same solution).
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(effective_limit)
        .all()
    )
    rows.reverse()
    return [ChatMessageResponse.model_validate(r) for r in rows]


def create_message(
    db: Session,
    session_id: uuid.UUID,
    role: ChatRole,
    content: str,
    *,
    skill: str | None = None,
    status: ChatMessageStatus = "complete",
) -> ChatMessageResponse:
    session_row = get_session(db, session_id)

    # Story 6.1 CR P13: reserve 3 chars for the ellipsis so the STORED
    # title is at most `_TITLE_MAX_CHARS` characters total (previously
    # 61-char content produced a 63-char title).
    if role == "user" and session_row.title is None:
        if len(content) > _TITLE_MAX_CHARS:
            session_row.title = content[: _TITLE_MAX_CHARS - 3] + "..."
        else:
            session_row.title = content

    message = ChatMessage(
        session_id=session_id,
        role=role,
        content=content,
        skill=skill,
        status=status,
    )
    db.add(message)
    session_row.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(message)
    return ChatMessageResponse.model_validate(message)


def update_message(
    db: Session,
    message_id: uuid.UUID,
    *,
    content: str,
    status: ChatMessageStatus,
    skill: str | None = None,
    error: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    # Story 6.1 CR P7: raise on missing rows so the caller can't mistake
    # "message was deleted between start-of-stream and finalisation" for
    # "finalised successfully". Previously we silently `return`ed.
    row = db.query(ChatMessage).filter(ChatMessage.id == message_id).first()
    if row is None:
        raise ChatMessageNotFoundError(str(message_id))
    row.content = content
    row.status = status
    if skill is not None:
        row.skill = skill
    if error is not None:
        row.error = error
    if metadata is not None:
        # Story 6.3: write to the ORM column attr `metadata_` (the
        # trailing underscore avoids the SQLAlchemy `Base.metadata`
        # reserved name). Replace-and-set rather than merge — the
        # caller is expected to pass a complete envelope.
        row.metadata_ = metadata
    # Story 6.1 CR P14: bump the parent session so `list_sessions`
    # ordering reflects stream completion, not just the initial insert.
    session_row = db.query(ChatSession).filter(ChatSession.id == row.session_id).first()
    if session_row is not None:
        session_row.updated_at = datetime.now(UTC)
    db.commit()
