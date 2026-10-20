from typing import Any

from sqlmodel import Session, select

import json

from app.models import Chapter, GenerationRun, Review, Revision
from app.services.chapters import ChapterDomainError
from app.services.context import build_writing_context
from app.services.llm import LLMClient
from app.services.prompts import (
    build_review_body_prompt,
    build_review_context_prompt,
    build_review_user_prompt,
)


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
        if dimension not in {"context_audit", "snapshot", "suggestions"}
        if not isinstance(quotes, list)
        or not quotes
        or any(quote not in chapter.content for quote in quotes)
    ]
    if invalid:
        raise ChapterDomainError(
            422, f"Evidence must quote chapter content: {', '.join(invalid)}"
        )


def _suggestion_anchor(content: str, quote: str) -> dict[str, str | int] | None:
    """Return one unambiguous local anchor, or no anchor at all.

    A review is advisory evidence, not a licence to rewrite a later draft.  A short
    quote repeated twice cannot distinguish which location the reviewer meant, so it
    remains in the review record but never becomes a clickable replacement.
    """
    starts: list[int] = []
    start = content.find(quote)
    while start >= 0:
        starts.append(start)
        start = content.find(quote, start + 1)
    if len(starts) != 1:
        return None
    start = starts[0]
    end = start + len(quote)
    return {
        "before": content[max(0, start - 32):start],
        "after": content[end:end + 32],
        "occurrence": 0,
    }


def normalize_review_suggestions(chapter: Chapter, evidence: dict) -> dict:
    """Keep only suggestion records that can later prove their anchor is intact."""
    raw = evidence.get("suggestions")
    if not isinstance(raw, list):
        return evidence
    normalized: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        quote = item.get("quote")
        if not isinstance(quote, str) or not quote or quote not in chapter.content:
            continue
        anchor = _suggestion_anchor(chapter.content, quote)
        if anchor is None:
            continue
        normalized.append({
            "quote": quote,
            "replacement": item.get("replacement", ""),
            "comment": item.get("comment", item.get("reason", "")),
            "status": item.get("status", "open"),
            "anchor": anchor,
        })
    return {**evidence, "suggestions": normalized}


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
    evidence = normalize_review_suggestions(chapter, evidence)
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


def _context_snapshot(session: Session, novel_id: int, chapter: Chapter) -> tuple[dict, str, int | None]:
    """Return the immutable draft manifest used for this chapter, if available."""
    run = session.exec(
        select(GenerationRun)
        .where(
            GenerationRun.novel_id == novel_id,
            GenerationRun.chapter_id == chapter.id,
            GenerationRun.task_type == "draft",
        )
        .order_by(GenerationRun.created_at.desc())
    ).first()
    if run is not None:
        try:
            snapshot = json.loads(run.input_summary or "{}")
        except json.JSONDecodeError:
            snapshot = {"raw": run.input_summary}
        return snapshot, "generation_run", run.id

    # Compatibility for chapters created by the old/manual endpoint.  Marking this
    # explicitly prevents a review from pretending it saw the original prompt.
    current = build_writing_context(
        session, novel_id, chapter.chapter_number, brief_id=chapter.brief_id
    )
    return {
        "source": "current_context_fallback",
        "warning": "未找到本章生成快照；以下内容是审稿时重新构建的上下文",
        "manifest": current.manifest(),
    }, "current_context_fallback", None


def _context_audit_passed(payload: dict) -> bool:
    decision = str(payload.get("decision", "passed")).lower()
    return decision in {"passed", "pass", "ok", "通过"} and not payload.get("conflicts") and not payload.get("missing")


def auto_review_chapter(session: Session, llm: LLMClient, novel_id: int, chapter: Chapter) -> Review:
    if not llm.settings.is_configured:
        raise ChapterDomainError(503, "LLM is not configured")

    from app.services.llm import LLMError, LLMUnavailableError, parse_json_object

    try:
        snapshot, snapshot_source, source_run_id = _context_snapshot(session, novel_id, chapter)
        context_result = llm.complete(
            task_type="review",
            system="你是审稿流程的第一阶段，只审计上下文快照，不审正文。",
            user=build_review_context_prompt(chapter, snapshot),
        )
        context_payload = parse_json_object(context_result.content)
        # Existing providers/tests may still return the old one-phase payload. Treat
        # it as a passed context phase and run the new body phase next.
        if "scores" in context_payload and "evidence" in context_payload:
            context_payload = {
                "decision": "passed",
                "comments": "兼容旧版审稿响应：上下文阶段未报告冲突。",
                "conflicts": [],
                "missing": [],
                "references": [],
            }

        if not _context_audit_passed(context_payload):
            body_payload = {
                "decision": "needs_revision",
                "comments": "上下文审计未通过，正文阶段未执行。",
                "scores": {},
                "evidence": {},
                "suggestions": [],
            }
            body_result = None
        else:
            body_result = llm.complete(
                task_type="review",
                system=(
                    "你是中文网文审稿人。先前上下文已通过；现在只审正文，"
                    "不得自动修改正文。每条 evidence 必须逐字引用正文。"
                ),
                user=build_review_body_prompt(chapter, snapshot, context_payload),
            )
            body_payload = parse_json_object(body_result.content)
    except (LLMError, LLMUnavailableError) as cause:
        raise ChapterDomainError(503, str(cause)) from cause

    scores = body_payload.get("scores", {})
    evidence = body_payload.get("evidence", {})
    if body_result is not None:
        validate_ai_review_payload(chapter, scores, evidence)

    combined_evidence = {
        **evidence,
        "context_audit": context_payload,
        "snapshot": {"source": snapshot_source, "generation_run_id": source_run_id},
        "suggestions": body_payload.get("suggestions", []),
    }
    phase_output = {
        "context_audit": context_payload,
        "body_audit": body_payload,
        "snapshot": snapshot,
    }

    generation_run = GenerationRun(
        novel_id=novel_id,
        chapter_id=chapter.id,
        task_type="review",
        model=(body_result or context_result).model,
        prompt_version="v2-two-phase",
        input_summary=json.dumps(
            {"snapshot": snapshot, "snapshot_source": snapshot_source,
             "source_generation_run_id": source_run_id,
             "phases": ["context_audit", "body_audit" if body_result else "body_skipped"]},
            ensure_ascii=False,
        ),
        output=json.dumps(phase_output, ensure_ascii=False),
        token_input=context_result.token_input + (body_result.token_input if body_result else 0),
        token_output=context_result.token_output + (body_result.token_output if body_result else 0),
    )
    session.add(generation_run)
    session.commit()
    session.refresh(generation_run)

    return record_ai_review(
        session,
        novel_id,
        chapter,
        decision=body_payload.get("decision", "needs_revision"),
        comments=(context_payload.get("comments", "") + "\n" + body_payload.get("comments", "")).strip(),
        scores=scores,
        evidence=combined_evidence,
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


def update_review_suggestion(
    session: Session,
    novel_id: int,
    chapter_id: int,
    review_id: int,
    suggestion_index: int,
    replacement: str | None,
    comment: str | None,
    status: str | None,
) -> Review:
    review = session.get(Review, review_id)
    if review is None or review.novel_id != novel_id or review.chapter_id != chapter_id:
        raise ChapterDomainError(404, "Review not found")
    suggestions = review.evidence.get("suggestions")
    if not isinstance(suggestions, list) or not 0 <= suggestion_index < len(suggestions):
        raise ChapterDomainError(404, "Review suggestion not found")
    current = suggestions[suggestion_index]
    if not isinstance(current, dict):
        raise ChapterDomainError(422, "Review suggestion is malformed")
    if status is not None and status not in {"open", "ignored", "applied"}:
        raise ChapterDomainError(422, "Invalid review suggestion status")
    next_suggestion = dict(current)
    if replacement is not None:
        next_suggestion["replacement"] = replacement
    if comment is not None:
        next_suggestion["comment"] = comment
    if status is not None:
        next_suggestion["status"] = status
    next_suggestions = list(suggestions)
    next_suggestions[suggestion_index] = next_suggestion
    review.evidence = {**review.evidence, "suggestions": next_suggestions}
    session.add(review)
    session.commit()
    session.refresh(review)
    return review


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

    approved_revision: Revision | None = None
    if decision == "reject":
        if not comments.strip():
            raise ChapterDomainError(422, "撤回终审必须填写原因")
        chapter.status = "draft"
    elif decision in {"accept", "edit"}:
        chapter.status = "final"
        previous = session.exec(
            select(Revision)
            .where(Revision.asset_type == "chapter_approved", Revision.asset_id == chapter.id)
            .order_by(Revision.revision.desc())
        ).first()
        approved_revision = Revision(
            novel_id=chapter.novel_id,
            asset_type="chapter_approved",
            asset_id=chapter.id,
            revision=(previous.revision + 1) if previous else 1,
            snapshot={
                "chapter_number": chapter.chapter_number,
                "title": chapter.title,
                "content": chapter.content,
                "word_count": chapter.word_count,
                "status": "approved",
            },
            actor="user",
        )
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
    if approved_revision is not None:
        session.add(approved_revision)
    session.add(chapter)
    session.commit()
    session.refresh(review)
    return review
