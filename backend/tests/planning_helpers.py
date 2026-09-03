from fastapi.testclient import TestClient

from app.services.markdown_doc import render


def write_document(
    client: TestClient,
    novel_id: int,
    path: str,
    kind: str,
    payload,
    *,
    chapter: int | None = None,
    actor: str = "human",
):
    current = client.get(f"/api/novels/{novel_id}/files/{path}").json()
    response = client.put(
        f"/api/novels/{novel_id}/files/{path}",
        json={
            "text": render(kind, payload, chapter=chapter),
            "actor": actor,
            "base_revision": current.get("revision"),
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def create_toc(client: TestClient, novel_id: int, **payload):
    values = {"chapter": payload.pop("chapter_number"), "title": "", "plot_function": "", "notes": "", **payload}
    current = client.get(f"/api/novels/{novel_id}/files/toc.md").json()
    return client.put(
        f"/api/novels/{novel_id}/files/toc.md",
        json={"text": current["text"] + render("toc", [values]), "actor": "human", "base_revision": current["revision"]},
    )


def create_arc(client: TestClient, novel_id: int, **payload):
    values = {
        "arc": None,
        "title": "",
        "start_chapter": 1,
        "end_chapter": 2,
        "objective": "",
        "conflict": "",
        "resolution": "",
        "status": "planned",
        **payload,
    }
    current = client.get(f"/api/novels/{novel_id}/files/arcs.md").json()
    return client.put(
        f"/api/novels/{novel_id}/files/arcs.md",
        json={"text": current["text"] + render("arcs", [values]), "actor": "human", "base_revision": current["revision"]},
    )


def create_brief(client: TestClient, novel_id: int, chapter_number: int, **payload):
    values = {
        "chapter": chapter_number,
        "arc": None,
        "goal": "",
        "events": "",
        "pov": "",
        "characters": [],
        "conflict": "",
        "hook": "",
        "required_facts": [],
        "status": "draft",
        **payload,
    }
    write_document(client, novel_id, f"chapters/{chapter_number:04d}/brief.md", "brief", values, chapter=chapter_number)
    return client.get(f"/api/novels/{novel_id}/planning/briefs").json()[-1]


def create_chapter(
    client: TestClient,
    novel_id: int,
    *,
    chapter_number: int = 1,
    content: str = "",
    status: str = "draft",
) -> dict:
    """Create a chapter through the file layer for API tests."""
    create_brief(client, novel_id, chapter_number=chapter_number)
    chapter = next(
        item
        for item in client.get(f"/api/novels/{novel_id}/chapters").json()
        if item["chapter_number"] == chapter_number
    )
    if content:
        path = f"chapters/{chapter_number:04d}/draft.md"
        current = client.get(f"/api/novels/{novel_id}/files/{path}").json()
        saved = client.put(
            f"/api/novels/{novel_id}/files/{path}",
            json={
                "text": current["text"] + content,
                "base_revision": current["revision"],
            },
        )
        assert saved.status_code == 200, saved.text
        chapter = next(
            item
            for item in client.get(f"/api/novels/{novel_id}/chapters").json()
            if item["chapter_number"] == chapter_number
        )
    if status != "draft":
        reviewed = client.post(
            f"/api/novels/{novel_id}/chapters/{chapter['id']}/final-review",
            json={"decision": "accept" if status == "final" else "reject"},
        )
        assert reviewed.status_code == 201, reviewed.text
        chapter = next(
            item
            for item in client.get(f"/api/novels/{novel_id}/chapters").json()
            if item["chapter_number"] == chapter_number
        )
    return chapter


def _character_by_id(client, novel_id: int, character_id: int) -> dict:
    """There is no single-character GET route, so read it back from the list."""
    rows = client.get(f"/api/novels/{novel_id}/characters").json()
    return next(row for row in rows if row["id"] == character_id)


def character_doc(
    name: str = "",
    level: str = "",
    identity: str = "",
    goals: str = "",
    behavior_constraints: str = "",
    current_status: str = "",
    start: int | None = None,
    end: int | None = None,
) -> str:
    """Build the Markdown the server projects for a character file."""
    dash = "\u2014"

    def num(value: int | None) -> str:
        return dash if value is None else str(value)

    def section(title: str, body: str) -> list[str]:
        return ["", "## " + title, ""] + ([body] if body else [""])

    lines = [
        "# " + (name or "新人物") + "（设定库 · 人物）",
        "",
        "> 文件名人物号即主键：改名不换路径。小节标题与字段名是结构标识，不可增删改名。",
        "",
        "- **姓名**：" + (name or dash),
        "- **分级**：" + (level or dash),
        "- **起始章**：" + num(start),
        "- **结束章**：" + num(end),
    ]
    lines += section("身份", identity)
    lines += section("目标", goals)
    lines += section("行为约束", behavior_constraints)
    lines += section("当前状态", current_status)
    return "\n".join(lines) + "\n"


def create_character(client, novel_id: int, **fields) -> dict:
    """Create through the one file-layer entry point and return the stored row."""
    result = client.put(
        f"/api/novels/{novel_id}/files/settings/characters/new.md",
        json={"text": character_doc(**fields), "actor": "human"},
    )
    assert result.status_code == 200, result.text
    path = result.json()["path"]
    character_id = int(path.rsplit("/", 1)[-1].split(".")[0])
    return _character_by_id(client, novel_id, character_id)


def write_character(client, novel_id: int, character_id: int, **fields) -> dict:
    result = client.put(
        f"/api/novels/{novel_id}/files/settings/characters/{character_id}.md",
        json={"text": character_doc(**fields), "actor": "human"},
    )
    assert result.status_code == 200, result.text
    return _character_by_id(client, novel_id, character_id)
