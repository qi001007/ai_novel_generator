"""D-13: the settings library (characters) is written through the file layer."""

import pytest
from fastapi.testclient import TestClient

from tests.planning_helpers import create_character


@pytest.fixture(autouse=True)
def _keep_tests_offline(monkeypatch) -> None:
    monkeypatch.setenv("NOVEL_LLM_API_KEY", "")


def seed_character(client: TestClient) -> tuple[int, int]:
    novel_id = client.post("/api/novels", json={"title": "设定库"}).json()["id"]
    person = create_character(
        client,
        novel_id,
        name="陈默",
        level="protagonist",
        identity="守碑人后裔",
        goals="查清父亲失踪",
        behavior_constraints="不主动伤无辜",
        current_status="左眼失明",
        start=1,
        end=42,
    )
    return novel_id, person["id"]


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


def test_the_invented_characters_alias_resolves_to_the_create_template(client: TestClient) -> None:
    """批注 35.5: 「没有这个文件：settings/characters.md」 must not come out of any entry."""
    novel_id, _ = seed_character(client)
    body = "\n".join([
        "# 苏黎（设定库 · 人物）", "",
        "- **姓名**：苏黎", "- **分级**：supporting", "- **起始章**：3", "- **结束章**：—", "",
        "## 身份", "", "碑下向导。", "", "## 目标", "", "守住碑。", "",
        "## 行为约束", "", "不说谎。", "", "## 当前状态", "", "在第 3 章登场。", "",
    ])
    for alias in ("settings/characters.md", "characters.md", "settings/characters"):
        read = client.get(f"/api/novels/{novel_id}/files/{alias}")
        assert read.status_code == 200, (alias, read.text)
        assert read.json()["path"] == "settings/characters/new.md"

    created = client.put(
        f"/api/novels/{novel_id}/files/settings/characters.md",
        json={"text": body, "actor": "ai"},
    )
    assert created.status_code == 200, created.text
    person = next(c for c in client.get(f"/api/novels/{novel_id}/characters").json() if c["name"] == "苏黎")
    assert created.json()["path"] == f"settings/characters/{person['id']}.md"


def test_an_applied_character_create_fence_is_not_offered_again(client: TestClient) -> None:
    """批注 35.5：应用过的「新建人物」围栏重读即改道收起，不再给一张只能 409 的卡。"""
    from app.services.chat import extract_proposals

    novel_id, _ = seed_character(client)
    body = "\n".join([
        "# 罗九（设定库 · 人物）", "",
        "- **姓名**：罗九", "- **分级**：supporting", "- **起始章**：—", "- **结束章**：—", "",
        "## 身份", "", "碑下向导。", "", "## 目标", "", "看清楚碑。", "",
        "## 行为约束", "", "不逾矩。", "", "## 当前状态", "", "在场。", "",
    ])
    applied = client.put(
        f"/api/novels/{novel_id}/files/settings/characters/new.md",
        json={"text": body, "actor": "ai"},
    )
    assert applied.status_code == 200, applied.text
    archive = f"/api/novels/{novel_id}/files/{applied.json()['path']}"
    on_file = client.get(archive).json()["text"]
    fence = f"```markdown @settings/characters/new.md\n{body}\n```"

    cards = extract_proposals(
        fence,
        lambda path: on_file if path == applied.json()["path"] else None,
        lambda name: applied.json()["path"] if name == "罗九" else None,
    )

    assert [card["path"] for card in cards] == [applied.json()["path"]], cards
    assert cards[0]["text"] == on_file, "改道之后与档上完全相同，卡片该还原成文件本身"

    edited = extract_proposals(
        fence.replace("看清楚碑。", "看清楚碑，替陈默守一夜。"),
        lambda path: on_file if path == applied.json()["path"] else None,
        lambda name: applied.json()["path"] if name == "罗九" else None,
    )
    assert edited[0]["valid"] is True, edited[0]["error"]
    assert edited[0]["text"] != on_file
    put = client.put(archive, json={"text": edited[0]["text"], "actor": "ai"})
    assert put.status_code == 200, put.text
    person = next(c for c in client.get(f"/api/novels/{novel_id}/characters").json() if c["name"] == "罗九")
    assert "替陈默守一夜" in person["goals"]


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
        f"/api/novels/{novel_id}/characters/{cid}/portrait",
        json={"portrait": blob},
    )
    assert put.status_code == 200
    text = client.get(f"/api/novels/{novel_id}/files/settings/characters/{cid}.md").json()["text"]
    assert "base64" not in text and blob not in text


# --- portrait asset endpoint (D-15: an asset, not prose) --------------------


def test_portrait_endpoint_writes_only_the_portrait(client: TestClient) -> None:
    novel_id, cid = seed_character(client)
    before = client.get(f"/api/novels/{novel_id}/characters").json()[0]

    res = client.put(
        f"/api/novels/{novel_id}/characters/{cid}/portrait",
        json={"portrait": "data:image/png;base64,iVBORw0KGgo="},
    )
    assert res.status_code == 200, res.text
    after = res.json()
    assert after["portrait"].startswith("data:image/png;base64,")
    # every text field is untouched, so the file layer stays the only content writer
    for field in ("name", "level", "identity", "goals", "behavior_constraints", "current_status"):
        assert after[field] == before[field], field

    text = client.get(f"/api/novels/{novel_id}/files/settings/characters/{cid}.md").json()["text"]
    assert "base64" not in text


def test_portrait_can_be_cleared(client: TestClient) -> None:
    novel_id, cid = seed_character(client)
    client.put(f"/api/novels/{novel_id}/characters/{cid}/portrait", json={"portrait": "data:image/png;base64,AA=="})
    res = client.put(f"/api/novels/{novel_id}/characters/{cid}/portrait", json={"portrait": ""})
    assert res.status_code == 200
    assert res.json()["portrait"] == ""


def test_portrait_rejects_non_image_payloads(client: TestClient) -> None:
    novel_id, cid = seed_character(client)
    bad = client.put(
        f"/api/novels/{novel_id}/characters/{cid}/portrait",
        json={"portrait": "https://evil.example/x.png"},
    )
    assert bad.status_code == 422
    big = client.put(
        f"/api/novels/{novel_id}/characters/{cid}/portrait",
        json={"portrait": "data:image/png;base64," + "A" * (3 * 1024 * 1024 + 8)},
    )
    assert big.status_code == 413


def test_portrait_of_unknown_character_is_404(client: TestClient) -> None:
    novel_id, _ = seed_character(client)
    res = client.put(f"/api/novels/{novel_id}/characters/9999/portrait", json={"portrait": ""})
    assert res.status_code == 404
