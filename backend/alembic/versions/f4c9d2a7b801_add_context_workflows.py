"""add saved context workflows

Revision ID: f4c9d2a7b801
Revises: e1a2b3c4d5e6
Create Date: 2026-09-15
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel


revision = "f4c9d2a7b801"
down_revision = "e1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "context_workflow",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=120), nullable=False),
        sa.Column("scope_key", sqlmodel.sql.sqltypes.AutoString(length=80), nullable=False),
        sa.Column("novel_id", sa.Integer(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("policy", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("graph", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["novel_id"], ["novel.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scope_key", "name"),
    )
    op.create_index("ix_context_workflow_name", "context_workflow", ["name"], unique=False)
    op.create_index("ix_context_workflow_scope_key", "context_workflow", ["scope_key"], unique=False)
    op.create_index("ix_context_workflow_novel_id", "context_workflow", ["novel_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_context_workflow_novel_id", table_name="context_workflow")
    op.drop_index("ix_context_workflow_scope_key", table_name="context_workflow")
    op.drop_index("ix_context_workflow_name", table_name="context_workflow")
    op.drop_table("context_workflow")
