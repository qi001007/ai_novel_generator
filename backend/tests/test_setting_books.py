"""The settings library books (伏笔 / 世界观) live in the file layer too (D-15).

Same contract as the four planning layers: the database owns the values, the
Markdown is a projection, and there is exactly one writer. These cover the parts
that are new to a book of records - a `?` key that the database fills in, and a
boolean bullet that must not come back as the string 否.
"""

from fastapi.testclient import TestClient

import pytest

from tests.planning_helpers import create_chapter


@pytest.fixture(autouse=True)
def _keep_tests_offline(monkeypatch) -> None:
    monkeypatch.setenv("NOVEL_LLM_API_KEY", "")


def seed(client: TestClient) -> int:
    return client.post("/api/novels", json={"title": "分册测试"}).json()["id"]


def doc(client: TestClient, novel_id: int, path: str) -> dict:
    response = client.get(f"/api/novels/{novel_id}/files/{path}")
    assert response.status_code == 200, response.text
    return response.json()


def put(client: TestClient, novel_id: int, path: str, text: str, actor: str = "human"):
    current = doc(client, novel_id, path)
    return client.put(
        f"/api/novels/{novel_id}/files/{path}",
        json={"text": text, "actor": actor, "base_revision": current["revision"]},
    )


FORE = "settings/foreshadow.md"
WORLD = "settings/worldview.md"

TWO_FORESHADOWS = """## 伏笔 ? 碑上缺名
- **埋设章**：1
- **预计收章**：7
- **已收章**：—
- **状态**：open
- **内容**：沈砚舟发现碑文里有一个名字被磨掉，磨痕是新的。

## 伏笔 ? 守碑人的脚印
- **埋设章**：2
- **预计收章**：—
- **已收章**：—
- **状态**：open
- **内容**：雪夜之后，碑前多出一串指向旧道的脚印。
"""


def test_an_empty_book_is_still_a_page(client: TestClient) -> None:
    novel_id = seed(client)
    body = doc(client, novel_id, FORE)
    assert body["kind"] == "foreshadow"
    assert body["layer"] == "设定"
    assert "## 伏笔" not in body["text"]
    assert doc(client, novel_id, WORLD)["kind"] == "worldview"


def test_the_tree_shows_both_books_next_to_the_four_layers(client: TestClient) -> None:
    novel_id = seed(client)
    paths = {item["path"] for item in client.get(f"/api/novels/{novel_id}/files").json()}
    assert {FORE, WORLD} <= paths


def test_a_question_mark_key_becomes_a_real_one(client: TestClient) -> None:
    novel_id = seed(client)
    base = doc(client, novel_id, FORE)["text"]
    written = put(client, novel_id, FORE, base + TWO_FORESHADOWS)
    assert written.status_code == 200, written.text
    text = doc(client, novel_id, FORE)["text"]
    assert "## 伏笔 1 碑上缺名" in text
    assert "## 伏笔 2 守碑人的脚印" in text
    # 未填的章号回到 None，而不是 0 或空串
    assert "- **预计收章**：—" in text


def test_reading_then_writing_the_same_text_changes_nothing(client: TestClient) -> None:
    novel_id = seed(client)
    put(client, novel_id, FORE, doc(client, novel_id, FORE)["text"] + TWO_FORESHADOWS)
    current = doc(client, novel_id, FORE)
    again = put(client, novel_id, FORE, current["text"])
    assert again.json()["changed"] == []
    assert doc(client, novel_id, FORE)["text"] == current["text"]


def test_a_flag_comes_back_typed_and_not_as_the_word_否(client: TestClient) -> None:
    novel_id = seed(client)
    base = doc(client, novel_id, WORLD)["text"]
    body = base + """## 设定 ? 星渊碑
- **类别**：地点
- **已确认**：是
- **来源章**：1
- **现况**：碑面每年星潮夜自亮
- **内容**：上古遗物，能记录失去名字的人。

## 设定 ? 观星阁阁律
- **类别**：制度
- **已确认**：否
- **来源章**：—
- **现况**：三律仍被遵守
- **内容**：不可逆转已定死亡。
"""
    assert put(client, novel_id, WORLD, body).status_code == 200
    rows = client.get(f"/api/novels/{novel_id}/settings").json()
    confirmed = {row["name"]: row["is_confirmed"] for row in rows}
    assert confirmed == {"星渊碑": True, "观星阁阁律": False}
    # source_chapter absent means None, not 0
    assert [row["source_chapter"] for row in rows if row["name"] == "观星阁阁律"] == [None]


def test_a_renamed_bullet_is_refused_before_any_write(client: TestClient) -> None:
    novel_id = seed(client)
    base = doc(client, novel_id, FORE)["text"] + TWO_FORESHADOWS
    broken = base.replace("- **埋设章**：1", "- **埋于**：1")
    response = put(client, novel_id, FORE, broken)
    assert response.status_code == 422
    assert "结构标识" in response.json()["detail"]
    # and the book is untouched
    assert "## 伏笔" not in doc(client, novel_id, FORE)["text"]


def test_ai_cannot_renumber_a_record(client: TestClient) -> None:
    novel_id = seed(client)
    put(client, novel_id, FORE, doc(client, novel_id, FORE)["text"] + TWO_FORESHADOWS)
    text = doc(client, novel_id, FORE)["text"]
    response = put(client, novel_id, FORE, text.replace("## 伏笔 1 ", "## 伏笔 9 "), actor="ai")
    assert response.status_code == 422
    assert "主键" in response.json()["detail"]


def test_ai_cannot_move_a_planted_chapter_but_can_rewrite_the_text(client: TestClient) -> None:
    novel_id = seed(client)
    put(client, novel_id, FORE, doc(client, novel_id, FORE)["text"] + TWO_FORESHADOWS)
    text = doc(client, novel_id, FORE)["text"]

    moved = put(client, novel_id, FORE, text.replace("- **埋设章**：1", "- **埋设章**：4"), actor="ai")
    assert moved.status_code == 422
    assert "planted_chapter" in moved.json()["detail"]

    edited = put(client, novel_id, FORE, text.replace("磨痕是新的", "磨痕仍是新的"), actor="ai")
    assert edited.status_code == 200, edited.text
    assert edited.json()["changed"] == ["1.content"]


def test_a_new_foreshadow_reaches_the_injection_pool(client: TestClient) -> None:
    """U4 gap 4: the 伏笔 slot used to be permanently empty because nothing could write it."""
    novel_id = seed(client)
    put(client, novel_id, FORE, doc(client, novel_id, FORE)["text"] + TWO_FORESHADOWS)
    items = client.get(f"/api/novels/{novel_id}/chat/context", params={"kind": "foreshadow"}).json()
    assert [item["label"] for item in items] == ["伏笔 · 碑上缺名", "伏笔 · 守碑人的脚印"]
