"""删一章：只动那一章，别的章一根毛都不掉；删完还能从快照里取回来。

第二十六批批注 6。章号不顺延是这一批定的语义（DECISIONS 里 D-11/D-13 的续）。
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
    # 空洞留着：1、3 还是 1、3，没有变成 1、2
    assert numbers == [1, 3]
    for keep in (1, 3):
        text = client.get(f"/api/novels/{novel_id}/files/chapters/{keep:04d}/draft.md").json()["text"]
        assert f"第{keep}章的话。" in text


def test_deleted_chapter_loses_both_of_its_files(client: TestClient) -> None:
    novel_id = _book(client)
    paths = {meta["path"] for meta in client.get(f"/api/novels/{novel_id}/files").json()}
    assert "chapters/0002/draft.md" in paths and "chapters/0002/brief.md" in paths

    client.delete(f"/api/novels/{novel_id}/chapters/by-number/2")

    after = {meta["path"] for meta in client.get(f"/api/novels/{novel_id}/files").json()}
    assert "chapters/0002/draft.md" not in after
    assert "chapters/0002/brief.md" not in after
    assert "chapters/0001/draft.md" in after


def test_deleting_a_chapter_leaves_a_snapshot_the_file_can_come_back_from(file_client: TestClient) -> None:
    # 快照是文件复制，必须跑在文件库上（conftest 的 file_client）
    client = file_client
    novel_id = _book(client)
    client.delete(f"/api/novels/{novel_id}/chapters/by-number/2")
    listed = client.get("/api/backups").json()["snapshots"]
    assert len(listed) == 1 and listed[0]["novel_id"] == novel_id

    snapshot = listed[0]["file"]
    docs = client.get(f"/api/backups/documents?file={snapshot}").json()
    target = next((item for item in docs if item["path"] == "chapters/0002/brief.md"), None)
    assert target is not None, "简报没在快照的文件清单里"

    back = client.post(
        "/api/backups/restore/document",
        json={"file": snapshot, "novel_id": novel_id, "path": "chapters/0002/brief.md", "into": "book"},
    )
    assert back.status_code == 200, back.text
    numbers = [item["chapter_number"] for item in client.get(f"/api/novels/{novel_id}/chapters").json()]
    assert numbers == [1, 2, 3]


def test_refusals_are_plain(client: TestClient) -> None:
    novel_id = _book(client)
    assert client.delete(f"/api/novels/{novel_id}/chapters/by-number/99").status_code == 404
    assert client.delete("/api/novels/9999/chapters/by-number/1").status_code == 404
