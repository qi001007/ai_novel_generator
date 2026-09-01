import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _keep_tests_offline(monkeypatch) -> None:
    monkeypatch.setenv("NOVEL_LLM_API_KEY", "")


def seed_novel(client: TestClient, title: str = "文档层") -> int:
    novel_id = client.post("/api/novels", json={"title": title}).json()["id"]
    client.post(
        f"/api/novels/{novel_id}/planning/toc",
        json={"chapter_number": 42, "title": "星渊碑影", "plot_function": "揭示碑的来历", "notes": "两\n行"},
    )
    client.post(
        f"/api/novels/{novel_id}/planning/arcs",
        json={"title": "卷一", "start_chapter": 10, "end_chapter": 60, "objective": "立起目标"},
    )
    client.post(
        f"/api/novels/{novel_id}/planning/briefs",
        json={"chapter_number": 42, "goal": "揭开星渊碑", "pov": "沈曜", "characters": ["沈曜"]},
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
        "blueprint.yaml",
        "toc.yaml",
        "arcs.yaml",
        "briefs/0042.yaml",
    ]
    assert [item["layer"] for item in files] == ["A", "B", "C", "D"]


def test_documents_render_as_readable_yaml(client: TestClient) -> None:
    novel_id = seed_novel(client)

    toc = read(client, novel_id, "toc.yaml")["text"]
    assert "- chapter: 42" in toc
    assert "title: 星渊碑影" in toc
    # Multi-line values stay as block scalars instead of escaped one-liners.
    assert "notes: |-" in toc and "两" in toc

    brief = read(client, novel_id, "briefs/0042.yaml")
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
    assert "characters: [沈曜]" in brief["text"]


def test_human_edit_writes_back_to_the_database(client: TestClient) -> None:
    novel_id = seed_novel(client)
    doc = read(client, novel_id, "blueprint.yaml")

    response = write(
        client,
        novel_id,
        "blueprint.yaml",
        doc["text"].replace("main_line: ''", "main_line: 沈曜要解开碑名之谜"),
    )

    assert response.status_code == 200
    assert response.json()["changed"] == ["main_line"]
    blueprint = client.get(f"/api/novels/{novel_id}/planning/blueprints").json()[0]
    assert blueprint["main_line"] == "沈曜要解开碑名之谜"
    assert "沈曜要解开碑名之谜" in read(client, novel_id, "blueprint.yaml")["text"]


def test_ai_may_change_values_but_never_structure(client: TestClient) -> None:
    novel_id = seed_novel(client)
    path = "briefs/0042.yaml"
    doc = read(client, novel_id, path)

    allowed = write(client, novel_id, path, doc["text"].replace("goal: 揭开星渊碑", "goal: 碑名会吃人"), actor="ai")
    assert allowed.status_code == 200
    assert allowed.json()["changed"] == ["goal"]

    for label, text in [
        ("identity", doc["text"].replace("chapter: 42", "chapter: 43")),
        ("renamed key", doc["text"].replace("goal:", "goals:")),
        ("dropped key", "\n".join(line for line in doc["text"].splitlines() if not line.startswith("hook:"))),
        ("arc link", doc["text"].replace("arc: null", "arc: 7")),
    ]:
        refused = write(client, novel_id, path, text, actor="ai")
        assert refused.status_code == 422, (label, refused.text)

    assert read(client, novel_id, path)["text"] == doc["text"].replace(
        "goal: 揭开星渊碑", "goal: 碑名会吃人"
    )


def test_ai_cannot_add_or_remove_rows(client: TestClient) -> None:
    novel_id = seed_novel(client)
    doc = read(client, novel_id, "toc.yaml")
    appended = doc["text"] + "- chapter: 43\n  title: 新章\n  plot_function: ''\n  notes: ''\n"

    assert write(client, novel_id, "toc.yaml", appended, actor="ai").status_code == 422

    human = write(client, novel_id, "toc.yaml", appended, actor="human")
    assert human.status_code == 200
    assert human.json()["changed"] == ["43.created", "43.title"]
    rows = client.get(f"/api/novels/{novel_id}/planning/toc").json()
    assert [row["chapter_number"] for row in rows] == [42, 43]


def test_ai_may_not_move_arc_bounds_but_may_rewrite_prose(client: TestClient) -> None:
    novel_id = seed_novel(client)
    doc = read(client, novel_id, "arcs.yaml")

    moved = write(client, novel_id, "arcs.yaml", doc["text"].replace("start_chapter: 10", "start_chapter: 12"), actor="ai")
    assert moved.status_code == 422

    retitled = write(client, novel_id, "arcs.yaml", doc["text"].replace("title: 卷一", "title: 卷一·观星"), actor="ai")
    assert retitled.status_code == 200
    assert retitled.json()["changed"] == ["1.title"]


def test_broken_yaml_is_reported_with_a_line(client: TestClient) -> None:
    novel_id = seed_novel(client)
    doc = read(client, novel_id, "blueprint.yaml")

    refused = write(client, novel_id, "blueprint.yaml", doc["text"] + "themes: [unclosed\n")

    assert refused.status_code == 422
    assert "YAML" in refused.json()["detail"]


def test_stale_base_revision_conflicts(client: TestClient) -> None:
    novel_id = seed_novel(client)
    doc = read(client, novel_id, "blueprint.yaml")
    write(client, novel_id, "blueprint.yaml", doc["text"].replace("ending: ''", "ending: 碑归碑"), actor="ai")

    stale = write(
        client,
        novel_id,
        "blueprint.yaml",
        doc["text"].replace("themes: ''", "themes: 名字即存在"),
        actor="ai",
        base_revision=doc["revision"],
    )

    assert stale.status_code == 409


def test_writing_a_new_brief_file_creates_it(client: TestClient) -> None:
    novel_id = seed_novel(client)
    text = (
        "chapter: 7\n"
        "arc: null\n"
        "goal: 主角入观星台\n"
        "events: ''\n"
        "pov: 沈曜\n"
        "characters: [沈曜]\n"
        "conflict: ''\n"
        "hook: ''\n"
        "required_facts: []\n"
        "status: draft\n"
    )

    created = write(client, novel_id, "briefs/0007.yaml", text)

    assert created.status_code == 200
    briefs = client.get(f"/api/novels/{novel_id}/planning/briefs").json()
    assert {item["chapter_number"] for item in briefs} == {42, 7}
    assert "briefs/0007.yaml" in [item["path"] for item in client.get(f"/api/novels/{novel_id}/files").json()]


@pytest.mark.parametrize(
    "path",
    ["notes.txt", "briefs/0007.yml", "briefs/../novel.yaml", "%2e%2e/secrets.yaml"],
)
def test_unknown_paths_are_not_served(client: TestClient, path: str) -> None:
    novel_id = seed_novel(client)

    assert client.get(f"/api/novels/{novel_id}/files/{path}").status_code == 404


def test_documents_require_an_existing_novel(client: TestClient) -> None:
    assert client.get("/api/novels/999/files").status_code == 404
    assert client.get("/api/novels/999/files/toc.yaml").status_code == 404
