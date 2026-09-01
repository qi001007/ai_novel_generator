"""add character portrait

Revision ID: b4f0d2a8c61e
Revises: a7e3c1d94b20
Create Date: 2026-09-01
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel

revision = 'b4f0d2a8c61e'
down_revision = 'a7e3c1d94b20'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'character',
        sa.Column('portrait', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
    )


def downgrade() -> None:
    op.drop_column('character', 'portrait')
