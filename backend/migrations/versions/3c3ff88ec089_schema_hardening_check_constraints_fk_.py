"""schema hardening — check constraints + fk ondelete

Revision ID: 3c3ff88ec089
Revises: 7af34c6df37c
Create Date: 2026-04-20 17:38:18.003436

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3c3ff88ec089'
down_revision: Union[str, None] = '7af34c6df37c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. todos.embedding_status: restrict to the three values used by the
    #    worker state machine. Previously String(20) with no constraint —
    #    a typo like 'complete ' or 'PENDING' would silently write and
    #    break downstream filters.
    op.create_check_constraint(
        "ck_todos_embedding_status_values",
        "todos",
        "embedding_status IN ('pending', 'complete', 'failed')",
    )

    # 2. todos.color: enforce 7-char hex (`#rrggbb`). The pydantic schema
    #    already validates on API ingress, but raw SQL / data imports can
    #    bypass it; a DB CHECK is the last line of defence.
    op.create_check_constraint(
        "ck_todos_color_hex",
        "todos",
        "color ~ '^#[0-9a-fA-F]{6}$'",
    )

    # 3. creatures.todo_id FK: when a todo is hard-deleted (not soft-
    #    deleted), orphan creature rows remained with a dangling FK.
    #    Switch to SET NULL so creatures survive independently — the app
    #    treats null todo_id as "the source todo is gone" per the
    #    creature model's nullable FK declaration.
    op.drop_constraint(
        "creatures_todo_id_fkey",
        "creatures",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "creatures_todo_id_fkey",
        "creatures",
        "todos",
        ["todo_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "creatures_todo_id_fkey",
        "creatures",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "creatures_todo_id_fkey",
        "creatures",
        "todos",
        ["todo_id"],
        ["id"],
    )
    op.drop_constraint("ck_todos_color_hex", "todos", type_="check")
    op.drop_constraint("ck_todos_embedding_status_values", "todos", type_="check")
