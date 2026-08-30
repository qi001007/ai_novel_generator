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
from app.services.planning import (
    PlanningDomainError,
    apply_payload,
    ensure_chapter_number_unique,
    get_owned_or_error,
    save,
    validate_arc_range,
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


def _to_http(cause: PlanningDomainError) -> HTTPException:
    return HTTPException(status_code=cause.status_code, detail=cause.detail)


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
    return save(session, PlanningBlueprint(novel_id=novel_id, **payload.model_dump()))


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
    try:
        blueprint = get_owned_or_error(
            session, PlanningBlueprint, novel_id, blueprint_id, "Planning blueprint"
        )
        apply_payload(blueprint, payload)
        return save(session, blueprint)
    except PlanningDomainError as cause:
        raise _to_http(cause) from cause


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
    try:
        ensure_chapter_number_unique(session, TocEntry, novel_id, payload.chapter_number, "TOC chapter")
        return save(session, TocEntry(novel_id=novel_id, **payload.model_dump()))
    except PlanningDomainError as cause:
        raise _to_http(cause) from cause


@router.put("/{novel_id}/planning/toc/{toc_entry_id}", response_model=TocEntry)
def update_toc_entry(
    novel_id: int,
    toc_entry_id: int,
    payload: TocEntryCreate,
    session: Session = Depends(get_session),
) -> TocEntry:
    get_novel_or_404(novel_id, session)
    try:
        toc_entry = get_owned_or_error(session, TocEntry, novel_id, toc_entry_id, "TOC entry")
        ensure_chapter_number_unique(
            session, TocEntry, novel_id, payload.chapter_number, "TOC chapter", exclude_id=toc_entry_id
        )
        apply_payload(toc_entry, payload)
        return save(session, toc_entry)
    except PlanningDomainError as cause:
        raise _to_http(cause) from cause


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
    try:
        validate_arc_range(payload.start_chapter, payload.end_chapter)
        return save(session, ArcPlan(novel_id=novel_id, **payload.model_dump()))
    except PlanningDomainError as cause:
        raise _to_http(cause) from cause


@router.put("/{novel_id}/planning/arcs/{arc_id}", response_model=ArcPlan)
def update_arc(
    novel_id: int,
    arc_id: int,
    payload: ArcPlanCreate,
    session: Session = Depends(get_session),
) -> ArcPlan:
    get_novel_or_404(novel_id, session)
    try:
        arc = get_owned_or_error(session, ArcPlan, novel_id, arc_id, "Arc plan")
        validate_arc_range(payload.start_chapter, payload.end_chapter)
        apply_payload(arc, payload)
        return save(session, arc)
    except PlanningDomainError as cause:
        raise _to_http(cause) from cause


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
    try:
        ensure_chapter_number_unique(
            session, ChapterBrief, novel_id, payload.chapter_number, "chapter brief"
        )
        return save(session, ChapterBrief(novel_id=novel_id, **payload.model_dump()))
    except PlanningDomainError as cause:
        raise _to_http(cause) from cause


@router.put("/{novel_id}/planning/briefs/{brief_id}", response_model=ChapterBrief)
def update_brief(
    novel_id: int,
    brief_id: int,
    payload: ChapterBriefCreate,
    session: Session = Depends(get_session),
) -> ChapterBrief:
    get_novel_or_404(novel_id, session)
    try:
        brief = get_owned_or_error(session, ChapterBrief, novel_id, brief_id, "Chapter brief")
        ensure_chapter_number_unique(
            session, ChapterBrief, novel_id, payload.chapter_number, "chapter brief", exclude_id=brief_id
        )
        apply_payload(brief, payload)
        return save(session, brief)
    except PlanningDomainError as cause:
        raise _to_http(cause) from cause
