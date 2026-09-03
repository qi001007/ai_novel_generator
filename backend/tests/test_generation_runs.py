from fastapi.testclient import TestClient

from tests.planning_helpers import create_chapter


def test_create_and_list_generation_run(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "生成记录测试"}).json()["id"]
    chapter = create_chapter(client, novel_id, content="生成正文。")

    response = client.post(
        f"/api/novels/{novel_id}/generation-runs",
        json={
            "chapter_id": chapter["id"],
            "task_type": "draft",
            "model": "test-model",
            "input_summary": "D 层简报",
            "output": "生成正文。",
            "token_input": 120,
            "token_output": 80,
            "cost_estimate": 0.02,
        },
    )

    assert response.status_code == 201
    assert response.json()["status"] == "completed"

    response = client.get(f"/api/novels/{novel_id}/generation-runs")

    assert response.status_code == 200
    assert response.json()[0]["model"] == "test-model"
