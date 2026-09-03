"""The four planning layers projected onto editable Markdown documents."""

import pytest
from fastapi.testclient import TestClient

from tests.planning_helpers import create_arc, create_brief, create_toc


@pytest.fixture(autouse=True)
def _keep_tests_offline(monkeypatch) -> None:
    monkeypatch.setenv("NOVEL_LLM_API_KEY", "")


def seed_novel(client: TestClient, title: str = "文档层") -> int:
    novel_id = client.post("/api/novels", json={"title": title}).json()["id"]
    create_toc(
        client,
        novel_id,
        chapter_number=42,
        title="星渊碑影",
        plot_function="揭示碑的来历",
        notes="两\n行",
    )
    create_arc(
        client,
        novel_id,
        title="卷一",
        start_chapter=10,
        end_chapter=60,
        objective="立起目标",
    )
    create_brief(
        client,
        novel_id,
        chapter_number=42,
        goal="揭开星渊碑",
        pov="沈曜",
        characters=["沈曜"],
    )
    return novel_id


def read(client: TestClient, novel_id: int, path: str) -> dict:
    response = client.get(f"/api/novels/{novel_id}/files/{path}")
    assert response.status_code == 200, response.text
    return response.json()


def write(client: TestClient, novel_id: int, path: str, text: str, **kwargs):
    return client.put(
        f"/api/novels/{novel_id}/files/{path}",
        json={"text": text, **kwargs},
    )


def test_file_tree_lists_the_planning_layers(client: TestClient) -> None:
    novel_id = seed_novel(client)

    files = client.get(f"/api/novels/{novel_id}/files").json()

    assert [item["path"] for item in files] == [
        "blueprint.md",
        "toc.md",
        "arcs.md",
        "chapters/0042/draft.md",
        "chapters/0042/brief.md",
    ]
    assert [item["layer"] for item in files] == ["A", "B", "C", "正文", "D"]


def test_documents_render_as_markdown(client: TestClient) -> None:
    novel_id = seed_novel(client)

    toc = read(client, novel_id, "toc.md")["text"]
    assert "## 第 42 章 星渊碑影" in toc
    assert "- **剧情功能**：揭示碑的来历" in toc
    # A multi-line value stays readable: the tail hangs under its own bullet.
    assert "- **备注**：两\n  行" in toc

    brief = read(client, novel_id, "chapters/0042/brief.md")
    assert brief["ai_fields"] == [
        "goal",
        "events",
        "pov",
        "characters",
        "conflict",
        "hook",
        "required_facts",
        "status",
    ]
    assert "- **出场人物**：\n  - 沈曜" in brief["text"]
    assert "## 目标\n揭开星渊碑" in brief["text"]


def test_rendering_a_document_untouched_writes_nothing(client: TestClient) -> None:
    """The round trip is the proof that structure survived the format change."""
    novel_id = seed_novel(client)

    for path in ("blueprint.md", "toc.md", "arcs.md", "chapters/0042/brief.md"):
        doc = read(client, novel_id, path)
        again = write(client, novel_id, path, doc["text"], actor="human")
        assert again.status_code == 200, (path, again.text)
        assert again.json()["changed"] == [], path
        assert again.json()["revision"] == doc["revision"], path
        assert read(client, novel_id, path)["text"] == doc["text"], path


def test_human_edit_writes_back_to_the_database(client: TestClient) -> None:
    novel_id = seed_novel(client)
    doc = read(client, novel_id, "blueprint.md")

    response = write(
        client,
        novel_id,
        "blueprint.md",
        doc["text"].replace("## 主线\n\n", "## 主线\n沈曜要解开碑名之谜\n\n", 1),
    )

    assert response.status_code == 200
    assert response.json()["changed"] == ["main_line"]
    blueprint = client.get(f"/api/novels/{novel_id}/planning/blueprints").json()[0]
    assert blueprint["main_line"] == "沈曜要解开碑名之谜"
    assert "沈曜要解开碑名之谜" in read(client, novel_id, "blueprint.md")["text"]


def test_ai_may_change_values_but_never_structure(client: TestClient) -> None:
    novel_id = seed_novel(client)
    path = "chapters/0042/brief.md"
    doc = read(client, novel_id, path)
    allowed_text = doc["text"].replace("## 目标\n揭开星渊碑", "## 目标\n碑名会吃人", 1)

    allowed = write(client, novel_id, path, allowed_text, actor="ai")
    assert allowed.status_code == 200
    assert allowed.json()["changed"] == ["goal"]

    for label, text in [
        ("primary key", doc["text"].replace("- **章节号**：42", "- **章节号**：43")),
        ("renamed heading", doc["text"].replace("## 钩子", "## 钩子改名")),
        ("renamed label", doc["text"].replace("- **状态**：", "- **当前状态**：")),
        ("dropped label", "\n".join(l for l in doc["text"].splitlines() if not l.startswith("- **状态**："))),
        ("arc link", doc["text"].replace("- **所属弧**：—", "- **所属弧**：7")),
    ]:
        refused = write(client, novel_id, path, text, actor="ai")
        assert refused.status_code == 422, (label, refused.text)

    assert read(client, novel_id, path)["text"] == allowed_text


def test_ai_cannot_add_or_remove_rows(client: TestClient) -> None:
    novel_id = seed_novel(client)
    doc = read(client, novel_id, "toc.md")
    appended = doc["text"] + "## 第 43 章 新章\n- **剧情功能**：\n- **备注**：\n"

    assert write(client, novel_id, "toc.md", appended, actor="ai").status_code == 422

    human = write(client, novel_id, "toc.md", appended, actor="human")
    assert human.status_code == 200
    assert human.json()["changed"] == ["43.created", "43.title"]
    rows = client.get(f"/api/novels/{novel_id}/planning/toc").json()
    assert [row["chapter_number"] for row in rows] == [42, 43]


def test_ai_may_not_move_arc_bounds_but_may_rewrite_prose(client: TestClient) -> None:
    novel_id = seed_novel(client)
    doc = read(client, novel_id, "arcs.md")
    arc = doc["text"].splitlines()[4]
    arc_id = arc.split("弧 ")[1].split(" ")[0]

    moved = write(
        client, novel_id, "arcs.md", doc["text"].replace("- **起始章**：10", "- **起始章**：12"), actor="ai"
    )
    assert moved.status_code == 422

    retitled = write(
        client, novel_id, "arcs.md", doc["text"].replace(f"{arc}\n", f"{arc}·观星\n"), actor="ai"
    )
    assert retitled.status_code == 200, retitled.text
    assert retitled.json()["changed"] == [f"{arc_id}.title"]


def test_broken_markdown_is_refused_before_any_write(client: TestClient) -> None:
    novel_id = seed_novel(client)
    doc = read(client, novel_id, "blueprint.md")

    refused = write(client, novel_id, "blueprint.md", doc["text"] + "## 我随手加的一节\n")

    assert refused.status_code == 422
    assert "结构标识" in refused.json()["detail"]


def test_a_list_section_rejects_prose(client: TestClient) -> None:
    novel_id = seed_novel(client)
    doc = read(client, novel_id, "chapters/0042/brief.md")

    accepted = write(
        client,
        novel_id,
        "chapters/0042/brief.md",
        doc["text"].replace("## 既定事实\n", "## 既定事实\n这是一段散文而不是条目\n"),
        actor="human",
    )
    assert accepted.status_code == 422
    assert "列表小节" in accepted.json()["detail"]


def test_stale_base_revision_conflicts(client: TestClient) -> None:
    novel_id = seed_novel(client)
    doc = read(client, novel_id, "blueprint.md")
    write(client, novel_id, "blueprint.md", doc["text"].replace("## 终局\n\n", "## 终局\n碑归碑\n\n", 1), actor="ai")

    stale = write(
        client,
        novel_id,
        "blueprint.md",
        doc["text"].replace("## 主题\n\n", "## 主题\n名字即存在\n\n", 1),
        actor="ai",
        base_revision=doc["revision"],
    )

    assert stale.status_code == 409


def test_writing_a_new_brief_file_creates_it(client: TestClient) -> None:
    novel_id = seed_novel(client)
    text = (
        "# 第 7 章简报（D 层 · 单章简报）\n"
        "\n"
        "> 文件名章号即主键。这一页是 `/generate` 的输入，也进对话上下文。\n"
        "\n"
        "- **章节号**：7\n"
        "- **所属弧**：—\n"
        "- **视角**：沈曜\n"
        "- **出场人物**：\n"
        "  - 沈曜\n"
        "- **状态**：draft\n"
        "\n"
        "## 目标\n"
        "主角入观星台\n"
        "\n"
        "## 事件\n"
        "\n"
        "## 冲突\n"
        "\n"
        "## 钩子\n"
        "\n"
        "## 既定事实\n"
    )

    created = write(client, novel_id, "briefs/0007.md", text)

    assert created.status_code == 200, created.text
    briefs = client.get(f"/api/novels/{novel_id}/planning/briefs").json()
    assert {item["chapter_number"] for item in briefs} == {42, 7}
    assert "chapters/0007/brief.md" in [item["path"] for item in client.get(f"/api/novels/{novel_id}/files").json()]


def test_new_brief_append_creates_the_chapter_atomically(client: TestClient) -> None:
    novel_id = seed_novel(client, "原子追加")
    path = "chapters/0008/brief.md"
    doc = read(client, novel_id, path)

    created = write(client, novel_id, path, doc["text"])

    assert created.status_code == 200, created.text
    assert created.json()["path"] == path
    briefs = client.get(f"/api/novels/{novel_id}/planning/briefs").json()
    assert next(item["chapter_number"] for item in briefs if item["chapter_number"] == 8) == 8
    chapters = client.get(f"/api/novels/{novel_id}/chapters").json()
    assert [chapter["chapter_number"] for chapter in chapters] == [8, 42]
    assert chapters[0]["brief_id"] == next(item["id"] for item in briefs if item["chapter_number"] == 8)


def test_draft_file_projects_and_writes_chapter_prose(client: TestClient) -> None:
    novel_id = seed_novel(client, "正文投影")
    doc = read(client, novel_id, "chapters/0042/draft.md")

    edited = doc["text"] + "沈曜推开了石门。\n"
    saved = write(client, novel_id, "chapters/0042/draft.md", edited)

    assert saved.status_code == 200, saved.text
    assert saved.json()["changed"] == ["content"]
    chapter = client.get(f"/api/novels/{novel_id}/chapters").json()[0]
    assert chapter["content"].endswith("沈曜推开了石门。\n")
    assert chapter["word_count"] == len(chapter["content"])
    projected = read(client, novel_id, "chapters/0042/draft.md")["text"]
    assert projected.startswith("# 第 42 章正文")
    assert projected.endswith("沈曜推开了石门。\n")


@pytest.mark.parametrize(
    "path",
    ["notes.txt", "briefs/0007.yml", "briefs/0007.yaml", "briefs/../novel.md", "%2e%2e/secrets.md"],
)
def test_unknown_paths_are_not_served(client: TestClient, path: str) -> None:
    novel_id = seed_novel(client)

    assert client.get(f"/api/novels/{novel_id}/files/{path}").status_code == 404


def test_documents_require_an_existing_novel(client: TestClient) -> None:
    assert client.get("/api/novels/999/files").status_code == 404
    assert client.get("/api/novels/999/files/toc.md").status_code == 404
