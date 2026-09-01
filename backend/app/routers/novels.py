from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import SQLModel, Session, select

from app.db import get_session
from app.models import Novel, utc_now


router = APIRouter(prefix="/novels", tags=["novels"])


class NovelCreate(SQLModel):
    title: str
    description: str = ""
    target_chapters: int = 0
    style_constraints: str = ""


class NovelUpdate(SQLModel):
    title: str | None = None
    description: str | None = None
    target_chapters: int | None = None
    style_constraints: str | None = None
    cover_image: str | None = None


@router.get("", response_model=list[Novel])
def list_novels(session: Session = Depends(get_session)) -> list[Novel]:
    return list(session.exec(select(Novel)).all())


@router.post("", response_model=Novel, status_code=201)
def create_novel(
    payload: NovelCreate,
    session: Session = Depends(get_session),
) -> Novel:
    existing = session.exec(select(Novel).where(Novel.title == payload.title)).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="A novel with this title already exists")

    novel = Novel.model_validate(payload)
    session.add(novel)
    session.commit()
    session.refresh(novel)
    return novel


@router.get("/{novel_id}", response_model=Novel)
def get_novel(novel_id: int, session: Session = Depends(get_session)) -> Novel:
    novel = session.get(Novel, novel_id)
    if novel is None:
        raise HTTPException(status_code=404, detail="Novel not found")
    return novel


@router.put("/{novel_id}", response_model=Novel)
def update_novel(
    novel_id: int,
    payload: NovelUpdate,
    session: Session = Depends(get_session),
) -> Novel:
    novel = session.get(Novel, novel_id)
    if novel is None:
        raise HTTPException(status_code=404, detail="Novel not found")

    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    new_title = changes.get("title")
    if new_title is not None and new_title != novel.title:
        clash = session.exec(select(Novel).where(Novel.title == new_title)).first()
        if clash is not None:
            raise HTTPException(
                status_code=409,
                detail="A novel with this title already exists",
            )

    for field, value in changes.items():
        setattr(novel, field, value)
    novel.updated_at = utc_now()
    session.add(novel)
    session.commit()
    session.refresh(novel)
    return novel
