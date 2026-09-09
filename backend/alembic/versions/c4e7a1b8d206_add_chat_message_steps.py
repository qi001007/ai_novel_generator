"""add chat_message.steps

The tool trace a turn produced while it streamed existed only in the browser: a reload
rebuilt the row from the stored message, which carried no steps, so 「本轮读取 · N 步」
went permanently empty (第三十一批批注 4). One JSON column per answer holds the steps in
order, field for field what the `tool` event carried, so the same line builder renders
both the live stream and the history. Existing rows get `[]` - their traces are already
gone, and nothing is fabricated for them.

Revision ID: c4e7a1b8d206
Revises: b7d4e2a19c53
Create Date: 2026-09-10
"""
from alembic import op
import sqlalchemy as sa

revision = 'c4e7a1b8d206'
down_revision = 'b7d4e2a19c53'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'chat_message',
        sa.Column('steps', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )


def downgrade() -> None:
    op.drop_column('chat_message', 'steps')
