from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from app.db import get_session
from app.models import Chapter, ChapterBrief
from app.routers.planning import get_novel_or_404
from app.services.chapters import (
    ChapterDomainError,
    ensure_chapter_number_free,
    generate_from_brief,
    get_chapter_or_error,
    machine_check,
)
from app.services.llm import LLMClient, get_llm_client


router = APIRouter(prefix="/novels", tags=["chapters"])


class ChapterCreate(SQLModel):
    brief_id: int | None = None
    chapter_number: int
    title: str = ""
    content: str = ""
    status: str = "draft"


class MachineCheckRequest(SQLModel):
    min_word_count: int = 0
    max_word_count: int = 0
    forbidden_words: list[str] = []
    blacklist: list[str] = []
    required_facts: list[str] = []


def _to_http(cause: ChapterDomainError) -> HTTPException:
    return HTTPException(status_code=cause.status_code, detail=cause.detail)


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
    try:
        ensure_chapter_number_free(session, novel_id, payload.chapter_number)
    except ChapterDomainError as cause:
        raise _to_http(cause) from cause

    chapter = Chapter(
        novel_id=novel_id,
        word_count=len(payload.content),
        **payload.model_dump(),
    )
    session.add(chapter)
    session.commit()
    session.refresh(chapter)
    return chapter


@router.post("/{novel_id}/chapters/{chapter_id}/machine-check")
def run_machine_check(
    novel_id: int,
    chapter_id: int,
    payload: MachineCheckRequest,
    session: Session = Depends(get_session),
) -> dict:
    get_novel_or_404(novel_id, session)
    try:
        chapter = get_chapter_or_error(session, novel_id, chapter_id)
    except ChapterDomainError as cause:
        raise _to_http(cause) from cause
    return machine_check(chapter, payload.model_dump())


@router.post("/{novel_id}/chapters/from-brief/{brief_id}", status_code=201)
def generate_chapter_from_brief(
    novel_id: int,
    brief_id: int,
    session: Session = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
) -> dict:
    novel = get_novel_or_404(novel_id, session)
    brief = session.get(ChapterBrief, brief_id)
    if brief is None or brief.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter brief not found")

    try:
        return generate_from_brief(session, llm, novel, brief)
    except ChapterDomainError as cause:
        raise _to_http(cause) from cause


@router.get("/{novel_id}/chapters/{chapter_id}", response_model=Chapter)
def get_chapter(
    novel_id: int,
    chapter_id: int,
    session: Session = Depends(get_session),
) -> Chapter:
    get_novel_or_404(novel_id, session)
    try:
        return get_chapter_or_error(session, novel_id, chapter_id)
    except ChapterDomainError as cause:
        raise _to_http(cause) from cause


@router.put("/{novel_id}/chapters/{chapter_id}", response_model=Chapter)
def update_chapter(
    novel_id: int,
    chapter_id: int,
    payload: ChapterCreate,
    session: Session = Depends(get_session),
) -> Chapter:
    get_novel_or_404(novel_id, session)
    try:
        chapter = get_chapter_or_error(session, novel_id, chapter_id)
        ensure_chapter_number_free(session, novel_id, payload.chapter_number, exclude_id=chapter_id)
    except ChapterDomainError as cause:
        raise _to_http(cause) from cause

    for field, value in payload.model_dump().items():
        setattr(chapter, field, value)
    chapter.word_count = len(payload.content)
    session.add(chapter)
    session.commit()
    session.refresh(chapter)
    return chapter
