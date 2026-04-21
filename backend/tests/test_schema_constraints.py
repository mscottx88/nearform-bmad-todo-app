"""Database-level CHECK constraint coverage.

Pydantic already rejects invalid color + embedding_status values on API
ingress. These tests exercise the Postgres CHECK constraints added in
migration 3c3ff88ec089 — the last line of defence against raw SQL
or data-import paths that bypass pydantic.
"""

from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.models.todo import Todo


def test_embedding_status_check_rejects_invalid_value(db_session: Session) -> None:
    todo = Todo(text="check-me", embedding_status="not-a-real-status")
    db_session.add(todo)
    with pytest.raises(IntegrityError, match="ck_todos_embedding_status_values"):
        db_session.commit()
    db_session.rollback()


def test_embedding_status_check_accepts_all_three_valid_values(
    db_session: Session,
) -> None:
    for status in ("pending", "complete", "failed"):
        todo = Todo(text=f"status-{status}", embedding_status=status)
        db_session.add(todo)
        db_session.commit()
        db_session.refresh(todo)
        assert todo.embedding_status == status


def test_color_check_rejects_non_hex(db_session: Session) -> None:
    todo = Todo(text="bad color", color="red")
    db_session.add(todo)
    with pytest.raises(IntegrityError, match="ck_todos_color_hex"):
        db_session.commit()
    db_session.rollback()


def test_color_check_accepts_valid_hex(db_session: Session) -> None:
    todo = Todo(text="neon", color="#ff10f0")
    db_session.add(todo)
    db_session.commit()
    db_session.refresh(todo)
    assert todo.color == "#ff10f0"
