"""Download the prose of a book or of one chapter. Read-only by design (D-01)."""

from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session

from app.db import get_session
from app.routers.planning import get_novel_or_404
from app.services import export

router = APIRouter(prefix="/novels", tags=["export"])


def content_disposition(filename: str, ascii_name: str) -> str:
    """Chinese file names need RFC 5987.

    The ASCII form is what an old client saves. It is built from ids rather than by
    stripping the title, because stripping 「观星残卷（流程测试）_全书.txt」 leaves 「_.txt」 -
    a name that tells nobody anything.
    """
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


@router.get("/{novel_id}/export")
def export_prose(
    novel_id: int,
    scope: str = "book",
    chapter_number: int | None = None,
    format: str = "txt",
    session: Session = Depends(get_session),
) -> Response:
    novel = get_novel_or_404(novel_id, session)
    try:
        if scope == "book":
            text, filename = export.book_document(session, novel, format)
            stem = "book"
        elif scope == "chapter":
            if chapter_number is None:
                raise export.ExportError(400, "导出单章要带 chapter_number")
            text, filename = export.chapter_document(session, novel, chapter_number, format)
            stem = f"chapter-{chapter_number:04d}"
        else:
            raise export.ExportError(400, "scope 只支持 book 或 chapter")
    except export.ExportError as cause:
        raise HTTPException(status_code=cause.status_code, detail=cause.detail) from cause
    return Response(
        content=text,
        media_type=export.MEDIA_TYPES[format],
        headers={
            "Content-Disposition": content_disposition(
                filename, f"novel-{novel.id}-{stem}.{format}"
            )
        },
    )
