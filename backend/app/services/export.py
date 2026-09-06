"""Render stored prose into a file the author can take away.

This is a **read**. The document layer stays the only write path (D-01); exporting must
never become a second way to touch the database. The prose lives in ``chapter.content``,
so the ordering and the heading wording are decided here, next to the source of truth,
rather than re-derived in the browser from whatever happens to be cached.
"""

from __future__ import annotations

from sqlmodel import Session, select

from app.models import Chapter, Novel

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


def _prose(chapter: Chapter) -> str:
    content = (chapter.content or "").strip()
    if not content:
        raise ExportError(409, f"第 {chapter.chapter_number} 章还没有正文，导出会是空文件")
    return content


def book_document(session: Session, novel: Novel, fmt: str) -> tuple[str, str]:
    """Everything that has prose, in chapter order. Empty chapters are skipped."""
    if fmt not in FORMATS:
        raise ExportError(400, "format 只支持 txt 或 md")
    chapters = [chapter for chapter in _ordered_chapters(session, novel.id) if (chapter.content or "").strip()]
    if not chapters:
        raise ExportError(404, "这本书还没有任何正文")
    blocks = [f"{_heading(chapter, fmt)}\n\n{_prose(chapter)}" for chapter in chapters]
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
    text = f"{_heading(chapter, fmt)}\n\n{_prose(chapter)}\n"
    return text, f"{novel.title}_第{chapter_number:04d}章.{fmt}"
