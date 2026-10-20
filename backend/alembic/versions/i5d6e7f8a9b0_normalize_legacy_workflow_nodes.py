"""normalize legacy workflow node payloads

Revision ID: i5d6e7f8a9b0
Revises: h4c5d6e7f8a9
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "i5d6e7f8a9b0"
down_revision = "h4c5d6e7f8a9"
branch_labels = None
depends_on = None


def _normalized(graph: object) -> tuple[dict, bool]:
    value = dict(graph or {})
    nodes = []
    changed = False
    for raw in value.get("nodes") or []:
        node = dict(raw)
        if "source" in node:
            node.pop("source", None)
            changed = True
        nodes.append(node)
    if changed:
        value["nodes"] = nodes
    return value, changed


def upgrade() -> None:
    connection = op.get_bind()
    for table_name in ("context_workflow", "workflow_version"):
        table = sa.table(
            table_name,
            sa.column("id", sa.Integer()),
            sa.column("graph", sa.JSON()),
        )
        for row in connection.execute(sa.select(table.c.id, table.c.graph)).mappings():
            graph, changed = _normalized(row["graph"])
            if changed:
                connection.execute(table.update().where(table.c.id == row["id"]).values(graph=graph))


def downgrade() -> None:
    # Removed null compatibility fields have no execution meaning and are not restored.
    pass
