from sqlmodel import Session, select

from app.models import Chapter, GenerationRun, Review
from app.services.chapters import ChapterDomainError
from app.services.llm import LLMClient
from app.services.prompts import build_review_user_prompt


AI_REVIEW_DIMENSIONS = [
    "consistency",
    "character_behavior",
    "pacing",
    "continuity",
    "foreshadowing",
    "hook",
    "style",
]


def validate_ai_review_payload(chapter: Chapter, scores: dict, evidence: dict) -> None:
    missing = [
        dimension
        for dimension in AI_REVIEW_DIMENSIONS
        if dimension not in scores or dimension not in evidence
    ]
    if missing:
        raise ChapterDomainError(
            422, f"AI review is missing dimensions: {', '.join(missing)}"
        )
    invalid = [
        dimension
        for dimension, quotes in evidence.items()
        if not isinstance(quotes, list)
        or not quotes
        or any(quote not in chapter.content for quote in quotes)
    ]
    if invalid:
        raise ChapterDomainError(
            422, f"Evidence must quote chapter content: {', '.join(invalid)}"
        )


def record_ai_review(
    session: Session,
    novel_id: int,
    chapter: Chapter,
    decision: str,
    comments: str,
    scores: dict,
    evidence: dict,
    generation_run_id: int | None = None,
) -> Review:
    review = Review(
        novel_id=novel_id,
        chapter_id=chapter.id,
        generation_run_id=generation_run_id,
        reviewer="ai",
        decision=decision,
        comments=comments,
        evidence=evidence,
        scores=scores,
    )
    chapter.status = "ai_reviewed"
    session.add(review)
    session.add(chapter)
    session.commit()
    session.refresh(review)
    return review


def auto_review_chapter(session: Session, llm: LLMClient, novel_id: int, chapter: Chapter) -> Review:
    if not llm.settings.is_configured:
        raise ChapterDomainError(503, "LLM is not configured")

    from app.services.llm import LLMError, LLMUnavailableError, parse_json_object

    try:
        result = llm.complete(
            task_type="review",
            system=(
                "你是中文网文审稿人。必须输出完整七维 JSON，"
                "每条 evidence 都必须逐字引用正文。"
            ),
            user=build_review_user_prompt(chapter),
        )
        payload = parse_json_object(result.content)
    except (LLMError, LLMUnavailableError) as cause:
        raise ChapterDomainError(503, str(cause)) from cause

    scores = payload.get("scores", {})
    evidence = payload.get("evidence", {})
    validate_ai_review_payload(chapter, scores, evidence)

    generation_run = GenerationRun(
        novel_id=novel_id,
        chapter_id=chapter.id,
        task_type="review",
        model=result.model,
        prompt_version="v1",
        input_summary=f"Chapter:{chapter.id}",
        output=result.content,
        token_input=result.token_input,
        token_output=result.token_output,
    )
    session.add(generation_run)
    session.commit()
    session.refresh(generation_run)

    return record_ai_review(
        session,
        novel_id,
        chapter,
        decision=payload["decision"],
        comments=payload.get("comments", ""),
        scores=scores,
        evidence=evidence,
        generation_run_id=generation_run.id,
    )


def list_reviews(session: Session, novel_id: int, chapter_id: int) -> list[Review]:
    return list(
        session.exec(
            select(Review).where(
                Review.novel_id == novel_id,
                Review.chapter_id == chapter_id,
            )
            .order_by(Review.created_at)
        ).all()
    )


def record_final_review(
    session: Session,
    chapter: Chapter,
    decision: str,
    comments: str,
    content: str | None,
) -> Review:
    if decision == "edit":
        if not content:
            raise ChapterDomainError(422, "Edited content is required")
        chapter.content = content
        chapter.word_count = len(content)

    if decision == "reject":
        chapter.status = "draft"
    elif decision in {"accept", "edit"}:
        chapter.status = "final"
    else:
        raise ChapterDomainError(422, "Invalid final review decision")

    chapter.final_decision = decision
    chapter.final_comment = comments
    review = Review(
        novel_id=chapter.novel_id,
        chapter_id=chapter.id,
        reviewer="human",
        decision=decision,
        comments=comments,
    )
    session.add(review)
    session.add(chapter)
    session.commit()
    session.refresh(review)
    return review
