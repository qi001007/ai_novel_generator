"""Render stored prose into a file the author can take away.

This is a **read**. The document layer stays the only write path (D-01); exporting must
never become a second way to touch the database. The prose lives in ``chapter.content``,
so the ordering and the heading wording are decided here, next to the source of truth,
rather than re-derived in the browser from whatever happens to be cached.
"""

from __future__ import annotations

from sqlmodel import Session, select

from app.models import Chapter, Novel, Review, Revision

FORMATS = ("txt", "md")

MEDIA_TYPES = {
    "txt": "text/plain; charset=utf-8",
    "md": "text/markdown; charset=utf-8",
}


class ExportError(Exception):
    """A reason the author can act on, carried to the router as an HTTP status."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _ordered_chapters(session: Session, novel_id: int) -> list[Chapter]:
    rows = session.exec(
        select(Chapter).where(Chapter.novel_id == novel_id).order_by(Chapter.chapter_number)
    ).all()
    return list(rows)


def _heading(chapter: Chapter, fmt: str) -> str:
    title = f"第{chapter.chapter_number}章"
    if chapter.title:
        title = f"{title} {chapter.title}"
    return f"# {title}" if fmt == "md" else title


def _approved_prose(session: Session, chapter: Chapter) -> str | None:
    latest_decision = session.exec(
        select(Review)
        .where(Review.chapter_id == chapter.id, Review.reviewer == "human")
        .order_by(Review.created_at.desc(), Review.id.desc())
    ).first()
    if latest_decision is None or latest_decision.decision == "reject":
        return None
    revision = session.exec(
        select(Revision)
        .where(Revision.asset_type == "chapter_approved", Revision.asset_id == chapter.id)
        .order_by(Revision.revision.desc())
    ).first()
    if revision is None:
        return None
    content = str(revision.snapshot.get("content", "")).strip()
    return content or None


def book_document(session: Session, novel: Novel, fmt: str, allow_partial: bool = False) -> tuple[str, str]:
    """Export immutable approved revisions; working drafts never leak into a download."""
    if fmt not in FORMATS:
        raise ExportError(400, "format 只支持 txt 或 md")
    all_chapters = [chapter for chapter in _ordered_chapters(session, novel.id) if (chapter.content or "").strip()]
    approved = [(chapter, _approved_prose(session, chapter)) for chapter in all_chapters]
    missing = [chapter.chapter_number for chapter, content in approved if content is None]
    if missing and not allow_partial:
        listed = "、".join(f"第 {number} 章" for number in missing)
        raise ExportError(409, f"以下章节没有有效终审版本：{listed}")
    chapters = [(chapter, content) for chapter, content in approved if content is not None]
    if not chapters:
        raise ExportError(404, "这本书还没有可导出的终审正文")
    blocks = [f"{_heading(chapter, fmt)}\n\n{content}" for chapter, content in chapters]
    head = f"# {novel.title}\n\n" if fmt == "md" else ""
    text = head + "\n\n\n".join(blocks) + "\n"
    return text, f"{novel.title}_全书.{fmt}"


def chapter_document(session: Session, novel: Novel, chapter_number: int, fmt: str) -> tuple[str, str]:
    if fmt not in FORMATS:
        raise ExportError(400, "format 只支持 txt 或 md")
    chapter = next(
        (item for item in _ordered_chapters(session, novel.id) if item.chapter_number == chapter_number),
        None,
    )
    if chapter is None:
        raise ExportError(404, f"第 {chapter_number} 章不存在")
    content = _approved_prose(session, chapter)
    if content is None:
        raise ExportError(409, f"第 {chapter_number} 章没有有效终审版本")
    text = f"{_heading(chapter, fmt)}\n\n{content}\n"
    return text, f"{novel.title}_第{chapter_number:04d}章.{fmt}"
