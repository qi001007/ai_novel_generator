from fastapi.testclient import TestClient


def write_document(client: TestClient, novel_id: int, path: str) -> dict:
    current = client.get(f"/api/novels/{novel_id}/files/{path}").json()
    response = client.put(
        f"/api/novels/{novel_id}/files/{path}",
        json={"text": current["text"], "base_revision": current["revision"]},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_brief_append_creates_and_lists_chapter(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "章节测试"}).json()["id"]

    write_document(client, novel_id, "chapters/0001/brief.md")

    response = client.get(f"/api/novels/{novel_id}/chapters")
    assert response.status_code == 200
    assert response.json()[0]["chapter_number"] == 1


def test_repeated_brief_write_does_not_duplicate_a_chapter(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "章节去重"}).json()["id"]

    write_document(client, novel_id, "chapters/0001/brief.md")
    write_document(client, novel_id, "chapters/0001/brief.md")

    chapters = client.get(f"/api/novels/{novel_id}/chapters").json()
    assert [chapter["chapter_number"] for chapter in chapters] == [1]


def test_draft_write_recalculates_word_count(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "章节更新"}).json()["id"]
    write_document(client, novel_id, "chapters/0001/brief.md")
    current = client.get(f"/api/novels/{novel_id}/files/chapters/0001/draft.md").json()
    text = current["text"] + "新正文比旧正文更长一点。\n"

    response = client.put(
        f"/api/novels/{novel_id}/files/chapters/0001/draft.md",
        json={"text": text, "base_revision": current["revision"]},
    )

    assert response.status_code == 200, response.text
    chapter = client.get(f"/api/novels/{novel_id}/chapters").json()[0]
    assert chapter["word_count"] == len(chapter["content"])


def test_legacy_chapter_writes_are_retired(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "旧通路退役"}).json()["id"]

    created = client.post(
        f"/api/novels/{novel_id}/chapters",
        json={"chapter_number": 1, "content": "旧正文"},
    )
    updated = client.put(
        f"/api/novels/{novel_id}/chapters/1",
        json={"chapter_number": 1, "content": "新正文"},
    )

    assert created.status_code == 410
    assert updated.status_code == 410
    assert "brief.md" in created.json()["detail"]
    assert "draft.md" in updated.json()["detail"]
