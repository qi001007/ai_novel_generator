from fastapi.testclient import TestClient


def test_create_and_list_planning_layers(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "测试规划"}).json()["id"]

    blueprint_response = client.post(
        f"/api/novels/{novel_id}/planning/blueprints",
        json={"main_line": "找到失落之城"},
    )
    toc_response = client.post(
        f"/api/novels/{novel_id}/planning/toc",
        json={"chapter_number": 1, "title": "出发"},
    )
    arc_response = client.post(
        f"/api/novels/{novel_id}/planning/arcs",
        json={"start_chapter": 1, "end_chapter": 12, "objective": "离开故乡"},
    )
    brief_response = client.post(
        f"/api/novels/{novel_id}/planning/briefs",
        json={"chapter_number": 1, "goal": "介绍主角", "characters": ["主角"]},
    )

    assert blueprint_response.status_code == 201
    assert toc_response.status_code == 201
    assert arc_response.status_code == 201
    assert brief_response.status_code == 201

    assert client.get(f"/api/novels/{novel_id}/planning/blueprints").json()
    assert client.get(f"/api/novels/{novel_id}/planning/toc").json()[0]["title"] == "出发"
    assert client.get(f"/api/novels/{novel_id}/planning/arcs").json()[0]["objective"] == "离开故乡"
    assert client.get(f"/api/novels/{novel_id}/planning/briefs").json()[0]["characters"] == ["主角"]


def test_reject_duplicate_chapter_numbers(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "测试去重"}).json()["id"]
    client.post(f"/api/novels/{novel_id}/planning/toc", json={"chapter_number": 1})
    client.post(f"/api/novels/{novel_id}/planning/briefs", json={"chapter_number": 1})

    assert client.post(f"/api/novels/{novel_id}/planning/toc", json={"chapter_number": 1}).status_code == 409
    assert client.post(f"/api/novels/{novel_id}/planning/briefs", json={"chapter_number": 1}).status_code == 409
