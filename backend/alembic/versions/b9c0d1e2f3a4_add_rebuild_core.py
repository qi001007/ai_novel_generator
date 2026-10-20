"""add the clean rebuild core

Revision ID: b9c0d1e2f3a4
Revises: a7b8c9d0e1f2
"""

from alembic import op
import sqlalchemy as sa


revision = "b9c0d1e2f3a4"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def _timestamps() -> tuple[sa.Column, sa.Column]:
    return (
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def _json(name: str) -> sa.Column:
    return sa.Column(name, sa.JSON(), nullable=False, server_default=sa.text("'{}'"))


def upgrade() -> None:
    op.add_column("novel", sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("novel", sa.Column("status", sa.String(), nullable=False, server_default="draft"))
    op.add_column("novel", sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("novel", sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()))

    op.create_table(
        "outline_node",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("novel_id", sa.Integer(), sa.ForeignKey("novel.id"), nullable=False),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("outline_node.id"), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
        sa.UniqueConstraint("novel_id", "parent_id", "position"),
    )
    op.create_table(
        "document",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("novel_id", sa.Integer(), sa.ForeignKey("novel.id"), nullable=False),
        sa.Column("outline_node_id", sa.Integer(), sa.ForeignKey("outline_node.id"), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False, server_default=""),
        sa.Column("content", sa.String(), nullable=False, server_default=""),
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("source", sa.String(), nullable=False, server_default="user"),
        *_timestamps(),
        sa.UniqueConstraint("novel_id", "path"),
    )
    op.create_table(
        "knowledge_entry",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("novel_id", sa.Integer(), sa.ForeignKey("novel.id"), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("content", sa.String(), nullable=False, server_default=""),
        _json("data"),
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("source", sa.String(), nullable=False, server_default="user"),
        *_timestamps(),
        sa.UniqueConstraint("novel_id", "kind", "name"),
    )
    op.create_table(
        "fact",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("novel_id", sa.Integer(), sa.ForeignKey("novel.id"), nullable=False),
        sa.Column("subject", sa.String(), nullable=False),
        sa.Column("predicate", sa.String(), nullable=False),
        sa.Column("value", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("source_ref", sa.String(), nullable=False, server_default=""),
        *_timestamps(),
    )
    op.create_table(
        "revision",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("novel_id", sa.Integer(), sa.ForeignKey("novel.id"), nullable=False),
        sa.Column("asset_type", sa.String(), nullable=False),
        sa.Column("asset_id", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        _json("snapshot"),
        sa.Column("actor", sa.String(), nullable=False, server_default="user"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "operation",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("novel_id", sa.Integer(), sa.ForeignKey("novel.id"), nullable=True),
        sa.Column("command", sa.String(), nullable=False),
        sa.Column("idempotency_key", sa.String(), nullable=False, unique=True),
        sa.Column("actor", sa.String(), nullable=False, server_default="user"),
        sa.Column("risk", sa.String(), nullable=False, server_default="low"),
        sa.Column("status", sa.String(), nullable=False, server_default="completed"),
        sa.Column("target_type", sa.String(), nullable=False, server_default=""),
        sa.Column("target_id", sa.Integer(), nullable=True),
        _json("before"),
        _json("after"),
        _json("result"),
        sa.Column("undo_kind", sa.String(), nullable=False, server_default="none"),
        sa.Column("undone_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "workflow_version",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workflow_id", sa.Integer(), sa.ForeignKey("context_workflow.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        _json("graph"),
        sa.Column("source_json", sa.String(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("workflow_id", "version"),
    )
    op.create_table(
        "workflow_run",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("novel_id", sa.Integer(), sa.ForeignKey("novel.id"), nullable=True),
        sa.Column("workflow_id", sa.Integer(), sa.ForeignKey("context_workflow.id"), nullable=False),
        sa.Column("workflow_version_id", sa.Integer(), sa.ForeignKey("workflow_version.id"), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="queued"),
        _json("input"),
        _json("output"),
        sa.Column("error", sa.String(), nullable=False, server_default=""),
        sa.Column("token_input", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("token_output", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("paused_node_id", sa.String(), nullable=False, server_default=""),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "node_run",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workflow_run_id", sa.Integer(), sa.ForeignKey("workflow_run.id"), nullable=False),
        sa.Column("node_id", sa.String(), nullable=False),
        sa.Column("node_type", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="queued"),
        _json("input"),
        _json("output"),
        sa.Column("error", sa.String(), nullable=False, server_default=""),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("token_input", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("token_output", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "conversation",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("novel_id", sa.Integer(), sa.ForeignKey("novel.id"), nullable=False),
        sa.Column("title", sa.String(), nullable=False, server_default="新对话"),
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
        *_timestamps(),
    )
    op.create_table(
        "tool_call",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("novel_id", sa.Integer(), sa.ForeignKey("novel.id"), nullable=True),
        sa.Column("conversation_id", sa.Integer(), sa.ForeignKey("conversation.id"), nullable=True),
        sa.Column("operation_id", sa.Integer(), sa.ForeignKey("operation.id"), nullable=True),
        sa.Column("tool_name", sa.String(), nullable=False),
        _json("arguments"),
        _json("result"),
        sa.Column("status", sa.String(), nullable=False, server_default="completed"),
        sa.Column("approval_state", sa.String(), nullable=False, server_default="not_required"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "map_project",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("novel_id", sa.Integer(), sa.ForeignKey("novel.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        _json("settings"),
        *_timestamps(),
    )
    op.create_table(
        "map_tile",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("map_project_id", sa.Integer(), sa.ForeignKey("map_project.id"), nullable=False),
        sa.Column("x", sa.Integer(), nullable=False),
        sa.Column("y", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("image_path", sa.String(), nullable=False, server_default=""),
        sa.Column("prompt", sa.String(), nullable=False, server_default=""),
        sa.Column("seed", sa.Integer(), nullable=True),
        sa.Column("provider", sa.String(), nullable=False, server_default=""),
        _json("metadata_json"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("map_project_id", "x", "y", "revision"),
    )
    op.create_table(
        "generation_job",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("novel_id", sa.Integer(), sa.ForeignKey("novel.id"), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="queued"),
        _json("payload"),
        _json("result"),
        sa.Column("error", sa.String(), nullable=False, server_default=""),
        *_timestamps(),
    )

    indexes = {
        "outline_node": ("novel_id", "parent_id", "kind", "position"),
        "document": ("novel_id", "outline_node_id", "kind", "path"),
        "knowledge_entry": ("novel_id", "kind", "name"),
        "fact": ("novel_id", "subject"),
        "revision": ("novel_id", "asset_type", "asset_id"),
        "operation": ("novel_id", "command", "idempotency_key", "target_id"),
        "workflow_version": ("workflow_id",),
        "workflow_run": ("novel_id", "workflow_id", "workflow_version_id", "status"),
        "node_run": ("workflow_run_id", "node_id"),
        "conversation": ("novel_id",),
        "tool_call": ("novel_id", "conversation_id", "tool_name"),
        "map_project": ("novel_id",),
        "map_tile": ("map_project_id", "x", "y"),
        "generation_job": ("novel_id", "kind", "status"),
    }
    for table, columns in indexes.items():
        for column in columns:
            op.create_index(f"ix_{table}_{column}", table, [column])


def downgrade() -> None:
    for table in (
        "generation_job",
        "map_tile",
        "map_project",
        "tool_call",
        "conversation",
        "node_run",
        "workflow_run",
        "workflow_version",
        "operation",
        "revision",
        "fact",
        "knowledge_entry",
        "document",
        "outline_node",
    ):
        op.drop_table(table)
    for column in ("archived", "pinned", "status", "revision"):
        op.drop_column("novel", column)
