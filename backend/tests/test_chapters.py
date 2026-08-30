from fastapi.testclient import TestClient


def test_create_and_list_chapters(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "章节测试"}).json()["id"]

    response = client.post(
        f"/api/novels/{novel_id}/chapters",
        json={
            "chapter_number": 1,
            "title": "第一章",
            "content": "主角推开院门，发现雪地里有一行陌生的脚印。",
        },
    )

    assert response.status_code == 201
    assert response.json()["word_count"] == len("主角推开院门，发现雪地里有一行陌生的脚印。")

    response = client.get(f"/api/novels/{novel_id}/chapters")

    assert response.status_code == 200
    assert response.json()[0]["title"] == "第一章"


def test_reject_duplicate_chapter_number(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "章节去重"}).json()["id"]
    client.post(f"/api/novels/{novel_id}/chapters", json={"chapter_number": 1})

    response = client.post(f"/api/novels/{novel_id}/chapters", json={"chapter_number": 1})

    assert response.status_code == 409


def test_update_chapter_recalculates_word_count(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "章节更新"}).json()["id"]
    chapter = client.post(
        f"/api/novels/{novel_id}/chapters",
        json={"chapter_number": 1, "content": "旧正文。"},
    ).json()

    response = client.put(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}",
        json={"chapter_number": 1, "content": "新正文比旧正文更长一点。"},
    )

    assert response.status_code == 200
    assert response.json()["word_count"] == len("新正文比旧正文更长一点。")
