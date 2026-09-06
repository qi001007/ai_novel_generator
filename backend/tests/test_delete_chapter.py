"""删一章：那一章的正文/简报/目录行都没了，后面的章号自动往前补位。

第二十六批批注 6 建了这个端点，当时定的是「章号不顺延」；**第二十八批批注 6 推翻了它**，
理由写在 test_chapter_numbers.py 里。这里的断言跟着搬家，不删条目。
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


def test_refusals_are_plain(client: TestClient) -> None:
    novel_id = _book(client)
    assert client.delete(f"/api/novels/{novel_id}/chapters/by-number/99").status_code == 404
    assert client.delete("/api/novels/9999/chapters/by-number/1").status_code == 404
