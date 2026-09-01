"""add chat agent tables and novel cover

Revision ID: a7e3c1d94b20
Revises: c6d1649d0f20
Create Date: 2026-09-01
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel

revision = 'a7e3c1d94b20'
down_revision = 'c6d1649d0f20'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'novel',
        sa.Column('cover_image', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
    )
    op.create_table(
        'chat_message',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('novel_id', sa.Integer(), nullable=False),
        sa.Column('role', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('content', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('mode', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('model', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('mentions', sa.JSON(), nullable=False),
        sa.Column('context_refs', sa.JSON(), nullable=False),
        sa.Column('token_input', sa.Integer(), nullable=False),
        sa.Column('token_output', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['novel_id'], ['novel.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_chat_message_novel_id'), 'chat_message', ['novel_id'], unique=False)
    op.create_index(op.f('ix_chat_message_role'), 'chat_message', ['role'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_chat_message_role'), table_name='chat_message')
    op.drop_index(op.f('ix_chat_message_novel_id'), table_name='chat_message')
    op.drop_table('chat_message')
    op.drop_column('novel', 'cover_image')
