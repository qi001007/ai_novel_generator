"""删一章：那一章的正文/简报/目录行都没了，后面的章号自动往前补位。

第二十六批批注 6 建了这个端点，当时定的是「章号不顺延」；**第二十八批批注 6 推翻了它**，
理由写在 test_chapter_numbers.py 里。这里的断言跟着搬家，不删条目。

后半截是第二十八批批注 7：删完号会前移，所以快照里那个 `chapters/0002/` 今天可能住着
**另一章** - 恢复必须先认身份，把它弹回原位，而不是把别人的正文盖掉。
"""

from fastapi.testclient import TestClient

from tests.planning_helpers import create_chapter


def _book(client: TestClient) -> int:
    novel_id = client.post("/api/novels", json={"title": "删章"}).json()["id"]
    for number in (1, 2, 3):
        create_chapter(client, novel_id, chapter_number=number, content=f"第{number}章的话。")
    return novel_id


def test_deleting_a_chapter_removes_only_that_chapter(client: TestClient) -> None:
    novel_id = _book(client)

    gone = client.delete(f"/api/novels/{novel_id}/chapters/by-number/2")

    assert gone.status_code == 204, gone.text
    assert gone.content == b""
    numbers = [item["chapter_number"] for item in client.get(f"/api/novels/{novel_id}/chapters").json()]
    # 空洞不留着：原来的第 3 章补成第 2 章（第二十八批批注 6）
    assert numbers == [1, 2]
    assert "第1章的话。" in client.get(
        f"/api/novels/{novel_id}/files/chapters/0001/draft.md"
    ).json()["text"]
    assert "第3章的话。" in client.get(
        f"/api/novels/{novel_id}/files/chapters/0002/draft.md"
    ).json()["text"]
    assert client.get(f"/api/novels/{novel_id}/files/chapters/0003/draft.md").status_code == 404


def test_deleted_chapter_loses_both_of_its_files(client: TestClient) -> None:
    novel_id = _book(client)
    paths = {meta["path"] for meta in client.get(f"/api/novels/{novel_id}/files").json()}
    assert "chapters/0002/draft.md" in paths and "chapters/0002/brief.md" in paths

    client.delete(f"/api/novels/{novel_id}/chapters/by-number/2")

    after = {meta["path"] for meta in client.get(f"/api/novels/{novel_id}/files").json()}
    # 号补位之后，0002 这对文件属于原来那一本的第 3 章；第 3 章那个位置整个消失
    assert "chapters/0003/draft.md" not in after
    assert "chapters/0003/brief.md" not in after
    assert "chapters/0001/draft.md" in after
    assert "chapters/0002/draft.md" in after


def test_deleting_a_chapter_leaves_a_snapshot_the_file_can_come_back_from(file_client: TestClient) -> None:
    # 快照是文件复制，必须跑在文件库上（conftest 的 file_client）
    client = file_client
    novel_id = _book(client)
    # 删最后一章：这条测的是「快照能把删掉的东西取回来」，中间章补位后再取回是
    # 第二十八批批注 7 的事（它要的是序号弹回原位），那里有专门的测试。
    client.delete(f"/api/novels/{novel_id}/chapters/by-number/3")
    listed = client.get("/api/backups").json()["snapshots"]
    assert len(listed) == 1 and listed[0]["novel_id"] == novel_id

    snapshot = listed[0]["file"]
    docs = client.get(f"/api/backups/documents?file={snapshot}").json()
    target = next((item for item in docs if item["path"] == "chapters/0003/brief.md"), None)
    assert target is not None, "简报没在快照的文件清单里"

    back = client.post(
        "/api/backups/restore/document",
        json={"file": snapshot, "novel_id": novel_id, "path": "chapters/0003/brief.md", "into": "book"},
    )
    assert back.status_code == 200, back.text
    numbers = [item["chapter_number"] for item in client.get(f"/api/novels/{novel_id}/chapters").json()]
    assert numbers == [1, 2, 3]


def _snapshot_of(client: TestClient, novel_id: int) -> str:
    listed = client.get("/api/backups").json()["snapshots"]
    mine = [item for item in listed if item["novel_id"] == novel_id]
    assert mine, f"删章没有留下快照：全部={listed} 找={novel_id}"
    return mine[0]["file"]


def _text(client: TestClient, novel_id: int, number: int) -> str:
    return client.get(
        f"/api/novels/{novel_id}/files/chapters/{number:04d}/draft.md"
    ).json()["text"]


def _numbers(client: TestClient, novel_id: int) -> list[int]:
    return [item["chapter_number"] for item in client.get(f"/api/novels/{novel_id}/chapters").json()]


def test_restoring_a_middle_chapter_puts_it_back_at_its_own_number(file_client: TestClient) -> None:
    """删第 2 章后第 3 章顶到了 0002；恢复 0002 时它必须再让回去，不是互相盖。"""
    client = file_client
    novel_id = _book(client)
    client.delete(f"/api/novels/{novel_id}/chapters/by-number/2")
    assert _numbers(client, novel_id) == [1, 2]
    assert "第3章的话。" in _text(client, novel_id, 2)  # 现在 0002 住着原来那一本的第 3 章

    back = client.post(
        "/api/backups/restore/document",
        json={
            "file": _snapshot_of(client, novel_id),
            "novel_id": novel_id,
            "path": "chapters/0002/draft.md",
            "into": "book",
        },
    )

    assert back.status_code == 200, back.text
    assert back.json()["result"]["made_room"] > 0, "没有让位，说明它会盖掉别人的正文"
    assert _numbers(client, novel_id) == [1, 2, 3]
    assert "第2章的话。" in _text(client, novel_id, 2)
    assert "第3章的话。" in _text(client, novel_id, 3)
    assert "第1章的话。" in _text(client, novel_id, 1)


def test_restoring_the_last_deleted_chapter_shifts_nothing(file_client: TestClient) -> None:
    """删的是最后一章时号是空着的，直接落回去，不该为了「弹回原位」而多挪一格。"""
    client = file_client
    novel_id = _book(client)
    client.delete(f"/api/novels/{novel_id}/chapters/by-number/3")

    back = client.post(
        "/api/backups/restore/document",
        json={
            "file": _snapshot_of(client, novel_id),
            "novel_id": novel_id,
            "path": "chapters/0003/draft.md",
            "into": "book",
        },
    )

    assert back.status_code == 200, back.text
    assert back.json()["result"]["made_room"] == 0
    assert _numbers(client, novel_id) == [1, 2, 3]
    assert "第2章的话。" in _text(client, novel_id, 2)


def test_restoring_the_same_path_twice_shifts_only_once(file_client: TestClient) -> None:
    """身份判定：第一次恢复要让位，第二次那号上已经就是它自己，不该再挪一次。"""
    client = file_client
    novel_id = _book(client)
    client.delete(f"/api/novels/{novel_id}/chapters/by-number/2")
    snapshot = _snapshot_of(client, novel_id)

    first = client.post(
        "/api/backups/restore/document",
        json={"file": snapshot, "novel_id": novel_id, "path": "chapters/0002/brief.md", "into": "book"},
    )
    assert first.status_code == 200, first.text
    assert first.json()["result"]["made_room"] > 0
    assert _numbers(client, novel_id) == [1, 2, 3]

    second = client.post(
        "/api/backups/restore/document",
        json={"file": snapshot, "novel_id": novel_id, "path": "chapters/0002/brief.md", "into": "book"},
    )
    assert second.status_code == 200, second.text
    assert second.json()["result"]["made_room"] == 0, "同一个章第二次恢复还在挪号，说明身份没认出来"
    assert _numbers(client, novel_id) == [1, 2, 3]


def test_restoring_bumps_the_chapters_that_were_pushed_down_even_when_the_slot_is_free(
    file_client: TestClient,
) -> None:
    """真机抓到的形状：删掉中间一章后，那个号常常**是空的**（空洞在别处），
    只判「有没有人占着这个号」就会漏 - 结果只放回被恢复那一章，被挤下来的
    5->4 没弹回去。判据得看「有没有章在快照里住得比这号靠后、现在却靠前了」。"""
    client = file_client
    novel_id = client.post("/api/novels", json={"title": "空洞在别处"}).json()["id"]
    for number in (1, 2, 3, 5):
        create_chapter(client, novel_id, chapter_number=number, content=f"第{number}章的话。")
    assert _numbers(client, novel_id) == [1, 2, 3, 5]

    client.delete(f"/api/novels/{novel_id}/chapters/by-number/3")
    assert _numbers(client, novel_id) == [1, 2, 4]  # 原来的第 5 章被顶上来了，3 号空着

    back = client.post(
        "/api/backups/restore/document",
        json={
            "file": _snapshot_of(client, novel_id),
            "novel_id": novel_id,
            "path": "chapters/0003/draft.md",
            "into": "book",
        },
    )

    assert back.status_code == 200, back.text
    assert back.json()["result"]["made_room"] > 0, "号空着就不让位 - 被挤下来的那章就再也回不去了"
    assert _numbers(client, novel_id) == [1, 2, 3, 5], "必须弹回删除前的原位，而不是变成 1,2,3,4"
    assert "第5章的话。" in _text(client, novel_id, 5)
    assert "第3章的话。" in _text(client, novel_id, 3)


def test_refusals_are_plain(client: TestClient) -> None:
    novel_id = _book(client)
    assert client.delete(f"/api/novels/{novel_id}/chapters/by-number/99").status_code == 404
    assert client.delete("/api/novels/9999/chapters/by-number/1").status_code == 404
