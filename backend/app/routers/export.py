"""Download the prose of a book or of one chapter. Read-only by design (D-01)."""

from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session, SQLModel

from app.db import get_session
from app.routers.planning import get_novel_or_404
from app.services import documents, export, storage
from app.services.documents import DocumentError

router = APIRouter(prefix="/novels", tags=["export"])
# 导出目录是全局偏好（这台机器要把文件放到哪儿），不挂在某本书下面。
settings_router = APIRouter(prefix="/export", tags=["export"])


class ExportSettings(SQLModel):
    export_dir: str


class ExportDirIn(SQLModel):
    dir: str


class SaveIn(SQLModel):
    scope: str = "book"
    chapter_number: int | None = None
    format: str = "txt"
    document_path: str | None = None


class SavedOut(SQLModel):
    saved_to: str


def content_disposition(filename: str, ascii_name: str) -> str:
    """Chinese file names need RFC 5987.

    The ASCII form is what an old client saves. It is built from ids rather than by
    stripping the title, because stripping 「观星残卷（流程测试）_全书.txt」 leaves 「_.txt」 -
    a name that tells nobody anything.
    """
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


@settings_router.get("/settings", response_model=ExportSettings)
def read_export_settings(session: Session = Depends(get_session)) -> ExportSettings:
    return ExportSettings(export_dir=storage.get_export_dir(session))


@settings_router.put("/settings", response_model=ExportSettings)
def write_export_settings(
    payload: ExportDirIn, session: Session = Depends(get_session)
) -> ExportSettings:
    try:
        value = storage.set_export_dir(session, payload.dir)
    except storage.StorageError as cause:
        raise HTTPException(status_code=cause.status_code, detail=cause.detail) from cause
    return ExportSettings(export_dir=value)


@router.post("/{novel_id}/export/save", response_model=SavedOut)
def save_export(
    novel_id: int, payload: SaveIn, session: Session = Depends(get_session)
) -> SavedOut:
    """把导出文件放进设置里那个目录。

    这是**磁盘写**，不是数据库写：内容全部来自只读的投影与正文，四层规划那条
    唯一写入口（D-01）一次都没有被绕开。
    """
    novel = get_novel_or_404(novel_id, session)
    try:
        if payload.document_path:
            doc = documents.read_file(session, novel_id, payload.document_path)
            text, name = doc.text, f"{novel.title}_{doc.label}.md"
        elif payload.scope == "chapter":
            if payload.chapter_number is None:
                raise export.ExportError(400, "保存单章要带 chapter_number")
            text, name = export.chapter_document(
                session, novel, payload.chapter_number, payload.format
            )
        else:
            text, name = export.book_document(session, novel, payload.format)
        saved = storage.write_export(session, name, text)
    except (export.ExportError, storage.StorageError) as cause:
        raise HTTPException(status_code=cause.status_code, detail=cause.detail) from cause
    except DocumentError as cause:
        raise HTTPException(status_code=cause.status_code, detail=cause.detail) from cause
    return SavedOut(saved_to=str(saved))


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
