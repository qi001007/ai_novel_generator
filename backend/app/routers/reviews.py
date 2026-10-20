from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from app.db import get_session
from app.models import ContextWorkflow, Review, WorkflowBinding, WorkflowRun, WorkflowVersion
from app.routers.planning import get_novel_or_404
from app.services.chapters import ChapterDomainError, get_chapter_or_error
from app.services.reviews import (
    list_reviews,
    record_ai_review,
    record_final_review,
    update_review_suggestion,
    validate_ai_review_payload,
)
from app.services.workflow_engine import execute_workflow


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
    binding = session.exec(select(WorkflowBinding).where(
        WorkflowBinding.novel_id == novel_id,
        WorkflowBinding.purpose == "review",
    )).first()
    if binding is None:
        raise HTTPException(status_code=409, detail="请先在 Workflow 中设置当前 AI 自检流程")
    workflow = session.get(ContextWorkflow, binding.workflow_id)
    if workflow is None or workflow.purpose != "review":
        raise HTTPException(status_code=409, detail="当前 AI 自检流程绑定已失效")
    version = session.exec(select(WorkflowVersion).where(
        WorkflowVersion.workflow_id == workflow.id,
        WorkflowVersion.purpose == "review",
    ).order_by(WorkflowVersion.version.desc())).first()
    if version is None:
        raise HTTPException(status_code=409, detail="当前 AI 自检流程尚未发布")
    run = WorkflowRun(
        novel_id=novel_id,
        workflow_id=workflow.id,
        workflow_version_id=version.id,
        input={
            "workflow_purpose": "review",
            "chapter_id": chapter.id,
            "chapter_number": chapter.chapter_number,
            "query": f"检查第 {chapter.chapter_number} 章正文",
        },
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    execute_workflow(session, run)
    run = session.get(WorkflowRun, run.id)
    if run is None or run.status != "completed":
        raise HTTPException(status_code=422, detail=(run.error if run else "AI 自检运行丢失"))
    issues: list[dict[str, Any]] = []
    for value in run.output.values():
        if isinstance(value, dict) and isinstance(value.get("issues"), list):
            issues = value["issues"]
            break
    suggestions = [{
        "category": item["category"],
        "severity": item["severity"],
        "location": item["location"],
        "quote": item["quote"],
        "replacement": item["suggestion"],
        "comment": item["reason"],
        "status": "open",
    } for item in issues]
    return record_ai_review(
        session,
        novel_id,
        chapter,
        decision="issues" if suggestions else "pass",
        comments=f"Workflow {workflow.name} v{version.version}",
        scores={},
        evidence={"suggestions": suggestions, "workflow_run_id": run.id},
        generation_run_id=None,
    )


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
