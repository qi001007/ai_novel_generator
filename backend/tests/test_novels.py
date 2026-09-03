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


def test_bookshelf_cards_carry_real_totals(client: TestClient) -> None:
    """The shelf shows counts, so they must come from the database, not from the UI."""
    from tests.planning_helpers import create_chapter

    novel_id = client.post("/api/novels", json={"title": "书架聚合"}).json()["id"]
    create_chapter(client, novel_id, chapter_number=1, content="一" * 120)
    create_chapter(client, novel_id, chapter_number=2, content="二" * 80, status="final")

    card = next(n for n in client.get("/api/novels").json() if n["id"] == novel_id)
    assert card["chapter_count"] == 2
    assert card["total_words"] == 200
    assert card["done_count"] == 1
    assert card["last_edited_at"] is not None


def test_bookshelf_card_of_an_empty_novel_is_zero_not_missing(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "空白书架"}).json()["id"]

    card = next(n for n in client.get("/api/novels").json() if n["id"] == novel_id)
    assert (card["chapter_count"], card["done_count"], card["total_words"]) == (0, 0, 0)


def test_cover_color_round_trips_and_reaches_the_card(client: TestClient) -> None:
    created = client.post(
        "/api/novels", json={"title": "调色", "cover_color": "#2f6b57"}
    ).json()
    assert created["cover_color"] == "#2f6b57"

    card = next(n for n in client.get("/api/novels").json() if n["id"] == created["id"])
    assert card["cover_color"] == "#2f6b57"

    renamed = client.put(
        f"/api/novels/{created['id']}", json={"cover_color": "#7d2f3f"}
    ).json()
    assert renamed["cover_color"] == "#7d2f3f"


def test_cover_color_must_be_hex(client: TestClient) -> None:
    bad = client.post("/api/novels", json={"title": "坏颜色", "cover_color": "red"})
    assert bad.status_code == 422
    assert "rrggbb" in bad.json()["detail"]

    novel_id = client.post("/api/novels", json={"title": "坏颜色2"}).json()["id"]
    bad_update = client.put(f"/api/novels/{novel_id}", json={"cover_color": "#gggggg"})
    assert bad_update.status_code == 422


def test_cover_color_defaults_to_empty_meaning_workbench_accent(client: TestClient) -> None:
    created = client.post("/api/novels", json={"title": "默认色"}).json()
    assert created["cover_color"] == ""
