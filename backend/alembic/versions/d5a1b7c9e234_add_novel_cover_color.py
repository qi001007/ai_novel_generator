"""add novel cover_color

Revision ID: d5a1b7c9e234
Revises: b4f0d2a8c61e
Create Date: 2026-09-04
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel

revision = 'd5a1b7c9e234'
down_revision = 'b4f0d2a8c61e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'novel',
        sa.Column('cover_color', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
    )


def downgrade() -> None:
    op.drop_column('novel', 'cover_color')
