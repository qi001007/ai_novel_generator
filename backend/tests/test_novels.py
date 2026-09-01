from fastapi.testclient import TestClient


def test_create_and_list_novels(client: TestClient) -> None:
    response = client.post(
        "/api/novels",
        json={"title": "测试作品", "description": "A novel for testing"},
    )

    assert response.status_code == 201
    assert response.json()["title"] == "测试作品"

    response = client.get("/api/novels")

    assert response.status_code == 200
    assert len(response.json()) == 1


def test_create_novel_rejects_duplicate_title(client: TestClient) -> None:
    client.post("/api/novels", json={"title": "测试作品"})

    response = client.post("/api/novels", json={"title": "测试作品"})

    assert response.status_code == 409


def test_update_novel_persists_cover(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "封面测试"}).json()["id"]

    response = client.put(
        f"/api/novels/{novel_id}",
        json={"cover_image": "data:image/png;base64,iVBORw0KGgo="},
    )

    assert response.status_code == 200
    assert response.json()["cover_image"] == "data:image/png;base64,iVBORw0KGgo="
    stored = client.get(f"/api/novels/{novel_id}").json()
    assert stored["cover_image"].startswith("data:image/png")


def test_partial_update_keeps_other_fields(client: TestClient) -> None:
    novel_id = client.post(
        "/api/novels",
        json={"title": "局部更新", "description": "原简介", "target_chapters": 120},
    ).json()["id"]

    client.put(f"/api/novels/{novel_id}", json={"cover_image": "cover"})

    stored = client.get(f"/api/novels/{novel_id}").json()
    assert stored["description"] == "原简介"
    assert stored["target_chapters"] == 120


def test_update_novel_rejects_duplicate_title(client: TestClient) -> None:
    client.post("/api/novels", json={"title": "已被占用"})
    novel_id = client.post("/api/novels", json={"title": "另一本"}).json()["id"]

    response = client.put(f"/api/novels/{novel_id}", json={"title": "已被占用"})

    assert response.status_code == 409


def test_update_missing_novel_returns_404(client: TestClient) -> None:
    response = client.put("/api/novels/999", json={"description": "x"})

    assert response.status_code == 404
