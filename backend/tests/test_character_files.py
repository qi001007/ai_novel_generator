"""D-13: the settings library (characters) is written through the file layer."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _keep_tests_offline(monkeypatch) -> None:
    monkeypatch.setenv("NOVEL_LLM_API_KEY", "")


def seed_character(client: TestClient) -> tuple[int, int]:
    novel_id = client.post("/api/novels", json={"title": "设定库"}).json()["id"]
    created = client.post(
        f"/api/novels/{novel_id}/characters",
        json={
            "name": "陈默",
            "level": "protagonist",
            "identity": "守碑人后裔",
            "goals": "查清父亲失踪",
            "behavior_constraints": "不主动伤无辜",
            "current_status": "左眼失明",
            "expected_start_chapter": 1,
            "expected_end_chapter": 42,
        },
    )
    assert created.status_code == 201
    return novel_id, created.json()["id"]


def test_character_appears_as_a_projected_file(client: TestClient) -> None:
    novel_id, cid = seed_character(client)
    files = client.get(f"/api/novels/{novel_id}/files").json()
    entry = next(f for f in files if f["path"] == f"settings/characters/{cid}.md")
    assert entry["kind"] == "character"
    assert entry["layer"] == "设定"
    assert entry["label"] == "陈默 档案"


def test_character_file_round_trips_without_drift(client: TestClient) -> None:
    novel_id, cid = seed_character(client)
    path = f"settings/characters/{cid}.md"
    doc = client.get(f"/api/novels/{novel_id}/files/{path}").json()
    text = doc["text"]
    for fragment in ("- **姓名**：陈默", "- **分级**：protagonist", "- **起始章**：1",
                     "- **结束章**：42", "## 身份", "守碑人后裔", "## 当前状态", "左眼失明"):
        assert fragment in text, fragment
    # Re-writing what the projection just produced must be a no-op.
    again = client.put(f"/api/novels/{novel_id}/files/{path}", json={"text": text, "actor": "human"})
    assert again.status_code == 200, again.text
    assert again.json()["changed"] == []


def test_character_file_edit_lands_in_the_database(client: TestClient) -> None:
    novel_id, cid = seed_character(client)
    path = f"settings/characters/{cid}.md"
    text = client.get(f"/api/novels/{novel_id}/files/{path}").json()["text"]
    edited = text.replace("守碑人后裔", "守碑人后裔，典当行学徒出身。").replace(
        "- **结束章**：42", "- **结束章**：60"
    )
    result = client.put(f"/api/novels/{novel_id}/files/{path}", json={"text": edited, "actor": "human"})
    assert result.status_code == 200, result.text
    assert set(result.json()["changed"]) == {"identity", "expected_end_chapter"}
    row = next(c for c in client.get(f"/api/novels/{novel_id}/characters").json() if c["id"] == cid)
    assert row["identity"] == "守碑人后裔，典当行学徒出身。"
    assert row["expected_end_chapter"] == 60


def test_new_character_is_created_through_the_same_entry(client: TestClient) -> None:
    novel_id, _ = seed_character(client)
    body = "\n".join([
        "# 苏黎（设定库 · 人物）", "",
        "> 文件名人物号即主键：改名不换路径。小节标题与字段名是结构标识，不可增删改名。", "",
        "- **姓名**：苏黎", "- **分级**：supporting", "- **起始章**：3", "- **结束章**：—", "",
        "## 身份", "", "碑下向导。", "", "## 目标", "", "守住碑。", "",
        "## 行为约束", "", "不说谎。", "", "## 当前状态", "", "在第 3 章登场。", "",
    ])
    result = client.put(
        f"/api/novels/{novel_id}/files/settings/characters/new.md",
        json={"text": body, "actor": "human"},
    )
    assert result.status_code == 200, result.text
    created = [c for c in client.get(f"/api/novels/{novel_id}/characters").json() if c["name"] == "苏黎"]
    assert len(created) == 1
    person = created[0]
    assert person["identity"] == "碑下向导。"
    assert person["expected_start_chapter"] == 3
    assert person["expected_end_chapter"] is None
    # The result reports the numeric path, and the file is readable at it.
    assert result.json()["path"] == f"settings/characters/{person['id']}.md"
    assert client.get(f"/api/novels/{novel_id}/files/{result.json()['path']}").status_code == 200


def test_duplicate_name_is_rejected_with_the_owning_path(client: TestClient) -> None:
    novel_id, cid = seed_character(client)
    body = "\n".join([
        "# 陈默（设定库 · 人物）", "",
        "- **姓名**：陈默", "- **分级**：supporting", "- **起始章**：—", "- **结束章**：—", "",
        "## 身份", "", "x", "", "## 目标", "", "y", "", "## 行为约束", "", "z", "",
        "## 当前状态", "", "w", "",
    ])
    other = client.put(
        f"/api/novels/{novel_id}/files/settings/characters/new.md",
        json={"text": body, "actor": "human"},
    )
    assert other.status_code == 409
    assert f"settings/characters/{cid}.md" in other.json()["detail"]


def test_ai_actor_may_edit_prose_but_not_rename(client: TestClient) -> None:
    novel_id, cid = seed_character(client)
    path = f"settings/characters/{cid}.md"
    text = client.get(f"/api/novels/{novel_id}/files/{path}").json()["text"]
    allowed = client.put(
        f"/api/novels/{novel_id}/files/{path}",
        json={"text": text.replace("守碑人后裔", "碑守后裔"), "actor": "ai"},
    )
    assert allowed.status_code == 200, allowed.text
    assert "identity" in allowed.json()["changed"]
    renamed = client.put(
        f"/api/novels/{novel_id}/files/{path}",
        json={"text": text.replace("- **姓名**：陈默", "- **姓名**：改名了"), "actor": "ai"},
    )
    assert renamed.status_code >= 400
    assert "name" in renamed.json()["detail"]


def test_renamed_or_missing_section_is_rejected(client: TestClient) -> None:
    novel_id, cid = seed_character(client)
    path = f"settings/characters/{cid}.md"
    text = client.get(f"/api/novels/{novel_id}/files/{path}").json()["text"]
    for bad, why in ((text.replace("## 身份", "## 身份X"), "小节"), (text.replace("- **姓名**：陈默", ""), "姓名")):
        res = client.put(f"/api/novels/{novel_id}/files/{path}", json={"text": bad, "actor": "human"})
        assert res.status_code >= 400, (why, res.status_code, res.text)
        assert why in res.json()["detail"] or "结构标识" in res.json()["detail"]


def test_portrait_stays_out_of_the_document(client: TestClient) -> None:
    novel_id, cid = seed_character(client)
    blob = "data:image/png;base64," + "A" * 5000
    put = client.put(
        f"/api/novels/{novel_id}/characters/{cid}",
        json={
            "name": "陈默", "level": "protagonist", "portrait": blob,
            "identity": "守碑人后裔", "goals": "查清父亲失踪",
            "behavior_constraints": "不主动伤无辜", "current_status": "左眼失明",
            "expected_start_chapter": 1, "expected_end_chapter": 42,
        },
    )
    assert put.status_code == 200
    text = client.get(f"/api/novels/{novel_id}/files/settings/characters/{cid}.md").json()["text"]
    assert "base64" not in text and blob not in text
