from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel

from app.db import get_session
from app.models import Review
from app.routers.planning import get_novel_or_404
from app.services.chapters import ChapterDomainError, get_chapter_or_error
from app.services.llm import LLMClient, get_llm_client
from app.services.reviews import (
    auto_review_chapter,
    list_reviews,
    record_ai_review,
    record_final_review,
    validate_ai_review_payload,
)


router = APIRouter(prefix="/novels", tags=["reviews"])


class AIReviewCreate(SQLModel):
    decision: str
    comments: str = ""
    scores: dict[str, float]
    evidence: dict[str, list[str]]


class HumanReviewCreate(SQLModel):
    decision: str
    comments: str = ""


def _to_http(cause: ChapterDomainError) -> HTTPException:
    return HTTPException(status_code=cause.status_code, detail=cause.detail)


def _load_chapter(session: Session, novel_id: int, chapter_id: int):
    try:
        return get_chapter_or_error(session, novel_id, chapter_id)
    except ChapterDomainError as cause:
        raise _to_http(cause) from cause


@router.post(
    "/{novel_id}/chapters/{chapter_id}/ai-review",
    response_model=Review,
    status_code=201,
)
def create_ai_review(
    novel_id: int,
    chapter_id: int,
    payload: AIReviewCreate,
    session: Session = Depends(get_session),
) -> Review:
    get_novel_or_404(novel_id, session)
    chapter = _load_chapter(session, novel_id, chapter_id)
    try:
        validate_ai_review_payload(chapter, payload.scores, payload.evidence)
        return record_ai_review(
            session,
            novel_id,
            chapter,
            decision=payload.decision,
            comments=payload.comments,
            scores=payload.scores,
            evidence=payload.evidence,
        )
    except ChapterDomainError as cause:
        raise _to_http(cause) from cause


@router.post(
    "/{novel_id}/chapters/{chapter_id}/auto-ai-review",
    response_model=Review,
    status_code=201,
)
def auto_ai_review(
    novel_id: int,
    chapter_id: int,
    session: Session = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
) -> Review:
    get_novel_or_404(novel_id, session)
    chapter = _load_chapter(session, novel_id, chapter_id)
    try:
        return auto_review_chapter(session, llm, novel_id, chapter)
    except ChapterDomainError as cause:
        raise _to_http(cause) from cause


@router.get(
    "/{novel_id}/chapters/{chapter_id}/reviews",
    response_model=list[Review],
)
def list_chapter_reviews(
    novel_id: int,
    chapter_id: int,
    session: Session = Depends(get_session),
) -> list[Review]:
    get_novel_or_404(novel_id, session)
    _load_chapter(session, novel_id, chapter_id)
    return list_reviews(session, novel_id, chapter_id)


@router.post(
    "/{novel_id}/chapters/{chapter_id}/final-review",
    response_model=Review,
    status_code=201,
)
def create_final_review(
    novel_id: int,
    chapter_id: int,
    payload: HumanReviewCreate,
    session: Session = Depends(get_session),
) -> Review:
    get_novel_or_404(novel_id, session)
    chapter = _load_chapter(session, novel_id, chapter_id)
    try:
        return record_final_review(
            session,
            chapter,
            decision=payload.decision,
            comments=payload.comments,
            content=None,
        )
    except ChapterDomainError as cause:
        raise _to_http(cause) from cause
