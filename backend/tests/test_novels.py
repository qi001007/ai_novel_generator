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
