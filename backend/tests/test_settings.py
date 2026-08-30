from fastapi.testclient import TestClient


def test_create_and_list_settings(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "设定测试"}).json()["id"]

    response = client.post(
        f"/api/novels/{novel_id}/settings",
        json={"category": "worldview", "name": "力量体系", "content": "以灵纹为核心。"},
    )

    assert response.status_code == 201
    assert response.json()["is_confirmed"] is False

    response = client.get(f"/api/novels/{novel_id}/settings")

    assert response.status_code == 200
    assert response.json()[0]["name"] == "力量体系"


def test_reject_duplicate_setting_name(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "设定去重"}).json()["id"]
    client.post(
        f"/api/novels/{novel_id}/settings",
        json={"category": "worldview", "name": "力量体系"},
    )

    response = client.post(
        f"/api/novels/{novel_id}/settings",
        json={"category": "worldview", "name": "力量体系"},
    )

    assert response.status_code == 409


def test_update_setting(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "设定更新"}).json()["id"]
    setting = client.post(
        f"/api/novels/{novel_id}/settings",
        json={"category": "worldview", "name": "力量体系"},
    ).json()

    response = client.put(
        f"/api/novels/{novel_id}/settings/{setting['id']}",
        json={
            "category": "worldview",
            "name": "力量体系",
            "content": "灵纹分为三阶。",
            "is_confirmed": True,
        },
    )

    assert response.status_code == 200
    assert response.json()["content"] == "灵纹分为三阶。"
    assert response.json()["is_confirmed"] is True
