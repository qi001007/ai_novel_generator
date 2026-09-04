"""The worldview book is the only writer for the settings table (D-15).

These used to drive `POST/PUT /settings`. Those now answer 410, and the same
behaviour is asserted through the one file-layer entry point instead - including
the two things the JSON endpoints never checked: a key that cannot be renumbered,
and a flag that survives the round trip as a bool.
"""

import pytest
from fastapi.testclient import TestClient

from tests.planning_helpers import create_setting, setting_record, worldview_text, write_setting

WORLD = "settings/worldview.md"


@pytest.fixture(autouse=True)
def _keep_tests_offline(monkeypatch) -> None:
    monkeypatch.setenv("NOVEL_LLM_API_KEY", "")


def seed(client: TestClient) -> int:
    return client.post("/api/novels", json={"title": "设定测试"}).json()["id"]


def test_create_and_list_settings(client: TestClient) -> None:
    novel_id = seed(client)
    row = create_setting(client, novel_id, category="worldview", name="力量体系", content="以灵纹为核心。")

    assert row["is_confirmed"] is False
    listed = client.get(f"/api/novels/{novel_id}/settings").json()
    assert [item["name"] for item in listed] == ["力量体系"]


def test_the_json_writers_are_retired(client: TestClient) -> None:
    novel_id = seed(client)
    created = create_setting(client, novel_id, category="worldview", name="力量体系")
    assert client.post(f"/api/novels/{novel_id}/settings", json={"category": "a", "name": "b"}).status_code == 410
    response = client.put(f"/api/novels/{novel_id}/settings/{created['id']}", json={"category": "a", "name": "b"})
    assert response.status_code == 410
    # and the message says where to write instead
    assert WORLD in response.json()["detail"]


def test_update_setting(client: TestClient) -> None:
    novel_id = seed(client)
    row = create_setting(client, novel_id, category="worldview", name="力量体系")
    updated = write_setting(client, novel_id, row["id"], name="力量体系", content="灵纹分为三阶。", is_confirmed=True)

    assert updated["content"] == "灵纹分为三阶。"
    assert updated["is_confirmed"] is True


def test_a_key_cannot_be_renumbered(client: TestClient) -> None:
    """`设定 N` is the primary key: editing the number is not how you move a record."""
    novel_id = seed(client)
    create_setting(client, novel_id, category="worldview", name="力量体系")
    current = worldview_text(client, novel_id)
    broken = current["text"].replace("## 设定 1 ", "## 设定 9 ")
    response = client.put(
        f"/api/novels/{novel_id}/files/{WORLD}",
        json={"text": broken, "actor": "human", "base_revision": current["revision"]},
    )
    assert response.status_code == 422
    assert "不存在" in response.json()["detail"]


def test_an_empty_book_round_trips(client: TestClient) -> None:
    novel_id = seed(client)
    current = worldview_text(client, novel_id)
    assert current["kind"] == "worldview"
    assert current["ai_fields"] == ["category", "current_state", "content"]

    body = current["text"].rstrip("\n") + "\n\n" + setting_record(name="星渊碑", category="地点", is_confirmed=True)
    written = client.put(
        f"/api/novels/{novel_id}/files/{WORLD}",
        json={"text": body, "actor": "human", "base_revision": current["revision"]},
    )
    assert written.status_code == 200, written.text
    again = worldview_text(client, novel_id)
    assert "## 设定 1 星渊碑" in again["text"]
    assert "- **已确认**：是" in again["text"]
    # writing the projection back changes nothing: the document is already canonical
    stable = client.put(
        f"/api/novels/{novel_id}/files/{WORLD}",
        json={"text": again["text"], "actor": "human", "base_revision": again["revision"]},
    )
    assert stable.json()["changed"] == []
