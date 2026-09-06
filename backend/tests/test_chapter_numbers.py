"""章号是位置，名字是主人给的（第二十八批批注 6）。

这一批**推翻第二十六批 26.5 我定的「章号不顺延」**：他要的是删一章后面自动前移、
中间插一章后面自动后移，序号定死、名字自定义。所以这里钉三件事 -
号跟着位置走、名跟着章走、凡是写着章号的地方一起搬。
"""

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import (
    ArcPlan,
    Chapter,
    ChapterBrief,
    Character,
    Foreshadow,
    Novel,
    Setting,
    TocEntry,
)
from app.services.renumber import shift_after, vacate
from tests.planning_helpers import create_chapter


def _book(client: TestClient) -> int:
    novel_id = client.post("/api/novels", json={"title": "章号是位置"}).json()["id"]
    for number in (1, 2, 3):
        create_chapter(client, novel_id, chapter_number=number, content=f"第{number}章的话。")
    return novel_id


def _numbers(client: TestClient, novel_id: int) -> list[int]:
    return [item["chapter_number"] for item in client.get(f"/api/novels/{novel_id}/chapters").json()]


def _titles(client: TestClient, novel_id: int) -> dict[int, str]:
    return {item["chapter_number"]: item["title"] for item in client.get(f"/api/novels/{novel_id}/chapters").json()}


def test_deleting_shifts_every_later_chapter_down(client: TestClient) -> None:
    novel_id = _book(client)

    assert client.delete(f"/api/novels/{novel_id}/chapters/by-number/2").status_code == 204

    assert _numbers(client, novel_id) == [1, 2]
    # 原来第 3 章的话搬到了 0002，不是留在 0003 等主人自己找
    moved = client.get(f"/api/novels/{novel_id}/files/chapters/0002/draft.md").json()["text"]
    assert "第3章的话。" in moved
    assert client.get(f"/api/novels/{novel_id}/files/chapters/0003/draft.md").status_code == 404


def test_renaming_changes_the_name_and_not_the_number(client: TestClient) -> None:
    novel_id = _book(client)

    renamed = client.patch(
        f"/api/novels/{novel_id}/chapters/by-number/2/title", json={"title": "雪夜碑鸣"}
    )

    assert renamed.status_code == 200, renamed.text
    body = renamed.json()
    assert "chapter_number" in body, f"响应不是章节对象：{sorted(body)}"
    assert body["chapter_number"] == 2
    assert renamed.json()["title"] == "雪夜碑鸣"
    # 章名住在 B 目录那一行 - 写的是文件层那条唯一通路，所以文件面上也看得见
    toc = client.get(f"/api/novels/{novel_id}/files/toc.md").json()["text"]
    assert "雪夜碑鸣" in toc
    # 正文一个字没动
    draft = client.get(f"/api/novels/{novel_id}/files/chapters/0002/draft.md").json()["text"]
    assert "第2章的话。" in draft


def test_the_name_travels_with_the_chapter_when_numbers_shift(client: TestClient) -> None:
    novel_id = _book(client)
    client.patch(f"/api/novels/{novel_id}/chapters/by-number/3/title", json={"title": "碑下有名"})

    client.delete(f"/api/novels/{novel_id}/chapters/by-number/1")

    assert _titles(client, novel_id) == {1: "", 2: "碑下有名"}


def test_making_room_then_writing_the_brief_inserts_in_the_middle(client: TestClient) -> None:
    novel_id = _book(client)
    client.patch(f"/api/novels/{novel_id}/chapters/by-number/3/title", json={"title": "末章"})

    room = client.post(f"/api/novels/{novel_id}/chapters/make-room-after/2")

    assert room.status_code == 200, room.text
    assert room.json()["number"] == 3
    create_chapter(client, novel_id, chapter_number=3, content="插进来的那一章。")

    assert _numbers(client, novel_id) == [1, 2, 3, 4]
    # 名字跟着章走：末章现在是第 4 章，正文也跟着搬到 0004
    assert _titles(client, novel_id)[4] == "末章"
    assert "第3章的话。" in client.get(f"/api/novels/{novel_id}/files/chapters/0004/draft.md").json()["text"]


def test_making_room_moves_every_later_chapter_without_colliding(client: TestClient) -> None:
    """回归：真机上这本书有 8 章在后面，攒着一起 flush 会被合成 executemany、
    按它自己的顺序发 UPDATE，后移时 3→4 撞上还活着的 4，直接 500。
    只有「多行 + 降序 + 逐行落盘」才能抓到，所以这本书至少要有五章在后面。"""
    novel_id = client.post("/api/novels", json={"title": "多章腾位"}).json()["id"]
    for number in range(1, 8):
        create_chapter(client, novel_id, chapter_number=number, content=f"第{number}章的话。")

    room = client.post(f"/api/novels/{novel_id}/chapters/make-room-after/2")

    assert room.status_code == 200, room.text
    assert room.json()["number"] == 3
    numbers = [item["chapter_number"] for item in client.get(f"/api/novels/{novel_id}/chapters").json()]
    assert numbers == [1, 2, 4, 5, 6, 7, 8]
    # 每一章的正文跟着自己的号走，没有互相覆盖
    for old, new in [(3, 4), (4, 5), (7, 8)]:
        text = client.get(f"/api/novels/{novel_id}/files/chapters/{new:04d}/draft.md").json()["text"]
        assert f"第{old}章的话。" in text, f"第 {old} 章的话没搬到 {new:04d}"


def test_a_refusal_names_the_chapter_that_is_missing(client: TestClient) -> None:
    novel_id = _book(client)
    assert client.post(f"/api/novels/{novel_id}/chapters/make-room-after/9").status_code == 404
    assert client.patch(
        f"/api/novels/{novel_id}/chapters/by-number/9/title", json={"title": "不存在"}
    ).status_code == 404


def test_the_whole_class_of_number_bearing_columns_moves(db_engine) -> None:
    """弧起止、伏笔三处章号、人物预期章号、设定来源章 - 一次扫完，不是想到哪改到哪。"""
    with Session(db_engine) as session:
        novel = Novel(title="整类一起搬")
        session.add(novel)
        session.flush()
        for number in (1, 2, 3):
            session.add(Chapter(novel_id=novel.id, chapter_number=number, content=""))
            session.add(ChapterBrief(novel_id=novel.id, chapter_number=number, goal=""))
            session.add(TocEntry(novel_id=novel.id, chapter_number=number, title=f"名{number}"))
        session.add(ArcPlan(novel_id=novel.id, title="弧二", start_chapter=2, end_chapter=3))
        session.add(
            Foreshadow(
                novel_id=novel.id,
                title="碑",
                planted_chapter=3,
                expected_payoff_chapter=3,
                payoff_chapter=None,
            )
        )
        session.add(Character(novel_id=novel.id, name="沈", expected_start_chapter=2, expected_end_chapter=3))
        session.add(Setting(novel_id=novel.id, category="地理", name="碑", source_chapter=3))
        session.commit()

        # 先真的删掉第 1 章并腾空各表，再压号：这就是 delete_chapter 的顺序。
        doomed = session.exec(
            select(Chapter).where(Chapter.novel_id == novel.id, Chapter.chapter_number == 1)
        ).one()
        session.delete(doomed)
        vacate(session, novel.id, number=1)
        session.commit()
        shift_after(session, novel.id, above=1, delta=-1)
        session.commit()

        assert [row.chapter_number for row in session.exec(
            select(Chapter).where(Chapter.novel_id == novel.id).order_by(Chapter.chapter_number)
        ).all()] == [1, 2]
        arc = session.exec(select(ArcPlan).where(ArcPlan.novel_id == novel.id)).one()
        assert (arc.start_chapter, arc.end_chapter) == (1, 2)
        foreshadow = session.exec(select(Foreshadow).where(Foreshadow.novel_id == novel.id)).one()
        assert (foreshadow.planted_chapter, foreshadow.expected_payoff_chapter) == (2, 2)
        character = session.exec(select(Character).where(Character.novel_id == novel.id)).one()
        assert (character.expected_start_chapter, character.expected_end_chapter) == (1, 2)
        setting = session.exec(select(Setting).where(Setting.novel_id == novel.id)).one()
        assert setting.source_chapter == 2
        # 章名跟着自己的那一章走：删掉第 1 章之后，「名3」挂在第 2 章上
        toc = session.exec(
            select(TocEntry).where(TocEntry.novel_id == novel.id).order_by(TocEntry.chapter_number)
        ).all()
        assert [(row.chapter_number, row.title) for row in toc] == [(1, "名2"), (2, "名3")]


def test_vacating_empties_every_keyed_table_for_that_number(db_engine) -> None:
    """删一章要把目录行、摘要、出场记录一起腾空，否则压号必撞唯一约束。"""
    with Session(db_engine) as session:
        novel = Novel(title="腾空")
        session.add(novel)
        session.flush()
        session.add(Chapter(novel_id=novel.id, chapter_number=1, content=""))
        session.add(ChapterBrief(novel_id=novel.id, chapter_number=1, goal=""))
        session.add(TocEntry(novel_id=novel.id, chapter_number=1, title="名1"))
        session.add(TocEntry(novel_id=novel.id, chapter_number=2, title="名2"))
        session.commit()

        gone = vacate(session, novel.id, number=1)
        session.commit()

        assert gone == 3  # chapter + brief + toc 各一行
        left = session.exec(
            select(TocEntry).where(TocEntry.novel_id == novel.id).order_by(TocEntry.chapter_number)
        ).all()
        assert [(row.chapter_number, row.title) for row in left] == [(2, "名2")]
