"""删除语义（D-22③ 与 D-23）。

两条测试各管一个方向的错：
- 删不净：书没了，派生行还在，下一次同名新建会撞上 unique 约束，
  或者在统计里留下永远数不到的幽灵；
- 删过头：级联写成「删所有」，把另一本书一起带走。
"""

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import (
    ArcPlan,
    Chapter,
    ChapterBrief,
    ChapterSummary,
    ChatMessage,
    Character,
    CharacterAppearance,
    Foreshadow,
    GenerationRun,
    Novel,
    PlanningBlueprint,
    PlotFeedback,
    Review,
    Setting,
    TocEntry,
)

# 每一张 novel scoped 的表都要被点到，否则这条测试只是「删了个大概」
DEPENDENT_MODELS = (
    PlanningBlueprint,
    TocEntry,
    ArcPlan,
    ChapterBrief,
    Chapter,
    Setting,
    Character,
    CharacterAppearance,
    Foreshadow,
    ChapterSummary,
    PlotFeedback,
    GenerationRun,
    Review,
    ChatMessage,
)


def _seed(session: Session, title: str) -> None:
    novel = Novel(title=title)
    session.add(novel)
    session.commit()
    session.refresh(novel)
    nid = novel.id

    brief = ChapterBrief(novel_id=nid, chapter_number=1, hook="开场钩子")
    arc = ArcPlan(novel_id=nid, title="弧 1", start_chapter=1, end_chapter=3)
    session.add_all([brief, arc])
    session.commit()
    session.refresh(brief)
    session.refresh(arc)

    chapter = Chapter(novel_id=nid, chapter_number=1, brief_id=brief.id, content="正文")
    session.add(chapter)
    session.add(PlanningBlueprint(novel_id=nid, main_line="主线"))
    session.add(TocEntry(novel_id=nid, chapter_number=1, title="第一章"))
    session.add(Setting(novel_id=nid, category="term", name="碑"))
    session.add(Foreshadow(novel_id=nid, title="缺名", planted_chapter=1))
    session.add(PlotFeedback(novel_id=nid, content="收束太弱"))
    session.add(ChatMessage(novel_id=nid, role="user", content="你好"))
    session.commit()
    session.refresh(chapter)

    run = GenerationRun(novel_id=nid, chapter_id=chapter.id, task_type="draft", model="M")
    session.add(run)
    session.commit()
    session.refresh(run)

    session.add_all(
        [
            ChapterSummary(novel_id=nid, chapter_id=chapter.id, chapter_number=1, text="摘要"),
            Review(novel_id=nid, chapter_id=chapter.id, generation_run_id=run.id, decision="reject"),
        ]
    )
    character = Character(novel_id=nid, name="沈砚舟")
    session.add(character)
    session.commit()
    session.refresh(character)
    session.add(
        CharacterAppearance(
            character_id=character.id, novel_id=nid, chapter_number=1, role_in_chapter="在场"
        )
    )
    session.commit()


def _counts(session: Session, novel_id: int) -> dict[str, int]:
    out = {}
    for model in DEPENDENT_MODELS:
        rows = session.exec(select(model).where(model.novel_id == novel_id)).all()
        out[model.__tablename__] = len(rows)
    return out


def test_delete_novel_takes_every_dependent_row_with_it(client: TestClient, db_engine) -> None:
    with Session(db_engine) as session:
        _seed(session, "要删的书")
        doomed = session.exec(select(Novel).where(Novel.title == "要删的书")).one()
        alive = Novel(title="留下的书")
        session.add(alive)
        session.commit()
        session.refresh(alive)
        doomed_id, alive_id = doomed.id, alive.id
        assert sum(_counts(session, doomed_id).values()) == 14, "种子没铺满 14 张表"
        session.add(Chapter(novel_id=alive_id, chapter_number=1, content="别人的正文"))
        session.commit()

    assert client.delete(f"/api/novels/{doomed_id}").status_code == 204

    with Session(db_engine) as session:
        assert session.get(Novel, doomed_id) is None
        assert sum(_counts(session, doomed_id).values()) == 0, "有派生行没跟着删"
        # 删过头的那一半：另一本书一行都不许少
        assert session.get(Novel, alive_id) is not None
        assert len(session.exec(select(Chapter).where(Chapter.novel_id == alive_id)).all()) == 1


def test_delete_novel_of_an_unknown_id_is_404(client: TestClient) -> None:
    assert client.delete("/api/novels/424242").status_code == 404


def test_the_library_can_reach_the_end_point_it_has_always_called(
    client: TestClient, db_engine
) -> None:
    """`CharacterLibrary.remove()` 调的就是这条路径，而它以前不存在（必然 405）。"""
    with Session(db_engine) as session:
        _seed(session, "有人的书")
        novel = session.exec(select(Novel).where(Novel.title == "有人的书")).one()
        character = session.exec(select(Character).where(Character.novel_id == novel.id)).one()
        cid, nid = character.id, novel.id
        assert len(session.exec(select(CharacterAppearance)).all()) == 1

    assert client.delete(f"/api/novels/{nid}/characters/{cid}").status_code == 204

    with Session(db_engine) as session:
        assert session.get(Character, cid) is None
        assert session.exec(select(CharacterAppearance)).all() == []
        # 投影没了就是没了：文件层读的是同一张表
        assert client.get(f"/api/novels/{nid}/files/settings/characters/{cid}.md").status_code == 404


def test_a_character_of_another_novel_cannot_be_deleted_through_this_one(
    client: TestClient, db_engine
) -> None:
    """两个 id 拼出来的操作，必须先证明它们属于同一本书（T-18 那条教训的删除版）。"""
    with Session(db_engine) as session:
        _seed(session, "甲书")
        _seed(session, "乙书")
        first = session.exec(select(Novel).where(Novel.title == "甲书")).one()
        second = session.exec(select(Novel).where(Novel.title == "乙书")).one()
        stranger = session.exec(select(Character).where(Character.novel_id == second.id)).one()
        other_id, stranger_id = first.id, stranger.id

    assert client.delete(f"/api/novels/{other_id}/characters/{stranger_id}").status_code == 404

    with Session(db_engine) as session:
        assert session.get(Character, stranger_id) is not None
