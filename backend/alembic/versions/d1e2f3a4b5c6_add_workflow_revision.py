"""add optimistic revision to workflows

Revision ID: d1e2f3a4b5c6
Revises: c0d1e2f3a4b5
"""

from alembic import op
import sqlalchemy as sa


revision = "d1e2f3a4b5c6"
down_revision = "c0d1e2f3a4b5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("context_workflow") as batch:
        batch.add_column(sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))


def downgrade() -> None:
    with op.batch_alter_table("context_workflow") as batch:
        batch.drop_column("revision")
