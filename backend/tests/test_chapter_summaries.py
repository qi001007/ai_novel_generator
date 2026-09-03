from fastapi.testclient import TestClient

from tests.planning_helpers import create_chapter


def test_create_summary_for_final_chapter(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "摘要测试"}).json()["id"]
    chapter = create_chapter(
        client, novel_id, content="终稿正文。", status="final"
    )

    response = client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/summary",
        json={
            "summary": "主角发现雪地脚印。",
            "events": [{"type": "discovery", "detail": "陌生脚印"}],
            "character_state_changes": {"主角": "警觉"},
            "foreshadow_updates": [{"title": "脚印来源", "status": "open"}],
        },
    )

    assert response.status_code == 201
    assert response.json()["chapter_number"] == 1
    assert response.json()["is_confirmed"] is True


def test_reject_summary_before_final_review(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "摘要拒绝"}).json()["id"]
    chapter = create_chapter(client, novel_id, content="未终审正文。")

    response = client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/summary",
        json={"summary": "不应该写入。"},
    )

    assert response.status_code == 422


def test_reject_duplicate_summary(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "摘要去重"}).json()["id"]
    chapter = create_chapter(client, novel_id, status="final")
    client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/summary",
        json={"summary": "第一次摘要。"},
    )

    response = client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/summary",
        json={"summary": "第二次摘要。"},
    )

    assert response.status_code == 409
