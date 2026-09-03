from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.db import get_session
from app.models import (
    ArcPlan,
    ChapterBrief,
    Novel,
    PlanningBlueprint,
    TocEntry,
)


router = APIRouter(prefix="/novels", tags=["planning"])


def get_novel_or_404(novel_id: int, session: Session) -> Novel:
    novel = session.get(Novel, novel_id)
    if novel is None:
        raise HTTPException(status_code=404, detail="Novel not found")
    return novel


def _retired_write() -> None:
    raise HTTPException(
        status_code=410,
        detail="四层规划写入口已收口到 PUT /files/{path}",
    )


@router.get("/{novel_id}/planning/blueprints", response_model=list[PlanningBlueprint])
def list_blueprints(
    novel_id: int,
    session: Session = Depends(get_session),
) -> list[PlanningBlueprint]:
    get_novel_or_404(novel_id, session)
    return list(
        session.exec(
            select(PlanningBlueprint)
            .where(PlanningBlueprint.novel_id == novel_id)
            .order_by(PlanningBlueprint.version)
        ).all()
    )


@router.post("/{novel_id}/planning/blueprints")
def create_blueprint() -> None:
    raise _retired_write()


@router.put("/{novel_id}/planning/blueprints/{blueprint_id}")
def update_blueprint() -> None:
    raise _retired_write()


@router.get("/{novel_id}/planning/toc", response_model=list[TocEntry])
def list_toc(
    novel_id: int,
    session: Session = Depends(get_session),
) -> list[TocEntry]:
    get_novel_or_404(novel_id, session)
    return list(
        session.exec(
            select(TocEntry)
            .where(TocEntry.novel_id == novel_id)
            .order_by(TocEntry.chapter_number)
        ).all()
    )


@router.post("/{novel_id}/planning/toc")
def create_toc_entry() -> None:
    raise _retired_write()


@router.put("/{novel_id}/planning/toc/{toc_entry_id}")
def update_toc_entry() -> None:
    raise _retired_write()


@router.get("/{novel_id}/planning/arcs", response_model=list[ArcPlan])
def list_arcs(
    novel_id: int,
    session: Session = Depends(get_session),
) -> list[ArcPlan]:
    get_novel_or_404(novel_id, session)
    return list(
        session.exec(
            select(ArcPlan)
            .where(ArcPlan.novel_id == novel_id)
            .order_by(ArcPlan.start_chapter)
        ).all()
    )


@router.post("/{novel_id}/planning/arcs")
def create_arc() -> None:
    raise _retired_write()


@router.put("/{novel_id}/planning/arcs/{arc_id}")
def update_arc() -> None:
    raise _retired_write()


@router.get("/{novel_id}/planning/briefs", response_model=list[ChapterBrief])
def list_briefs(
    novel_id: int,
    session: Session = Depends(get_session),
) -> list[ChapterBrief]:
    get_novel_or_404(novel_id, session)
    return list(
        session.exec(
            select(ChapterBrief)
            .where(ChapterBrief.novel_id == novel_id)
            .order_by(ChapterBrief.chapter_number)
        ).all()
    )


@router.post("/{novel_id}/planning/briefs")
def create_brief() -> None:
    raise _retired_write()


@router.put("/{novel_id}/planning/briefs/{brief_id}")
def update_brief() -> None:
    raise _retired_write()
