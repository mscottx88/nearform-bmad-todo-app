import uuid
from datetime import datetime
from typing import Any, Literal

import sqlalchemy as sa
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base

# Mirrors the DB CHECK constraints below. Typing the columns as
# `Mapped[Literal[...]]` lets mypy --strict catch typos at the
# constructor site (e.g. `ChatMessage(role="User")`) rather than letting
# them bubble up as a CheckConstraint violation at flush.
ChatRole = Literal["user", "assistant", "system", "tool"]
ChatMessageStatus = Literal["pending", "streaming", "complete", "failed", "cancelled"]


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[ChatRole] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    skill: Mapped[str | None] = mapped_column(String(64), nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        server_default=sa.text("'{}'::jsonb"),
        nullable=False,
    )
    status: Mapped[ChatMessageStatus] = mapped_column(
        String(16),
        server_default=sa.text("'complete'"),
        nullable=False,
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    __table_args__ = (
        Index("idx_chat_messages_session_created", "session_id", "created_at"),
        CheckConstraint(
            "role IN ('user','assistant','system','tool')",
            name="ck_chat_messages_role",
        ),
        CheckConstraint(
            "status IN ('pending','streaming','complete','failed','cancelled')",
            name="ck_chat_messages_status",
        ),
    )
