"""「重新编号」：章号出现空洞时，主人自己按一下就压回 1..N。

第二十九批批注 5。他举的例子是「原本已经是 1、2、4、5、6，再怎么加都差一个」，
并且写死了三条：有触发键、按 1..N 全更新一遍、**只改前面的序号不改章节名**。
还有一条是我自己加的：动手前先出逐行报告 - 28.6b 那条自动迁移被驳回，缺的就是它。
"""

from fastapi.testclient import TestClient

from tests.planning_helpers import create_chapter, create_toc


def _book_with_a_hole(client: TestClient, numbers=(1, 2, 5, 6)) -> int:
    novel_id = client.post("/api/novels", json={"title": "空洞"}).json()["id"]
    for number in numbers:
        create_chapter(
            client, novel_id, chapter_number=number, content=f"第{number}章的话。"
        )
    return novel_id


def _numbers(client: TestClient, novel_id: int) -> list[int]:
    rows = client.get(f"/api/novels/{novel_id}/chapters").json()
    return [item["chapter_number"] for item in rows]


def _plan(client: TestClient, novel_id: int) -> dict:
    found = client.get(f"/api/novels/{novel_id}/chapters/renumber-plan")
    assert found.status_code == 200, found.text
    return found.json()


def test_the_plan_lists_every_number_that_will_move(client: TestClient) -> None:
    novel_id = _book_with_a_hole(client)
    plan = _plan(client, novel_id)
    assert plan["numbers"] == [1, 2, 5, 6]
    assert plan["target"] == [1, 2, 3, 4]
    assert plan["changes"] == [{"from": 5, "to": 3}, {"from": 6, "to": 4}]
    assert plan["already_contiguous"] is False


def test_two_holes_close_one_round_at_a_time_without_colliding(client: TestClient) -> None:
    """一次算完会撞唯一约束：[1,2,5,6] 同时做 5→3 和 6→4，第二条落点还站着东西。"""
    novel_id = _book_with_a_hole(client, numbers=(1, 2, 4, 7))
    assert _numbers(client, novel_id) == [1, 2, 4, 7]

    done = client.post(f"/api/novels/{novel_id}/chapters/densify")

    assert done.status_code == 200, done.text
    assert _numbers(client, novel_id) == [1, 2, 3, 4]
    assert done.json()["already"] is False
    # 内容跟着自己的章走，不是跟着号走
    draft = client.get(f"/api/novels/{novel_id}/files/chapters/0004/draft.md").json()
    assert "第7章的话。" in draft["text"]


def test_densify_moves_numbers_and_never_touches_a_chapter_name(client: TestClient) -> None:
    """他第 3 条注意事项：「不要去更新我的章节名」。"""
    novel_id = _book_with_a_hole(client, numbers=(1, 2, 4))
    create_toc(client, novel_id, chapter_number=1, title="雪夜碑鸣")
    create_toc(client, novel_id, chapter_number=2, title="缺名的那个人")
    create_toc(client, novel_id, chapter_number=4, title="旧道脚印")

    done = client.post(f"/api/novels/{novel_id}/chapters/densify")

    assert done.status_code == 200, done.text
    rows = client.get(f"/api/novels/{novel_id}/chapters").json()
    assert [item["chapter_number"] for item in rows] == [1, 2, 3]
    assert [item["title"] for item in rows] == [
        "雪夜碑鸣",
        "缺名的那个人",
        "旧道脚印",
    ], "号压掉了，名字必须还跟着自己那一章"


def test_consecutive_numbers_need_nothing_and_change_nothing(client: TestClient) -> None:
    novel_id = _book_with_a_hole(client, numbers=(1, 2, 3))
    assert _plan(client, novel_id)["already_contiguous"] is True

    done = client.post(f"/api/novels/{novel_id}/chapters/densify")

    assert done.status_code == 200, done.text
    assert done.json()["already"] is True
    assert done.json()["moved"] == 0
    assert _numbers(client, novel_id) == [1, 2, 3]


def test_a_renumber_leaves_a_snapshot_labelled_renumber(file_client: TestClient) -> None:
    """压号会搬动五张表的行，没有现场可退就不能按。"""
    novel_id = _book_with_a_hole(file_client)
    assert file_client.post(
        f"/api/novels/{novel_id}/chapters/densify"
    ).status_code == 200

    listed = [
        item
        for item in file_client.get("/api/backups").json()["snapshots"]
        if item["novel_id"] == novel_id
    ]
    assert listed and listed[0]["scope"] == "renumber"
