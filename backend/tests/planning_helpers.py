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
