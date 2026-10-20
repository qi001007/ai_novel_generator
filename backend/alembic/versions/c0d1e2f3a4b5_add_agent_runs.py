"""add durable platform agent runs

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
"""

from alembic import op
import sqlalchemy as sa


revision = "c0d1e2f3a4b5"
down_revision = "b9c0d1e2f3a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_run",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("novel_id", sa.Integer(), sa.ForeignKey("novel.id"), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="running"),
        sa.Column("request", sa.String(), nullable=False),
        sa.Column("response", sa.String(), nullable=False, server_default=""),
        sa.Column("error", sa.String(), nullable=False, server_default=""),
        sa.Column("model", sa.String(), nullable=False, server_default=""),
        sa.Column("token_input", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("token_output", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_agent_run_novel_id", "agent_run", ["novel_id"])
    op.create_index("ix_agent_run_status", "agent_run", ["status"])
    with op.batch_alter_table("tool_call") as batch:
        batch.add_column(sa.Column("agent_run_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_tool_call_agent_run_id_agent_run",
            "agent_run",
            ["agent_run_id"],
            ["id"],
        )
        batch.create_index("ix_tool_call_agent_run_id", ["agent_run_id"])


def downgrade() -> None:
    with op.batch_alter_table("tool_call") as batch:
        batch.drop_index("ix_tool_call_agent_run_id")
        batch.drop_constraint("fk_tool_call_agent_run_id_agent_run", type_="foreignkey")
        batch.drop_column("agent_run_id")
    op.drop_table("agent_run")
