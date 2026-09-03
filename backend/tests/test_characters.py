"""Characters are written through the document layer (DECISIONS D-15).

The legacy POST/PUT /characters endpoints are retired, so every test here creates and
edits a person the same way the UI now does: one PUT against the projected file.
"""

from fastapi.testclient import TestClient

from tests.planning_helpers import character_doc, create_character, write_character


def new_novel(client: TestClient, title: str) -> int:
    return client.post("/api/novels", json={"title": title}).json()["id"]


def test_create_and_list_characters(client: TestClient) -> None:
    novel_id = new_novel(client, "人物测试")

    created = create_character(
        client,
        novel_id,
        name="主角",
        level="protagonist",
        identity="青年修士",
        goals="寻找父亲下落",
        start=1,
        end=20,
    )

    assert created["level"] == "protagonist"
    assert created["identity"] == "青年修士"
    assert created["expected_end_chapter"] == 20
    rows = client.get(f"/api/novels/{novel_id}/characters").json()
    assert [row["name"] for row in rows] == ["主角"]


def test_legacy_character_writers_are_retired(client: TestClient) -> None:
    novel_id = new_novel(client, "写口收口")
    person = create_character(client, novel_id, name="主角")

    created = client.post(f"/api/novels/{novel_id}/characters", json={"name": "另一个"})
    updated = client.put(
        f"/api/novels/{novel_id}/characters/{person['id']}", json={"name": "改名"}
    )

    assert created.status_code == 410
    assert updated.status_code == 410
    assert "files/settings/characters" in updated.json()["detail"]


def test_reject_duplicate_character_name(client: TestClient) -> None:
    novel_id = new_novel(client, "人物去重")
    first = create_character(client, novel_id, name="主角")

    dup = client.put(
        f"/api/novels/{novel_id}/files/settings/characters/new.md",
        json={"text": character_doc(name="主角"), "actor": "human"},
    )

    assert dup.status_code == 409
    assert f"settings/characters/{first['id']}.md" in dup.json()["detail"]


def test_update_character(client: TestClient) -> None:
    novel_id = new_novel(client, "人物更新")
    person = create_character(client, novel_id, name="主角", level="protagonist")

    updated = write_character(
        client,
        novel_id,
        person["id"],
        name="主角",
        level="protagonist",
        identity="青年修士",
        goals="找到失踪的父亲",
        start=1,
        end=24,
    )

    assert updated["identity"] == "青年修士"
    assert updated["expected_end_chapter"] == 24


def test_character_portrait_round_trip(client: TestClient) -> None:
    novel_id = new_novel(client, "肖像测试")
    person = create_character(client, novel_id, name="沈砚")
    url = f"/api/novels/{novel_id}/characters/{person['id']}/portrait"

    set_url = client.put(url, json={"portrait": "data:image/png;base64,iVBORw0KGgo="})
    assert set_url.status_code == 200
    assert set_url.json()["portrait"] == "data:image/png;base64,iVBORw0KGgo="

    cleared = client.put(url, json={"portrait": ""})
    assert cleared.status_code == 200
    assert cleared.json()["portrait"] == ""


def test_character_portrait_defaults_to_empty(client: TestClient) -> None:
    novel_id = new_novel(client, "默认肖像")
    person = create_character(client, novel_id, name="路人甲")

    assert person["portrait"] == ""
