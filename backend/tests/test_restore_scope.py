"""快照记的是什么范围，以及恢复一章是不是真的「一章一起回」。

主人 2026-09-07 批注 1：他只删过某一章，设置页却让他「恢复整本书」，还能展开去选
那些他根本没删的章；而恢复一章时 draft 与 brief 被拆成两次操作。这两件事都在这儿钉住。

和 test_backups.py 一样，这些用例必须跑在**文件库**上：内存库没有文件可复制，
快照这一环根本不存在。
"""

from fastapi.testclient import TestClient

from tests.planning_helpers import create_chapter, create_toc


def _book(client: TestClient, title: str = "范围") -> int:
    novel_id = client.post("/api/novels", json={"title": title}).json()["id"]
    for number in (1, 2, 3):
        create_chapter(client, novel_id, chapter_number=number, content=f"第{number}章的话。")
    create_toc(client, novel_id, chapter_number=1, title="雪夜")
    create_toc(client, novel_id, chapter_number=2, title="缺名的那个人")
    create_toc(client, novel_id, chapter_number=3, title="旧道脚印")
    return novel_id


def _mine(client: TestClient, novel_id: int) -> list[dict]:
    all_rows = client.get("/api/backups").json()["snapshots"]
    return [item for item in all_rows if item["novel_id"] == novel_id]


def _numbers(client: TestClient, novel_id: int) -> list[int]:
    rows = client.get(f"/api/novels/{novel_id}/chapters").json()
    return [item["chapter_number"] for item in rows]


def _missing(client: TestClient, snapshot: str, novel_id: int) -> list[dict]:
    url = f"/api/backups/chapters?file={snapshot}&novel_id={novel_id}"
    found = client.get(url)
    assert found.status_code == 200, found.text
    return found.json()


def _draft(client: TestClient, novel_id: int, number: int) -> str:
    url = f"/api/novels/{novel_id}/files/chapters/{number:04d}/draft.md"
    return client.get(url).json()["text"]


def _rename_toc(client: TestClient, novel_id: int, chapter: int, title: str) -> None:
    """改**现有**那一行的章名：整份目录重渲染后走唯一那条写通路 PUT。"""
    from app.services import documents

    url = f"/api/novels/{novel_id}/files/toc.md"
    current = client.get(url).json()
    rows = documents.load_document("toc", current["text"])
    for row in rows:
        if int(row["chapter"]) == chapter:
            row["title"] = title
    saved = client.put(
        url,
        json={
            "text": documents.render_document("toc", rows),
            "actor": "human",
            "base_revision": current.get("revision"),
        },
    )
    assert saved.status_code == 200, saved.text


def _toc(client: TestClient, novel_id: int) -> list[dict]:
    """当前目录的行（章名的唯一出处，D-29）。"""
    from app.services import documents

    url = f"/api/novels/{novel_id}/files/toc.md"
    return documents.load_document("toc", client.get(url).json()["text"])


def test_a_chapter_delete_says_the_book_is_still_on_the_shelf(file_client) -> None:
    """这一条钉的就是他看到的那个错：删了一章，那一行不该再给「恢复整本书」。

    判据是 book_on_shelf（查活库的 novel 表），不是文件名前缀 - 旧快照全叫
    deleted-*，靠前缀判就还是同一个错。
    """
    novel_id = _book(file_client)
    assert file_client.delete(
        f"/api/novels/{novel_id}/chapters/by-number/2"
    ).status_code == 204

    listed = _mine(file_client, novel_id)
    assert len(listed) == 1, listed
    assert listed[0]["scope"] == "chapter"
    assert listed[0]["book_on_shelf"] is True


def test_a_book_delete_says_the_shelf_is_empty(file_client) -> None:
    novel_id = _book(file_client, "整本")
    assert file_client.delete(f"/api/novels/{novel_id}").status_code == 204

    listed = _mine(file_client, novel_id)
    assert len(listed) == 1, listed
    assert listed[0]["scope"] == "book"
    assert listed[0]["book_on_shelf"] is False


def test_inserting_a_chapter_is_labelled_room_and_lists_nothing(file_client) -> None:
    """插章只是把后面的号往后挪，什么都没删 - 它得能被认出来，且展开是空的。"""
    novel_id = _book(file_client, "腾位")
    assert file_client.post(
        f"/api/novels/{novel_id}/chapters/make-room-after/1"
    ).status_code == 200

    listed = _mine(file_client, novel_id)
    assert listed[0]["scope"] == "room"
    assert listed[0]["book_on_shelf"] is True
    assert _missing(file_client, listed[0]["file"], novel_id) == []


def test_the_list_only_offers_the_chapter_that_is_actually_gone(file_client) -> None:
    """他原话：「关键是我根本没有删除那些章」- 没删的章不许出现在清单里。"""
    novel_id = _book(file_client, "只列少的")
    assert file_client.delete(
        f"/api/novels/{novel_id}/chapters/by-number/2"
    ).status_code == 204
    rows = _missing(file_client, _mine(file_client, novel_id)[0]["file"], novel_id)

    assert len(rows) == 1, f"只该列出真少掉的那一章，实际 {rows}"
    # 删第 2 章后原来的第 3 章补成第 2 章：快照里少掉的那一章当时住 2 号
    assert rows[0]["number"] == 2
    assert rows[0]["title"] == "缺名的那个人", "章名的唯一出处是目录那一行"
    assert rows[0]["paths"] == [
        "chapters/0002/brief.md",
        "chapters/0002/draft.md",
    ], "一行 = 一章，简报与正文成对，不再拆成两行让他点两次"


def test_restoring_a_chapter_brings_both_files_back_in_one_call(file_client) -> None:
    """恢复一章 = 一次调用，draft 与 brief 一起回，且章号弹回原位（沿用 28.7）。"""
    novel_id = _book(file_client, "一起回")
    assert file_client.delete(
        f"/api/novels/{novel_id}/chapters/by-number/2"
    ).status_code == 204
    assert _numbers(file_client, novel_id) == [1, 2]
    snapshot = _mine(file_client, novel_id)[0]["file"]
    rows = _missing(file_client, snapshot, novel_id)

    back = file_client.post(
        "/api/backups/restore/chapter",
        json={
            "file": snapshot,
            "novel_id": novel_id,
            "chapter_id": rows[0]["chapter_id"],
            "into": "book",
        },
    )
    assert back.status_code == 200, back.text
    result = back.json()["result"]
    assert result["restored"] == "book"
    assert result["made_room"] > 0, "没让位就是准备盖掉别人的正文"
    assert result["paths"] == [
        "chapters/0002/brief.md",
        "chapters/0002/draft.md",
    ]
    assert _numbers(file_client, novel_id) == [1, 2, 3]
    assert "第2章的话。" in _draft(file_client, novel_id, 2)
    assert "第1章的话。" in _draft(file_client, novel_id, 1)
    assert "第3章的话。" in _draft(file_client, novel_id, 3)
    brief_url = f"/api/novels/{novel_id}/files/chapters/0002/brief.md"
    assert file_client.get(brief_url).json()["text"], "简报没跟着回来，就是那种拆开的恢复"


def test_restoring_a_chapter_puts_its_directory_row_back(file_client) -> None:
    """28.7b：章名唯一的出处是目录那一行。恢复完只剩个光秃秃的 0002，
    就是只恢复了半章 - 批注 1 把「恢复某一章」变成主路径之后这不能再留。

    只补缺的那一行：别的章名一个字不许动（第二十九批批注 1 的收尾）。
    """
    novel_id = _book(file_client, "目录行")
    assert file_client.delete(
        f"/api/novels/{novel_id}/chapters/by-number/2"
    ).status_code == 204
    # 删完之后再改一次别的章名：恢复时必须保住这个新值，不能被快照盖回去。
    # 用 create_toc 是**追加**一行（它把文本拼在后面），改现有行要走整份 PUT。
    _rename_toc(file_client, novel_id, 2, "改过名的那一章")
    snapshot = _mine(file_client, novel_id)[0]["file"]
    rows = _missing(file_client, snapshot, novel_id)

    back = file_client.post(
        "/api/backups/restore/chapter",
        json={
            "file": snapshot,
            "novel_id": novel_id,
            "chapter_id": rows[0]["chapter_id"],
            "into": "book",
        },
    )
    assert back.status_code == 200, back.text
    assert back.json()["result"]["toc_row"] is True
    titles = {
        row["chapter"]: row["title"]
        for row in _toc(file_client, novel_id)
    }
    assert titles == {
        1: "雪夜",
        2: "缺名的那个人",
        3: "改过名的那一章",
    }, "补回的那一行要对得上，别的章名要保住（删完剩两行，让位后原第 2 行挪去 3）"


def test_restoring_the_same_chapter_twice_shifts_only_once(file_client) -> None:
    novel_id = _book(file_client, "两次")
    assert file_client.delete(
        f"/api/novels/{novel_id}/chapters/by-number/2"
    ).status_code == 204
    snapshot = _mine(file_client, novel_id)[0]["file"]
    rows = _missing(file_client, snapshot, novel_id)
    body = {
        "file": snapshot,
        "novel_id": novel_id,
        "chapter_id": rows[0]["chapter_id"],
        "into": "book",
    }

    first = file_client.post("/api/backups/restore/chapter", json=body)
    assert first.status_code == 200, first.text
    assert first.json()["result"]["made_room"] > 0
    again_rows = _missing(file_client, snapshot, novel_id)
    assert again_rows == [], "恢复完这一章就不再是少掉的章，不该还摆在清单里"
    assert _numbers(file_client, novel_id) == [1, 2, 3]
