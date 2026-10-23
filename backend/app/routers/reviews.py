from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel

from app.db import get_session
from app.models import Review
from app.routers.planning import get_novel_or_404
from app.services.chapters import ChapterDomainError, get_chapter_or_error
from app.services.reviews import (
    build_remediation_report,
    list_reviews,
    record_ai_review,
    record_final_review,
    run_review_workflow,
    update_review_suggestion,
    validate_ai_review_payload,
)


router = APIRouter(prefix="/novels", tags=["reviews"])


class AIReviewCreate(SQLModel):
    decision: str
    comments: str = ""
    scores: dict[str, float]
    evidence: dict[str, Any]


class HumanReviewCreate(SQLModel):
    decision: str
    comments: str = ""


class ReviewSuggestionUpdate(SQLModel):
    replacement: str | None = None
    comment: str | None = None
    status: str | None = None


class RemediationReportUpdate(SQLModel):
    markdown: str


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
) -> Review:
    get_novel_or_404(novel_id, session)
    chapter = _load_chapter(session, novel_id, chapter_id)
    try:
        return run_review_workflow(session, novel_id, chapter)
    except ChapterDomainError as cause:
        raise _to_http(cause) from cause


@router.get("/{novel_id}/chapters/{chapter_id}/reviews/{review_id}/remediation-report")
def remediation_report(
    novel_id: int,
    chapter_id: int,
    review_id: int,
    session: Session = Depends(get_session),
) -> dict[str, str]:
    get_novel_or_404(novel_id, session)
    chapter = _load_chapter(session, novel_id, chapter_id)
    review = session.get(Review, review_id)
    if review is None or review.novel_id != novel_id or review.chapter_id != chapter_id:
        raise HTTPException(status_code=404, detail="Review not found")
    _, filename = build_remediation_report(review, chapter)
    edited = review.evidence.get("remediation_markdown") if isinstance(review.evidence, dict) else None
    if isinstance(edited, str) and edited.strip():
        return {"filename": filename, "markdown": edited}
    markdown, filename = build_remediation_report(review, chapter)
    return {"filename": filename, "markdown": markdown}


@router.put("/{novel_id}/chapters/{chapter_id}/reviews/{review_id}/remediation-report")
def save_remediation_report(
    novel_id: int,
    chapter_id: int,
    review_id: int,
    payload: RemediationReportUpdate,
    session: Session = Depends(get_session),
) -> dict[str, str]:
    get_novel_or_404(novel_id, session)
    chapter = _load_chapter(session, novel_id, chapter_id)
    review = session.get(Review, review_id)
    if review is None or review.novel_id != novel_id or review.chapter_id != chapter_id:
        raise HTTPException(status_code=404, detail="Review not found")
    review.evidence = {**review.evidence, "remediation_markdown": payload.markdown}
    session.add(review)
    session.commit()
    session.refresh(review)
    _, filename = build_remediation_report(review, chapter)
    return {"filename": filename, "markdown": payload.markdown}


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


@router.patch(
    "/{novel_id}/chapters/{chapter_id}/reviews/{review_id}/suggestions/{suggestion_index}",
    response_model=Review,
)
def update_chapter_review_suggestion(
    novel_id: int,
    chapter_id: int,
    review_id: int,
    suggestion_index: int,
    payload: ReviewSuggestionUpdate,
    session: Session = Depends(get_session),
) -> Review:
    get_novel_or_404(novel_id, session)
    _load_chapter(session, novel_id, chapter_id)
    try:
        return update_review_suggestion(
            session,
            novel_id,
            chapter_id,
            review_id,
            suggestion_index,
            payload.replacement,
            payload.comment,
            payload.status,
        )
    except ChapterDomainError as cause:
        raise _to_http(cause) from cause


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
