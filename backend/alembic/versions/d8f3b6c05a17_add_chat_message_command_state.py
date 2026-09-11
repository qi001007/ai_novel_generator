"""add chat_message.command_state

A slash command's card existed only in the browser's row list, so `Page.reload` left
0 张 `.chat-card.command` while everything the command had done stayed on screen -
结果留痕、过程不留痕 (第三十五批批注 35.34, measured on 作品 6 副本库 `3529c.db`).
One JSON column holds what the card still needs to be drawn after the settled line
already lives in `content`: which command, how it ended, and the two ids its jump
buttons read. Rows written before this get `{}` - they had no card to bring back,
and nothing is fabricated for them.

Revision ID: d8f3b6c05a17
Revises: c4e7a1b8d206
Create Date: 2026-09-11
"""
from alembic import op
import sqlalchemy as sa

revision = 'd8f3b6c05a17'
down_revision = 'c4e7a1b8d206'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'chat_message',
        sa.Column('command_state', sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )


def downgrade() -> None:
    op.drop_column('chat_message', 'command_state')
