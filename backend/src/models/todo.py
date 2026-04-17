import uuid
from datetime import datetime

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class Todo(Base):
    __tablename__ = "todos"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    completed: Mapped[bool] = mapped_column(
        Boolean,
        server_default=sa.text("false"),
    )
    color: Mapped[str] = mapped_column(
        String(7),
        server_default=sa.text("'#00ff88'"),
    )
    position_x: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )
    position_y: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )
    embedding = mapped_column(Vector(768), nullable=True)
    embedding_status: Mapped[str] = mapped_column(
        String(20),
        server_default=sa.text("'pending'"),
    )
    archived: Mapped[bool] = mapped_column(
        Boolean,
        server_default=sa.text("false"),
    )
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    deleted: Mapped[bool] = mapped_column(
        Boolean,
        server_default=sa.text("false"),
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        Index(
            "ix_todos_active",
            "deleted",
            "archived",
            postgresql_where=sa.text("deleted = false"),
        ),
        Index(
            "ix_todos_text_search",
            sa.text("to_tsvector('english', text)"),
            postgresql_using="gin",
        ),
    )
