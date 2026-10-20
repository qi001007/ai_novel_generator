"""add workflow purpose, immutable contract and per-novel bindings

Revision ID: f2a3b4c5d6e7
Revises: d1e2f3a4b5c6
"""

from __future__ import annotations

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = "f2a3b4c5d6e7"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("context_workflow") as batch:
        batch.add_column(sa.Column("purpose", sa.String(), nullable=False, server_default="generation"))
        batch.create_index("ix_context_workflow_purpose", ["purpose"], unique=False)

    with op.batch_alter_table("workflow_version") as batch:
        batch.add_column(sa.Column("purpose", sa.String(), nullable=False, server_default="generation"))
        batch.add_column(sa.Column("definition_revision", sa.Integer(), nullable=False, server_default="1"))
        batch.create_index("ix_workflow_version_purpose", ["purpose"], unique=False)

    op.create_table(
        "workflow_binding",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("novel_id", sa.Integer(), nullable=False),
        sa.Column("purpose", sa.String(), nullable=False),
        sa.Column("workflow_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["novel_id"], ["novel.id"]),
        sa.ForeignKeyConstraint(["workflow_id"], ["context_workflow.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("novel_id", "purpose"),
    )
    op.create_index("ix_workflow_binding_novel_id", "workflow_binding", ["novel_id"], unique=False)
    op.create_index("ix_workflow_binding_purpose", "workflow_binding", ["purpose"], unique=False)
    op.create_index("ix_workflow_binding_workflow_id", "workflow_binding", ["workflow_id"], unique=False)

    # The old policy column is retained only for rollback/read compatibility. Its
    # value is copied into the one context node so the published graph becomes the
    # complete execution source immediately after migration.
    connection = op.get_bind()
    workflow = sa.table(
        "context_workflow",
        sa.column("id", sa.Integer()),
        sa.column("novel_id", sa.Integer()),
        sa.column("is_default", sa.Boolean()),
        sa.column("policy", sa.JSON()),
        sa.column("graph", sa.JSON()),
    )
    rows = connection.execute(sa.select(workflow)).mappings().all()
    now = datetime.now(timezone.utc)
    chosen: dict[int, int] = {}
    for row in rows:
        graph = dict(row["graph"] or {})
        nodes = list(graph.get("nodes") or [])
        changed = False
        for index, raw in enumerate(nodes):
            node = dict(raw)
            if node.get("type") != "context":
                continue
            config = dict(node.get("config") or {})
            if "policy" not in config:
                config["policy"] = row["policy"] or {"version": 1, "budget": 60000, "modules": []}
                node["config"] = config
                nodes[index] = node
                changed = True
        if changed:
            graph["nodes"] = nodes
            connection.execute(workflow.update().where(workflow.c.id == row["id"]).values(graph=graph))
        novel_id = row["novel_id"]
        if novel_id is not None and (row["is_default"] or novel_id not in chosen):
            chosen[int(novel_id)] = int(row["id"])

    binding = sa.table(
        "workflow_binding",
        sa.column("novel_id", sa.Integer()),
        sa.column("purpose", sa.String()),
        sa.column("workflow_id", sa.Integer()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    for novel_id, workflow_id in chosen.items():
        connection.execute(
            binding.insert().values(
                novel_id=novel_id,
                purpose="generation",
                workflow_id=workflow_id,
                created_at=now,
                updated_at=now,
            )
        )


def downgrade() -> None:
    op.drop_index("ix_workflow_binding_workflow_id", table_name="workflow_binding")
    op.drop_index("ix_workflow_binding_purpose", table_name="workflow_binding")
    op.drop_index("ix_workflow_binding_novel_id", table_name="workflow_binding")
    op.drop_table("workflow_binding")
    with op.batch_alter_table("workflow_version") as batch:
        batch.drop_index("ix_workflow_version_purpose")
        batch.drop_column("definition_revision")
        batch.drop_column("purpose")
    with op.batch_alter_table("context_workflow") as batch:
        batch.drop_index("ix_context_workflow_purpose")
        batch.drop_column("purpose")
