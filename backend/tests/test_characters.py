from fastapi.testclient import TestClient


def test_create_and_list_characters(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "人物测试"}).json()["id"]

    response = client.post(
        f"/api/novels/{novel_id}/characters",
        json={
            "name": "主角",
            "level": "protagonist",
            "identity": "青年修士",
            "goals": "寻找父亲下落",
            "expected_start_chapter": 1,
            "expected_end_chapter": 20,
        },
    )

    assert response.status_code == 201
    assert response.json()["level"] == "protagonist"

    response = client.get(f"/api/novels/{novel_id}/characters")

    assert response.status_code == 200
    assert response.json()[0]["name"] == "主角"


def test_reject_duplicate_character_name(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "人物去重"}).json()["id"]
    client.post(f"/api/novels/{novel_id}/characters", json={"name": "主角"})

    response = client.post(f"/api/novels/{novel_id}/characters", json={"name": "主角"})

    assert response.status_code == 409


def test_update_character(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "人物更新"}).json()["id"]
    character = client.post(
        f"/api/novels/{novel_id}/characters",
        json={"name": "主角", "level": "protagonist"},
    ).json()

    response = client.put(
        f"/api/novels/{novel_id}/characters/{character['id']}",
        json={
            "name": "主角",
            "level": "protagonist",
            "identity": "青年修士",
            "goals": "找到失踪的父亲",
            "expected_start_chapter": 1,
            "expected_end_chapter": 24,
        },
    )

    assert response.status_code == 200
    assert response.json()["identity"] == "青年修士"
    assert response.json()["expected_end_chapter"] == 24
