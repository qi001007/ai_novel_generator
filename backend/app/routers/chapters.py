from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from app.db import get_session
from app.models import Chapter, ChapterBrief, GenerationRun
from app.routers.planning import get_novel_or_404
from app.services.draft import build_template_draft


router = APIRouter(prefix="/novels", tags=["chapters"])


class ChapterCreate(SQLModel):
    brief_id: int | None = None
    chapter_number: int
    title: str = ""
    content: str = ""
    status: str = "draft"


class MachineCheckRequest(SQLModel):
    min_word_count: int = 0
    max_word_count: int = 0
    forbidden_words: list[str] = []
    blacklist: list[str] = []
    required_facts: list[str] = []


@router.get("/{novel_id}/chapters", response_model=list[Chapter])
def list_chapters(
    novel_id: int,
    session: Session = Depends(get_session),
) -> list[Chapter]:
    get_novel_or_404(novel_id, session)
    return list(
        session.exec(
            select(Chapter)
            .where(Chapter.novel_id == novel_id)
            .order_by(Chapter.chapter_number)
        ).all()
    )


@router.post("/{novel_id}/chapters", response_model=Chapter, status_code=201)
def create_chapter(
    novel_id: int,
    payload: ChapterCreate,
    session: Session = Depends(get_session),
) -> Chapter:
    get_novel_or_404(novel_id, session)
    existing = session.exec(
        select(Chapter).where(
            Chapter.novel_id == novel_id,
            Chapter.chapter_number == payload.chapter_number,
        )
    ).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="This chapter already exists")

    chapter = Chapter(
        novel_id=novel_id,
        word_count=len(payload.content),
        **payload.model_dump(),
    )
    session.add(chapter)
    session.commit()
    session.refresh(chapter)
    return chapter


@router.post("/{novel_id}/chapters/{chapter_id}/machine-check")
def run_machine_check(
    novel_id: int,
    chapter_id: int,
    payload: MachineCheckRequest,
    session: Session = Depends(get_session),
) -> dict:
    get_novel_or_404(novel_id, session)
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or chapter.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter not found")

    issues: list[dict[str, str]] = []
    if payload.min_word_count and chapter.word_count < payload.min_word_count:
        issues.append(
            {
                "type": "word_count",
                "message": f"字数少于下限 {payload.min_word_count}",
            }
        )
    if payload.max_word_count and chapter.word_count > payload.max_word_count:
        issues.append(
            {
                "type": "word_count",
                "message": f"字数超过上限 {payload.max_word_count}",
            }
        )
    for word in payload.forbidden_words:
        if word and word in chapter.content:
            issues.append({"type": "forbidden_word", "message": f"命中禁用词：{word}"})
    for phrase in payload.blacklist:
        if phrase and phrase in chapter.content:
            issues.append({"type": "blacklist", "message": f"命中黑名单：{phrase}"})
    for fact in payload.required_facts:
        if fact and fact not in chapter.content:
            issues.append({"type": "missing_fact", "message": f"缺少必要事实：{fact}"})

    return {
        "passed": not issues,
        "word_count": chapter.word_count,
        "issues": issues,
    }


@router.post("/{novel_id}/chapters/from-brief/{brief_id}", status_code=201)
def generate_chapter_from_brief(
    novel_id: int,
    brief_id: int,
    session: Session = Depends(get_session),
) -> dict:
    get_novel_or_404(novel_id, session)
    brief = session.get(ChapterBrief, brief_id)
    if brief is None or brief.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter brief not found")

    existing = session.exec(
        select(Chapter).where(
            Chapter.novel_id == novel_id,
            Chapter.chapter_number == brief.chapter_number,
        )
    ).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="This chapter already exists")

    content = build_template_draft(brief)
    chapter = Chapter(
        novel_id=novel_id,
        brief_id=brief.id,
        chapter_number=brief.chapter_number,
        content=content,
        word_count=len(content),
        status="draft",
    )
    session.add(chapter)
    session.commit()
    session.refresh(chapter)

    generation_run = GenerationRun(
        novel_id=novel_id,
        chapter_id=chapter.id,
        task_type="draft",
        model="template-v1",
        input_summary=f"ChapterBrief:{brief.id}",
        output=content,
    )
    session.add(generation_run)
    session.commit()
    session.refresh(generation_run)

    machine_check = run_machine_check(
        novel_id,
        chapter.id,
        MachineCheckRequest(required_facts=brief.required_facts),
        session,
    )
    return {
        "chapter": chapter,
        "generation_run": generation_run,
        "machine_check": machine_check,
    }


@router.get("/{novel_id}/chapters/{chapter_id}", response_model=Chapter)
def get_chapter(
    novel_id: int,
    chapter_id: int,
    session: Session = Depends(get_session),
) -> Chapter:
    get_novel_or_404(novel_id, session)
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or chapter.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return chapter


@router.put("/{novel_id}/chapters/{chapter_id}", response_model=Chapter)
def update_chapter(
    novel_id: int,
    chapter_id: int,
    payload: ChapterCreate,
    session: Session = Depends(get_session),
) -> Chapter:
    get_novel_or_404(novel_id, session)
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or chapter.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter not found")

    duplicate = session.exec(
        select(Chapter).where(
            Chapter.novel_id == novel_id,
            Chapter.chapter_number == payload.chapter_number,
            Chapter.id != chapter_id,
        )
    ).first()
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="This chapter already exists")

    for field, value in payload.model_dump().items():
        setattr(chapter, field, value)
    chapter.word_count = len(payload.content)
    session.add(chapter)
    session.commit()
    session.refresh(chapter)
    return chapter
