"""add app_config

Revision ID: e8c2f4a1b930
Revises: d5a1b7c9e234
Create Date: 2026-09-04
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel

revision = 'e8c2f4a1b930'
down_revision = 'd5a1b7c9e234'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'app_config',
        sa.Column('key', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('value', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('key'),
    )


def downgrade() -> None:
    op.drop_table('app_config')
