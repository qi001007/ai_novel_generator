from fastapi.testclient import TestClient


def test_create_and_list_plot_feedback(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "反馈测试"}).json()["id"]

    response = client.post(
        f"/api/novels/{novel_id}/feedback",
        json={
            "content": "第 3 章不要让主角这么早离开。",
            "impact_levels": ["D", "C"],
            "suggestions": {"D": "延后出发时间"},
        },
    )

    assert response.status_code == 201
    assert response.json()["status"] == "pending"

    response = client.get(f"/api/novels/{novel_id}/feedback")

    assert response.status_code == 200
    assert response.json()[0]["impact_levels"] == ["D", "C"]


def test_update_plot_feedback_status(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "反馈更新"}).json()["id"]
    feedback = client.post(
        f"/api/novels/{novel_id}/feedback",
        json={"content": "调整第二弧线节奏。"},
    ).json()

    response = client.put(
        f"/api/novels/{novel_id}/feedback/{feedback['id']}",
        json={"status": "applied"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "applied"
    assert response.json()["applied_at"] is not None
