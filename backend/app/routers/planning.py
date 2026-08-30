from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from app.db import get_session
from app.models import (
    ArcPlan,
    ChapterBrief,
    Novel,
    PlanningBlueprint,
    TocEntry,
)


router = APIRouter(prefix="/novels", tags=["planning"])


class PlanningBlueprintCreate(SQLModel):
    version: int = 1
    is_active: bool = True
    main_line: str = ""
    ending: str = ""
    core_conflicts: str = ""
    themes: str = ""
    constraints: str = ""


class TocEntryCreate(SQLModel):
    chapter_number: int
    title: str = ""
    plot_function: str = ""
    notes: str = ""
    is_active: bool = True


class ArcPlanCreate(SQLModel):
    title: str = ""
    start_chapter: int
    end_chapter: int
    objective: str = ""
    conflict: str = ""
    resolution: str = ""
    status: str = "planned"
    planned_chapters: dict = {}


class ChapterBriefCreate(SQLModel):
    arc_plan_id: int | None = None
    chapter_number: int
    goal: str = ""
    events: str = ""
    pov: str = ""
    characters: list[str] = []
    conflict: str = ""
    hook: str = ""
    required_facts: list[str] = []
    status: str = "draft"


def get_novel_or_404(novel_id: int, session: Session) -> Novel:
    novel = session.get(Novel, novel_id)
    if novel is None:
        raise HTTPException(status_code=404, detail="Novel not found")
    return novel


def apply_payload(instance, payload: SQLModel) -> None:
    for field, value in payload.model_dump().items():
        setattr(instance, field, value)


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


@router.post(
    "/{novel_id}/planning/blueprints",
    response_model=PlanningBlueprint,
    status_code=201,
)
def create_blueprint(
    novel_id: int,
    payload: PlanningBlueprintCreate,
    session: Session = Depends(get_session),
) -> PlanningBlueprint:
    get_novel_or_404(novel_id, session)
    blueprint = PlanningBlueprint(novel_id=novel_id, **payload.model_dump())
    session.add(blueprint)
    session.commit()
    session.refresh(blueprint)
    return blueprint


@router.put(
    "/{novel_id}/planning/blueprints/{blueprint_id}",
    response_model=PlanningBlueprint,
)
def update_blueprint(
    novel_id: int,
    blueprint_id: int,
    payload: PlanningBlueprintCreate,
    session: Session = Depends(get_session),
) -> PlanningBlueprint:
    get_novel_or_404(novel_id, session)
    blueprint = session.get(PlanningBlueprint, blueprint_id)
    if blueprint is None or blueprint.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Planning blueprint not found")

    apply_payload(blueprint, payload)
    session.add(blueprint)
    session.commit()
    session.refresh(blueprint)
    return blueprint


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


@router.post("/{novel_id}/planning/toc", response_model=TocEntry, status_code=201)
def create_toc_entry(
    novel_id: int,
    payload: TocEntryCreate,
    session: Session = Depends(get_session),
) -> TocEntry:
    get_novel_or_404(novel_id, session)
    existing = session.exec(
        select(TocEntry).where(
            TocEntry.novel_id == novel_id,
            TocEntry.chapter_number == payload.chapter_number,
        )
    ).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="This TOC chapter already exists")

    toc_entry = TocEntry(novel_id=novel_id, **payload.model_dump())
    session.add(toc_entry)
    session.commit()
    session.refresh(toc_entry)
    return toc_entry


@router.put("/{novel_id}/planning/toc/{toc_entry_id}", response_model=TocEntry)
def update_toc_entry(
    novel_id: int,
    toc_entry_id: int,
    payload: TocEntryCreate,
    session: Session = Depends(get_session),
) -> TocEntry:
    get_novel_or_404(novel_id, session)
    toc_entry = session.get(TocEntry, toc_entry_id)
    if toc_entry is None or toc_entry.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="TOC entry not found")

    duplicate = session.exec(
        select(TocEntry).where(
            TocEntry.novel_id == novel_id,
            TocEntry.chapter_number == payload.chapter_number,
            TocEntry.id != toc_entry_id,
        )
    ).first()
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="This TOC chapter already exists")

    apply_payload(toc_entry, payload)
    session.add(toc_entry)
    session.commit()
    session.refresh(toc_entry)
    return toc_entry


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


@router.post("/{novel_id}/planning/arcs", response_model=ArcPlan, status_code=201)
def create_arc(
    novel_id: int,
    payload: ArcPlanCreate,
    session: Session = Depends(get_session),
) -> ArcPlan:
    get_novel_or_404(novel_id, session)
    if payload.end_chapter < payload.start_chapter:
        raise HTTPException(status_code=422, detail="Arc end chapter is before start chapter")

    arc = ArcPlan(novel_id=novel_id, **payload.model_dump())
    session.add(arc)
    session.commit()
    session.refresh(arc)
    return arc


@router.put("/{novel_id}/planning/arcs/{arc_id}", response_model=ArcPlan)
def update_arc(
    novel_id: int,
    arc_id: int,
    payload: ArcPlanCreate,
    session: Session = Depends(get_session),
) -> ArcPlan:
    get_novel_or_404(novel_id, session)
    arc = session.get(ArcPlan, arc_id)
    if arc is None or arc.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Arc plan not found")
    if payload.end_chapter < payload.start_chapter:
        raise HTTPException(status_code=422, detail="Arc end chapter is before start chapter")

    apply_payload(arc, payload)
    session.add(arc)
    session.commit()
    session.refresh(arc)
    return arc


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


@router.post("/{novel_id}/planning/briefs", response_model=ChapterBrief, status_code=201)
def create_brief(
    novel_id: int,
    payload: ChapterBriefCreate,
    session: Session = Depends(get_session),
) -> ChapterBrief:
    get_novel_or_404(novel_id, session)
    existing = session.exec(
        select(ChapterBrief).where(
            ChapterBrief.novel_id == novel_id,
            ChapterBrief.chapter_number == payload.chapter_number,
        )
    ).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="This chapter brief already exists")

    brief = ChapterBrief(novel_id=novel_id, **payload.model_dump())
    session.add(brief)
    session.commit()
    session.refresh(brief)
    return brief


@router.put("/{novel_id}/planning/briefs/{brief_id}", response_model=ChapterBrief)
def update_brief(
    novel_id: int,
    brief_id: int,
    payload: ChapterBriefCreate,
    session: Session = Depends(get_session),
) -> ChapterBrief:
    get_novel_or_404(novel_id, session)
    brief = session.get(ChapterBrief, brief_id)
    if brief is None or brief.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter brief not found")

    duplicate = session.exec(
        select(ChapterBrief).where(
            ChapterBrief.novel_id == novel_id,
            ChapterBrief.chapter_number == payload.chapter_number,
            ChapterBrief.id != brief_id,
        )
    ).first()
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="This chapter brief already exists")

    apply_payload(brief, payload)
    session.add(brief)
    session.commit()
    session.refresh(brief)
    return brief
