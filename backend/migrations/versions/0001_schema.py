"""final schema

Revision ID: 0001_schema
Revises:
Create Date: 2026-04-22 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import pgvector.sqlalchemy.vector  # noqa: F401
import sqlalchemy as sa


revision: str = '0001_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        'todos',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('completed', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('color', sa.String(length=7), server_default=sa.text("'#00ff88'"), nullable=False),
        sa.Column('position_x', sa.Float(), nullable=True),
        sa.Column('position_y', sa.Float(), nullable=True),
        sa.Column('rotation_y', sa.Float(), server_default=sa.text('random() * 2 * pi()'), nullable=False),
        sa.Column('embedding', pgvector.sqlalchemy.vector.VECTOR(dim=768), nullable=True),
        sa.Column('embedding_status', sa.String(length=20), server_default=sa.text("'pending'"), nullable=False),
        sa.Column('archived', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("embedding_status IN ('pending', 'complete', 'failed')", name='ck_todos_embedding_status_values'),
        sa.CheckConstraint("color ~ '^#[0-9a-fA-F]{6}$'", name='ck_todos_color_hex'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_index('ix_todos_active', 'todos', ['deleted', 'archived'], unique=False, postgresql_where=sa.text('deleted = false'))
    op.create_index('ix_todos_text_search', 'todos', [sa.literal_column("to_tsvector('english', text)")], unique=False, postgresql_using='gin')
    op.execute("CREATE INDEX ix_todos_embedding ON todos USING hnsw (embedding vector_cosine_ops)")

    op.create_table(
        'creatures',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('todo_id', sa.UUID(), nullable=True),
        sa.Column('creature_type', sa.String(length=50), nullable=False),
        sa.Column('rarity', sa.String(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['todo_id'], ['todos.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('todo_id', name='uq_creatures_todo_id'),
    )


def downgrade() -> None:
    op.drop_table('creatures')
    op.execute("DROP INDEX IF EXISTS ix_todos_embedding")
    op.drop_index('ix_todos_text_search', table_name='todos', postgresql_using='gin')
    op.drop_index('ix_todos_active', table_name='todos', postgresql_where=sa.text('deleted = false'))
    op.drop_table('todos')
