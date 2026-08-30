from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from app.db import get_session
from app.models import Chapter
from app.routers.planning import get_novel_or_404


router = APIRouter(prefix="/novels", tags=["chapters"])


class ChapterCreate(SQLModel):
    brief_id: int | None = None
    chapter_number: int
    title: str = ""
    content: str = ""
    status: str = "draft"


@router.get("/{novel_id}/chapters", response_model=list[Chapter])
def list_chapters(
    novel_id: int,
    session: Session = Depends(get_session),
) -> list[Chapter]:
    get_novel_or_404(novel_id, session)
    return list(
        session.exec(
            select(Chapter)
            .where(Chapter.novel_id == novel_id)
            .order_by(Chapter.chapter_number)
        ).all()
    )


@router.post("/{novel_id}/chapters", response_model=Chapter, status_code=201)
def create_chapter(
    novel_id: int,
    payload: ChapterCreate,
    session: Session = Depends(get_session),
) -> Chapter:
    get_novel_or_404(novel_id, session)
    existing = session.exec(
        select(Chapter).where(
            Chapter.novel_id == novel_id,
            Chapter.chapter_number == payload.chapter_number,
        )
    ).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="This chapter already exists")

    chapter = Chapter(
        novel_id=novel_id,
        word_count=len(payload.content),
        **payload.model_dump(),
    )
    session.add(chapter)
    session.commit()
    session.refresh(chapter)
    return chapter


@router.get("/{novel_id}/chapters/{chapter_id}", response_model=Chapter)
def get_chapter(
    novel_id: int,
    chapter_id: int,
    session: Session = Depends(get_session),
) -> Chapter:
    get_novel_or_404(novel_id, session)
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or chapter.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return chapter


@router.put("/{novel_id}/chapters/{chapter_id}", response_model=Chapter)
def update_chapter(
    novel_id: int,
    chapter_id: int,
    payload: ChapterCreate,
    session: Session = Depends(get_session),
) -> Chapter:
    get_novel_or_404(novel_id, session)
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or chapter.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter not found")

    duplicate = session.exec(
        select(Chapter).where(
            Chapter.novel_id == novel_id,
            Chapter.chapter_number == payload.chapter_number,
            Chapter.id != chapter_id,
        )
    ).first()
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="This chapter already exists")

    for field, value in payload.model_dump().items():
        setattr(chapter, field, value)
    chapter.word_count = len(payload.content)
    session.add(chapter)
    session.commit()
    session.refresh(chapter)
    return chapter
