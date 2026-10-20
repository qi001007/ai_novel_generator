"""persist open-ended sections on worldview and foreshadow records

Revision ID: a7b8c9d0e1f2
Revises: f4c9d2a7b801
"""

from alembic import op
import sqlalchemy as sa


revision = "a7b8c9d0e1f2"
down_revision = "f4c9d2a7b801"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("setting", "foreshadow"):
        op.add_column(
            table,
            sa.Column("custom_sections", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        )


def downgrade() -> None:
    for table in ("foreshadow", "setting"):
        op.drop_column(table, "custom_sections")
