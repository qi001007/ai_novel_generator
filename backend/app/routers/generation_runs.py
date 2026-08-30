from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from app.db import get_session
from app.models import Chapter, GenerationRun
from app.routers.planning import get_novel_or_404


router = APIRouter(prefix="/novels", tags=["generation-runs"])


class GenerationRunCreate(SQLModel):
    chapter_id: int | None = None
    task_type: str
    model: str
    prompt_version: str = "v1"
    input_summary: str = ""
    output: str = ""
    token_input: int = 0
    token_output: int = 0
    cost_estimate: float = 0.0


def get_chapter_or_404(novel_id: int, chapter_id: int, session: Session) -> Chapter:
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or chapter.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return chapter


@router.get("/{novel_id}/generation-runs", response_model=list[GenerationRun])
def list_generation_runs(
    novel_id: int,
    session: Session = Depends(get_session),
) -> list[GenerationRun]:
    get_novel_or_404(novel_id, session)
    return list(
        session.exec(
            select(GenerationRun)
            .where(GenerationRun.novel_id == novel_id)
            .order_by(GenerationRun.created_at)
        ).all()
    )


@router.get(
    "/{novel_id}/chapters/{chapter_id}/generation-runs",
    response_model=list[GenerationRun],
)
def list_chapter_generation_runs(
    novel_id: int,
    chapter_id: int,
    session: Session = Depends(get_session),
) -> list[GenerationRun]:
    get_novel_or_404(novel_id, session)
    get_chapter_or_404(novel_id, chapter_id, session)
    return list(
        session.exec(
            select(GenerationRun)
            .where(
                GenerationRun.novel_id == novel_id,
                GenerationRun.chapter_id == chapter_id,
            )
            .order_by(GenerationRun.created_at)
        ).all()
    )


@router.post("/{novel_id}/generation-runs", response_model=GenerationRun, status_code=201)
def create_generation_run(
    novel_id: int,
    payload: GenerationRunCreate,
    session: Session = Depends(get_session),
) -> GenerationRun:
    get_novel_or_404(novel_id, session)
    if payload.chapter_id is not None:
        chapter = session.get(Chapter, payload.chapter_id)
        if chapter is None or chapter.novel_id != novel_id:
            raise HTTPException(status_code=404, detail="Chapter not found")

    generation_run = GenerationRun(novel_id=novel_id, **payload.model_dump())
    session.add(generation_run)
    session.commit()
    session.refresh(generation_run)
    return generation_run
