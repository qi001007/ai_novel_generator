"""backfill immutable revisions for legacy final chapters

Revision ID: h4c5d6e7f8a9
Revises: g3b4c5d6e7f8
"""

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = "h4c5d6e7f8a9"
down_revision = "g3b4c5d6e7f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    chapters = sa.table(
        "chapter",
        sa.column("id", sa.Integer),
        sa.column("novel_id", sa.Integer),
        sa.column("chapter_number", sa.Integer),
        sa.column("title", sa.String),
        sa.column("content", sa.Text),
        sa.column("word_count", sa.Integer),
        sa.column("status", sa.String),
    )
    revisions = sa.table(
        "revision",
        sa.column("novel_id", sa.Integer),
        sa.column("asset_type", sa.String),
        sa.column("asset_id", sa.Integer),
        sa.column("revision", sa.Integer),
        sa.column("snapshot", sa.JSON),
        sa.column("actor", sa.String),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    existing = set(
        bind.execute(
            sa.select(revisions.c.asset_id).where(revisions.c.asset_type == "chapter_approved")
        ).scalars()
    )
    now = datetime.now(timezone.utc)
    rows = bind.execute(sa.select(chapters).where(chapters.c.status == "final")).mappings()
    for row in rows:
        if row["id"] in existing:
            continue
        bind.execute(
            revisions.insert().values(
                novel_id=row["novel_id"],
                asset_type="chapter_approved",
                asset_id=row["id"],
                revision=1,
                snapshot={
                    "chapter_number": row["chapter_number"],
                    "title": row["title"] or "",
                    "content": row["content"] or "",
                    "word_count": row["word_count"] or 0,
                    "status": "approved",
                },
                actor="migration",
                created_at=now,
            )
        )


def downgrade() -> None:
    op.execute("DELETE FROM revision WHERE asset_type = 'chapter_approved' AND actor = 'migration'")
