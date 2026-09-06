"""add chat_message.conversation_id

A book now holds several conversations instead of one endless thread: 「新建对话」
closes the current one and opens the next, and the history window stops crossing
threads (第二十八批批注 8). Existing rows keep 1, so nothing a owner already wrote
moves or disappears.

Revision ID: b7d4e2a19c53
Revises: f3b9c0d21a55
Create Date: 2026-09-06
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel

revision = 'b7d4e2a19c53'
down_revision = 'f3b9c0d21a55'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'chat_message',
        sa.Column('conversation_id', sa.Integer(), nullable=False, server_default='1'),
    )
    op.create_index(
        op.f('ix_chat_message_conversation_id'),
        'chat_message',
        ['conversation_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_chat_message_conversation_id'), table_name='chat_message')
    op.drop_column('chat_message', 'conversation_id')
