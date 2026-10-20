"""add feedback updated time

Revision ID: g3b4c5d6e7f8
Revises: f2a3b4c5d6e7
"""

from alembic import op
import sqlalchemy as sa


revision = "g3b4c5d6e7f8"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("plot_feedback") as batch:
        batch.add_column(sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE plot_feedback SET updated_at = created_at WHERE updated_at IS NULL")
    with op.batch_alter_table("plot_feedback") as batch:
        batch.alter_column("updated_at", nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("plot_feedback") as batch:
        batch.drop_column("updated_at")
