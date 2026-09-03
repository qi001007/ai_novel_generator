from fastapi.testclient import TestClient


def test_planning_writes_are_retired(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "写入口测试"}).json()["id"]
    paths = [
        "/planning/blueprints",
        "/planning/toc",
        "/planning/arcs",
        "/planning/briefs",
    ]

    for path in paths:
        assert client.post(f"/api/novels/{novel_id}{path}", json={}).status_code == 410
        assert client.put(f"/api/novels/{novel_id}{path}/1", json={}).status_code == 410

    assert client.get(f"/api/novels/{novel_id}/planning/briefs").status_code == 200
