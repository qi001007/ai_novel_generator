"""The undo door: what the app kept, and how to give it back.

Everything here is deliberately narrow. A snapshot is only ever read from the backups
directory by exact file name, restoring a book never overwrites an existing one, and
restoring a document back into a book goes through the one document write path (D-01).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel

from app.db import get_session
from app.services import storage

router = APIRouter(prefix="/backups", tags=["backups"])


class SnapshotOut(SQLModel):
    file: str
    reason: str
    scope: str
    scope_label: str
    book_on_shelf: bool
    taken_at: str
    novel_id: int
    title: str
    bytes: int


class SnapshotChapterOut(SQLModel):
    """展开一份章级快照时列的东西：一行 = 一章，不是两个文件。"""

    novel_id: int
    chapter_id: int
    number: int
    title: str
    label: str
    paths: list[str]


class BackupListOut(SQLModel):
    export_dir: str
    snapshots: list[SnapshotOut]


class DocumentOut(SQLModel):
    novel_id: int
    novel_title: str
    path: str
    label: str


class RestoreNovelIn(SQLModel):
    file: str


class RestoreDocumentIn(SQLModel):
    file: str
    novel_id: int
    path: str
    into: str = "book"


class RestoreChapterIn(SQLModel):
    file: str
    novel_id: int
    chapter_id: int
    into: str = "book"


class ResultOut(SQLModel):
    result: dict


def _raise(cause: storage.StorageError) -> HTTPException:
    return HTTPException(status_code=cause.status_code, detail=cause.detail)


@router.get("", response_model=BackupListOut)
def list_backups(session: Session = Depends(get_session)) -> BackupListOut:
    return BackupListOut(
        export_dir=storage.get_export_dir(session),
        snapshots=[SnapshotOut(**item) for item in storage.list_snapshots(session)],
    )


@router.get("/documents", response_model=list[DocumentOut])
def backup_documents(file: str, session: Session = Depends(get_session)) -> list[DocumentOut]:
    try:
        return [DocumentOut(**item) for item in storage.snapshot_documents(session, file)]
    except storage.StorageError as cause:
        raise _raise(cause) from cause


@router.get("/chapters", response_model=list[SnapshotChapterOut])
def snapshot_chapters(
    file: str, novel_id: int, session: Session = Depends(get_session)
) -> list[SnapshotChapterOut]:
    """这份快照里**有、当前库里没有**的那些章 - 界面上只该列这些（批注 1）。"""
    try:
        return [
            SnapshotChapterOut(**item)
            for item in storage.snapshot_chapters(session, file, novel_id)
        ]
    except storage.StorageError as cause:
        raise _raise(cause) from cause


@router.post("/restore/chapter", response_model=ResultOut)
def restore_chapter(
    payload: RestoreChapterIn, session: Session = Depends(get_session)
) -> ResultOut:
    """恢复一章 = 简报与正文一起回，不再让主人分两次点（批注 1 后半）。"""
    try:
        return ResultOut(result=storage.restore_chapter(
            session, payload.file, payload.novel_id, payload.chapter_id, payload.into
        ))
    except storage.StorageError as cause:
        raise _raise(cause) from cause


@router.post("/restore/novel", response_model=ResultOut)
def restore_novel(payload: RestoreNovelIn, session: Session = Depends(get_session)) -> ResultOut:
    try:
        return ResultOut(result=storage.restore_novel(session, payload.file))
    except storage.StorageError as cause:
        raise _raise(cause) from cause


@router.post("/restore/document", response_model=ResultOut)
def restore_document(
    payload: RestoreDocumentIn, session: Session = Depends(get_session)
) -> ResultOut:
    try:
        return ResultOut(
            result=storage.restore_document(
                session, payload.file, payload.novel_id, payload.path, payload.into
            )
        )
    except storage.StorageError as cause:
        raise _raise(cause) from cause
