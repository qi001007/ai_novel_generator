"""persist open-ended Markdown sections on author documents

Revision ID: e1a2b3c4d5e6
Revises: d8f3b6c05a17
Create Date: 2026-09-15
"""

from alembic import op
import sqlalchemy as sa


revision = "e1a2b3c4d5e6"
down_revision = "d8f3b6c05a17"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("planning_blueprint", "chapter_brief", "character"):
        op.add_column(
            table,
            sa.Column("custom_sections", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        )


def downgrade() -> None:
    for table in ("character", "chapter_brief", "planning_blueprint"):
        op.drop_column(table, "custom_sections")
