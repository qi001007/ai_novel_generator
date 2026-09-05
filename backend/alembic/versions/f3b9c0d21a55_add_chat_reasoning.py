"""add chat_message.reasoning

Keeps the model's own reasoning beside the answer it belongs to, so the chat can show it
collapsed (第十六批批注 1). It is a separate column rather than a prefix inside `content`
because `content` is replayed into later prompts and injected as context - thoughts must
not come back as if the model had said them out loud.

Revision ID: f3b9c0d21a55
Revises: e8c2f4a1b930
Create Date: 2026-09-05
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel

revision = 'f3b9c0d21a55'
down_revision = 'e8c2f4a1b930'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'chat_message',
        sa.Column('reasoning', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
    )


def downgrade() -> None:
    op.drop_column('chat_message', 'reasoning')
