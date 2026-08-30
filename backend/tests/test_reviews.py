from fastapi.testclient import TestClient


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
    chapter = client.post(
        f"/api/novels/{novel_id}/chapters",
        json={"chapter_number": 1, "content": "主角推开院门。"},
    ).json()
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
    chapter = client.post(
        f"/api/novels/{novel_id}/chapters",
        json={"chapter_number": 1, "content": "主角推开院门。"},
    ).json()

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
    chapter = client.post(
        f"/api/novels/{novel_id}/chapters",
        json={"chapter_number": 1, "content": "正文。"},
    ).json()

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
    chapter = client.post(
        f"/api/novels/{novel_id}/chapters",
        json={"chapter_number": 1, "content": "旧正文。"},
    ).json()
    new_content = "编辑后的终稿正文。"

    response = client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/final-review",
        json={"decision": "edit", "comments": "改了结尾。", "content": new_content},
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
    chapter = client.post(
        f"/api/novels/{novel_id}/chapters",
        json={"chapter_number": 1, "content": "正文。"},
    ).json()

    response = client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/final-review",
        json={"decision": "reject", "comments": "节奏不行。"},
    )

    assert response.status_code == 201

    updated_chapter = client.get(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}"
    ).json()
    assert updated_chapter["status"] == "draft"
