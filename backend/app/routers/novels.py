from datetime import datetime
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import SQLModel, Session, select

from app.db import get_session
from app.models import (
    ArcPlan,
    Chapter,
    ChapterBrief,
    ChapterSummary,
    Character,
    CharacterAppearance,
    ChatMessage,
    Foreshadow,
    GenerationRun,
    Novel,
    PlanningBlueprint,
    PlotFeedback,
    Review,
    Setting,
    TocEntry,
    utc_now,
)


router = APIRouter(prefix="/novels", tags=["novels"])

# 删一本书要一起消失的东西。顺序是承重的：子记录先走，
# 所以 chapter 排在 chapter_brief 前面（chapter.brief_id 指着它），
# character_appearance 排在 character 前面（它指着 character.id）。
# app_config 故意不在这里 - 它是全局偏好，不属于任何一本书。
# 为什么是物理删除、为什么界面上要输书名确认：见 DECISIONS D-23。
NOVEL_SCOPED_MODELS = (
    CharacterAppearance,
    ChapterSummary,
    Review,
    GenerationRun,
    ChatMessage,
    PlotFeedback,
    Foreshadow,
    Chapter,
    ChapterBrief,
    Setting,
    Character,
    ArcPlan,
    TocEntry,
    PlanningBlueprint,
)


HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def _check_color(value: str | None) -> None:
    """A stray value would poison the custom property and render an invisible spine."""
    if value and not HEX_COLOR.match(value):
        raise HTTPException(status_code=422, detail="封面颜色必须是 #rrggbb 形式")


class NovelCreate(SQLModel):
    title: str
    description: str = ""
    target_chapters: int = 0
    style_constraints: str = ""
    cover_color: str = ""


class NovelUpdate(SQLModel):
    title: str | None = None
    description: str | None = None
    target_chapters: int | None = None
    style_constraints: str | None = None
    cover_image: str | None = None
    cover_color: str | None = None


class NovelCard(Novel):
    """A novel plus the numbers the bookshelf shows.

    The shelf cannot derive these itself without pulling every chapter, and it must not
    invent them: a missing figure stays zero and the UI renders an em dash.
    """

    chapter_count: int = 0
    done_count: int = 0
    total_words: int = 0
    last_edited_at: datetime | None = None


@router.get("", response_model=list[NovelCard])
def list_novels(session: Session = Depends(get_session)) -> list[NovelCard]:
    novels = list(session.exec(select(Novel).order_by(Novel.id)).all())
    # one pass over chapters, grouped here: a single-user desktop app has no reason to
    # carry a SQL aggregate that the caller then has to join back anyway
    tallies: dict[int, list] = {}
    for chapter in session.exec(select(Chapter)).all():
        row = tallies.setdefault(chapter.novel_id, [0, 0, 0, None])
        row[0] += 1
        if chapter.status == "final":
            row[1] += 1
        row[2] += chapter.word_count
        if row[3] is None or chapter.updated_at > row[3]:
            row[3] = chapter.updated_at

    cards = []
    for novel in novels:
        count, done, words, latest = tallies.get(novel.id, [0, 0, 0, None])
        stamps = [stamp for stamp in (latest, novel.updated_at) if stamp is not None]
        cards.append(
            NovelCard(
                **novel.model_dump(),
                chapter_count=count,
                done_count=done,
                total_words=words,
                last_edited_at=max(stamps) if stamps else None,
            )
        )
    return cards


@router.post("", response_model=Novel, status_code=201)
def create_novel(
    payload: NovelCreate,
    session: Session = Depends(get_session),
) -> Novel:
    _check_color(payload.cover_color)
    existing = session.exec(select(Novel).where(Novel.title == payload.title)).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="A novel with this title already exists")

    novel = Novel.model_validate(payload)
    session.add(novel)
    session.commit()
    session.refresh(novel)
    return novel


@router.get("/{novel_id}", response_model=Novel)
def get_novel(novel_id: int, session: Session = Depends(get_session)) -> Novel:
    novel = session.get(Novel, novel_id)
    if novel is None:
        raise HTTPException(status_code=404, detail="Novel not found")
    return novel


@router.put("/{novel_id}", response_model=Novel)
def update_novel(
    novel_id: int,
    payload: NovelUpdate,
    session: Session = Depends(get_session),
) -> Novel:
    novel = session.get(Novel, novel_id)
    if novel is None:
        raise HTTPException(status_code=404, detail="Novel not found")

    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    _check_color(changes.get("cover_color"))
    new_title = changes.get("title")
    if new_title is not None and new_title != novel.title:
        clash = session.exec(select(Novel).where(Novel.title == new_title)).first()
        if clash is not None:
            raise HTTPException(
                status_code=409,
                detail="A novel with this title already exists",
            )

    for field, value in changes.items():
        setattr(novel, field, value)
    novel.updated_at = utc_now()
    session.add(novel)
    session.commit()
    session.refresh(novel)
    return novel


@router.delete("/{novel_id}", status_code=204)
def delete_novel(novel_id: int, session: Session = Depends(get_session)) -> None:
    """整本书，连同它派生出的每一行。

    这是 D-01 的镜像面：写四层规划只有一条入口，删也只有一条。
    删完返回 204 - 没有东西可回，硬造一个 JSON 体是让前端去猜形状。
    """
    novel = session.get(Novel, novel_id)
    if novel is None:
        raise HTTPException(status_code=404, detail="Novel not found")
    for model in NOVEL_SCOPED_MODELS:
        for row in session.exec(
            select(model).where(model.novel_id == novel_id)
        ).all():
            session.delete(row)
    session.delete(novel)
    session.commit()
