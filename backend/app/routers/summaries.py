from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from app.db import get_session
from app.models import Chapter, ChapterSummary
from app.routers.planning import get_novel_or_404


router = APIRouter(prefix="/novels", tags=["summaries"])


class ChapterSummaryCreate(SQLModel):
    summary: str
    events: list[dict] = []
    character_state_changes: dict = {}
    foreshadow_updates: list[dict] = []


@router.post(
    "/{novel_id}/chapters/{chapter_id}/summary",
    response_model=ChapterSummary,
    status_code=201,
)
def create_chapter_summary(
    novel_id: int,
    chapter_id: int,
    payload: ChapterSummaryCreate,
    session: Session = Depends(get_session),
) -> ChapterSummary:
    get_novel_or_404(novel_id, session)
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or chapter.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter not found")
    if chapter.status != "final":
        raise HTTPException(
            status_code=422,
            detail="Only final chapters can be summarized",
        )

    existing = session.exec(
        select(ChapterSummary).where(
            ChapterSummary.novel_id == novel_id,
            ChapterSummary.chapter_number == chapter.chapter_number,
        )
    ).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="This chapter already has a summary")

    chapter_summary = ChapterSummary(
        novel_id=novel_id,
        chapter_id=chapter.id,
        chapter_number=chapter.chapter_number,
        **payload.model_dump(),
    )
    session.add(chapter_summary)
    session.commit()
    session.refresh(chapter_summary)
    return chapter_summary
