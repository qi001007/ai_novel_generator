from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from app.db import get_session
from app.models import Chapter, Review
from app.routers.planning import get_novel_or_404


router = APIRouter(prefix="/novels", tags=["reviews"])


AI_REVIEW_DIMENSIONS = [
    "consistency",
    "character_behavior",
    "pacing",
    "continuity",
    "foreshadowing",
    "hook",
    "style",
]


class AIReviewCreate(SQLModel):
    decision: str
    comments: str = ""
    scores: dict[str, float]
    evidence: dict[str, list[str]]


class HumanReviewCreate(SQLModel):
    decision: str
    comments: str = ""
    content: str | None = None


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
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or chapter.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter not found")

    missing_dimensions = [
        dimension
        for dimension in AI_REVIEW_DIMENSIONS
        if dimension not in payload.scores or dimension not in payload.evidence
    ]
    if missing_dimensions:
        raise HTTPException(
            status_code=422,
            detail=f"AI review is missing dimensions: {', '.join(missing_dimensions)}",
        )

    invalid_evidence = [
        dimension
        for dimension, quotes in payload.evidence.items()
        if not quotes or any(quote not in chapter.content for quote in quotes)
    ]
    if invalid_evidence:
        raise HTTPException(
            status_code=422,
            detail=f"Evidence must quote chapter content: {', '.join(invalid_evidence)}",
        )

    review = Review(
        novel_id=novel_id,
        chapter_id=chapter_id,
        reviewer="ai",
        decision=payload.decision,
        comments=payload.comments,
        evidence=payload.evidence,
        scores=payload.scores,
    )
    chapter.status = "ai_reviewed"
    session.add(review)
    session.add(chapter)
    session.commit()
    session.refresh(review)
    return review


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
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or chapter.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter not found")

    return list(
        session.exec(
            select(Review)
            .where(
                Review.novel_id == novel_id,
                Review.chapter_id == chapter_id,
            )
            .order_by(Review.created_at)
        ).all()
    )


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
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or chapter.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter not found")

    if payload.decision == "edit":
        if not payload.content:
            raise HTTPException(status_code=422, detail="Edited content is required")
        chapter.content = payload.content
        chapter.word_count = len(payload.content)

    if payload.decision == "reject":
        chapter.status = "draft"
    elif payload.decision in {"accept", "edit"}:
        chapter.status = "final"
    else:
        raise HTTPException(status_code=422, detail="Invalid final review decision")

    chapter.final_decision = payload.decision
    chapter.final_comment = payload.comments
    review = Review(
        novel_id=novel_id,
        chapter_id=chapter_id,
        reviewer="human",
        decision=payload.decision,
        comments=payload.comments,
    )
    session.add(review)
    session.add(chapter)
    session.commit()
    session.refresh(review)
    return review
