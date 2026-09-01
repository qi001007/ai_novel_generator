from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel

from app.db import get_session
from app.routers.planning import get_novel_or_404
from app.services import documents
from app.services.documents import DocumentError


router = APIRouter(prefix="/novels", tags=["documents"])


class FileMetaOut(SQLModel):
    path: str
    kind: str
    layer: str
    label: str


class FileDocOut(SQLModel):
    path: str
    kind: str
    layer: str
    label: str
    text: str
    ai_fields: list[str]
    revision: str


class FileWriteRequest(SQLModel):
    text: str
    actor: str = "human"
    base_revision: str | None = None


class FileWriteResult(SQLModel):
    path: str
    changed: list[str]
    revision: str


def _to_http(cause: DocumentError) -> HTTPException:
    return HTTPException(status_code=cause.status_code, detail=cause.detail)


@router.get("/{novel_id}/files", response_model=list[FileMetaOut])
def list_novel_files(
    novel_id: int,
    session: Session = Depends(get_session),
) -> list[FileMetaOut]:
    get_novel_or_404(novel_id, session)
    return [
        FileMetaOut.model_validate(meta, from_attributes=True)
        for meta in documents.list_files(session, novel_id)
    ]


@router.get("/{novel_id}/files/{path:path}", response_model=FileDocOut)
def read_novel_file(
    novel_id: int,
    path: str,
    session: Session = Depends(get_session),
) -> FileDocOut:
    get_novel_or_404(novel_id, session)
    try:
        doc = documents.read_file(session, novel_id, path)
    except DocumentError as cause:
        raise _to_http(cause) from cause
    return FileDocOut.model_validate(doc, from_attributes=True)


@router.put("/{novel_id}/files/{path:path}", response_model=FileWriteResult)
def write_novel_file(
    novel_id: int,
    path: str,
    payload: FileWriteRequest,
    session: Session = Depends(get_session),
) -> FileWriteResult:
    get_novel_or_404(novel_id, session)
    try:
        result = documents.write_file(
            session,
            novel_id,
            path,
            payload.text,
            actor=payload.actor,
            base_revision=payload.base_revision,
        )
    except DocumentError as cause:
        raise _to_http(cause) from cause
    return FileWriteResult.model_validate(result, from_attributes=True)
