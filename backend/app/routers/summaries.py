from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from app.db import get_session
from app.models import Chapter, ChapterSummary, GenerationRun
from app.routers.planning import get_novel_or_404
from app.services.llm import (
    LLMClient,
    LLMError,
    LLMUnavailableError,
    get_llm_client,
    parse_json_object,
)
from app.services.prompts import build_summary_user_prompt


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


@router.post(
    "/{novel_id}/chapters/{chapter_id}/auto-summary",
    response_model=ChapterSummary,
    status_code=201,
)
def auto_create_chapter_summary(
    novel_id: int,
    chapter_id: int,
    session: Session = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
) -> ChapterSummary:
    get_novel_or_404(novel_id, session)
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or chapter.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter not found")
    if chapter.status != "final":
        raise HTTPException(status_code=422, detail="Only final chapters can be summarized")
    if not llm.settings.is_configured:
        raise HTTPException(status_code=503, detail="LLM is not configured")

    existing = session.exec(
        select(ChapterSummary).where(
            ChapterSummary.novel_id == novel_id,
            ChapterSummary.chapter_number == chapter.chapter_number,
        )
    ).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="This chapter already has a summary")

    try:
        result = llm.complete(
            task_type="summary",
            system="你是中文网文事实提取器。只输出严格 JSON，不要解释。",
            user=build_summary_user_prompt(chapter),
        )
        payload = parse_json_object(result.content)
    except (LLMError, LLMUnavailableError) as cause:
        raise HTTPException(status_code=503, detail=str(cause)) from cause

    if not isinstance(payload.get("summary"), str):
        raise HTTPException(status_code=422, detail="LLM summary is invalid")

    generation_run = GenerationRun(
        novel_id=novel_id,
        chapter_id=chapter.id,
        task_type="fact_extract",
        model=result.model,
        input_summary=f"FinalChapter:{chapter.id}",
        output=result.content,
        token_input=result.token_input,
        token_output=result.token_output,
    )
    session.add(generation_run)
    session.commit()
    session.refresh(generation_run)

    chapter_summary = ChapterSummary(
        novel_id=novel_id,
        chapter_id=chapter.id,
        chapter_number=chapter.chapter_number,
        summary=payload["summary"],
        events=payload.get("events", []),
        character_state_changes=payload.get("character_state_changes", {}),
        foreshadow_updates=payload.get("foreshadow_updates", []),
    )
    session.add(chapter_summary)
    session.commit()
    session.refresh(chapter_summary)
    return chapter_summary
