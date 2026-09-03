from fastapi.testclient import TestClient

from app.services.markdown_doc import render
from tests.planning_helpers import create_chapter


AI_REVIEW_DIMENSIONS = [
    "consistency",
    "character_behavior",
    "pacing",
    "continuity",
    "foreshadowing",
    "hook",
    "style",
]


def complete_ai_review_payload(content: str) -> dict:
    return {
        "decision": "passed",
        "comments": "整体合格。",
        "scores": {dimension: 8 for dimension in AI_REVIEW_DIMENSIONS},
        "evidence": {dimension: [content] for dimension in AI_REVIEW_DIMENSIONS},
    }


def test_ai_review_requires_complete_seven_dimensions(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "自检测试"}).json()["id"]
    chapter = create_chapter(client, novel_id, content="主角推开院门。")
    payload = complete_ai_review_payload("主角推开院门。")
    payload["scores"].pop("continuity")

    response = client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/ai-review",
        json=payload,
    )

    assert response.status_code == 422
    assert "continuity" in response.json()["detail"]


def test_complete_ai_review_records_result(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "自检入库"}).json()["id"]
    chapter = create_chapter(client, novel_id, content="主角推开院门。")

    response = client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/ai-review",
        json=complete_ai_review_payload("主角推开院门。"),
    )

    assert response.status_code == 201
    assert response.json()["reviewer"] == "ai"
    assert set(response.json()["scores"]) == set(AI_REVIEW_DIMENSIONS)

    updated_chapter = client.get(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}"
    ).json()
    assert updated_chapter["status"] == "ai_reviewed"


def test_human_review_accepts_chapter(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "终审通过"}).json()["id"]
    chapter = create_chapter(client, novel_id, content="正文。")

    response = client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/final-review",
        json={"decision": "accept", "comments": "可以入库。"},
    )

    assert response.status_code == 201
    assert response.json()["reviewer"] == "human"

    updated_chapter = client.get(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}"
    ).json()
    assert updated_chapter["status"] == "final"
    assert updated_chapter["final_decision"] == "accept"


def test_human_review_edit_updates_content_and_finalizes(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "终审编辑"}).json()["id"]
    create_chapter(client, novel_id, content="旧正文。")
    new_content = "编辑后的终稿正文。"
    draft = client.get(f"/api/novels/{novel_id}/files/chapters/0001/draft.md").json()
    saved = client.put(
        f"/api/novels/{novel_id}/files/chapters/0001/draft.md",
        json={
            "text": render("draft", {"content": new_content}),
            "base_revision": draft["revision"],
        },
    )
    assert saved.status_code == 200, saved.text
    chapter = client.get(f"/api/novels/{novel_id}/chapters").json()[0]

    response = client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/final-review",
        json={"decision": "accept", "comments": "改了结尾。"},
    )

    assert response.status_code == 201

    updated_chapter = client.get(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}"
    ).json()
    assert updated_chapter["content"] == new_content
    assert updated_chapter["word_count"] == len(new_content)
    assert updated_chapter["status"] == "final"


def test_human_review_rejects_chapter(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "终审打回"}).json()["id"]
    chapter = create_chapter(client, novel_id, content="正文。")

    response = client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/final-review",
        json={"decision": "reject", "comments": "节奏不行。"},
    )

    assert response.status_code == 201

    updated_chapter = client.get(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}"
    ).json()
    assert updated_chapter["status"] == "draft"
