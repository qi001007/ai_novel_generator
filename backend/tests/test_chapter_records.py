from fastapi.testclient import TestClient

from tests.planning_helpers import create_chapter


def test_list_chapter_generation_runs_and_reviews(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "记录测试"}).json()["id"]
    chapter = create_chapter(client, novel_id, content="主角推开院门。")
    client.post(
        f"/api/novels/{novel_id}/generation-runs",
        json={
            "chapter_id": chapter["id"],
            "task_type": "draft",
            "model": "test-model",
            "output": "主角推开院门。",
        },
    )
    client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/ai-review",
        json={
            "decision": "passed",
            "scores": {
                "consistency": 8,
                "character_behavior": 8,
                "pacing": 8,
                "continuity": 8,
                "foreshadowing": 8,
                "hook": 8,
                "style": 8,
            },
            "evidence": {
                "consistency": ["主角推开院门。"],
                "character_behavior": ["主角推开院门。"],
                "pacing": ["主角推开院门。"],
                "continuity": ["主角推开院门。"],
                "foreshadowing": ["主角推开院门。"],
                "hook": ["主角推开院门。"],
                "style": ["主角推开院门。"],
            },
        },
    )

    runs_response = client.get(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/generation-runs"
    )
    reviews_response = client.get(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/reviews"
    )

    assert runs_response.status_code == 200
    assert runs_response.json()[0]["model"] == "test-model"
    assert reviews_response.status_code == 200
    assert reviews_response.json()[0]["reviewer"] == "ai"
