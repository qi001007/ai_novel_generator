from fastapi.testclient import TestClient

from app.services.llm import LLMResult, get_llm_client
from app.main import app
from tests.planning_helpers import create_brief as make_brief
from tests.planning_helpers import create_chapter


class FakeLLMClient:
    def __init__(self, content: str, model: str = "fake-model") -> None:
        self.settings = type("Settings", (), {"is_configured": True})()
        self.model = model
        self.content = content
        self.calls: list[tuple[str, str, str]] = []

    def complete(self, task_type: str, system: str, user: str) -> LLMResult:
        self.calls.append((task_type, system, user))
        return LLMResult(
            content=self.content,
            model=self.model,
            token_input=100,
            token_output=50,
            cost_estimate=0.0,
        )


def create_brief(client: TestClient, novel_id: int) -> dict:
    return make_brief(
        client,
        novel_id,
        chapter_number=1,
        goal="主角觉醒",
        pov="主角",
        characters=["主角"],
    )


def test_generate_chapter_uses_configured_llm(client: TestClient, monkeypatch) -> None:
    fake = FakeLLMClient("这是模型生成的正文。")
    app.dependency_overrides[get_llm_client] = lambda: fake

    novel_id = client.post("/api/novels", json={"title": "模型生成"}).json()["id"]
    brief = create_brief(client, novel_id)
    response = client.post(
        f"/api/novels/{novel_id}/chapters/from-brief/{brief['id']}"
    )

    assert response.status_code == 201
    assert response.json()["chapter"]["content"] == "这是模型生成的正文。"
    assert response.json()["generation_run"]["model"] == "fake-model"
    assert response.json()["generation_run"]["token_input"] == 100
    app.dependency_overrides.clear()


def test_auto_ai_review_creates_complete_review(client: TestClient) -> None:
    content = "主角推开了石门。"
    fake = FakeLLMClient(
        """
        {
          "decision": "passed",
          "comments": "整体合格。",
          "scores": {
            "consistency": 9,
            "character_behavior": 8,
            "pacing": 8,
            "continuity": 9,
            "foreshadowing": 8,
            "hook": 8,
            "style": 8
          },
          "evidence": {
            "consistency": ["主角推开了石门。"],
            "character_behavior": ["主角推开了石门。"],
            "pacing": ["主角推开了石门。"],
            "continuity": ["主角推开了石门。"],
            "foreshadowing": ["主角推开了石门。"],
            "hook": ["主角推开了石门。"],
            "style": ["主角推开了石门。"]
          }
        }
        """
    )
    app.dependency_overrides[get_llm_client] = lambda: fake

    novel_id = client.post("/api/novels", json={"title": "自动自检"}).json()["id"]
    chapter = create_chapter(client, novel_id, content=content)

    response = client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/auto-ai-review"
    )

    assert response.status_code == 201
    assert response.json()["reviewer"] == "ai"
    assert response.json()["scores"]["consistency"] == 9
    app.dependency_overrides.clear()


def test_auto_summary_extracts_final_chapter_facts(client: TestClient) -> None:
    fake = FakeLLMClient(
        """
        {
          "summary": "主角推开了石门。",
          "events": [{"type": "discovery", "detail": "石门开启"}],
          "character_state_changes": {"主角": "进入石门"},
          "foreshadow_updates": [{"title": "石门之后", "status": "open"}]
        }
        """
    )
    app.dependency_overrides[get_llm_client] = lambda: fake

    novel_id = client.post("/api/novels", json={"title": "自动摘要"}).json()["id"]
    chapter = create_chapter(
        client, novel_id, content="主角推开了石门。", status="final"
    )

    response = client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/auto-summary"
    )

    assert response.status_code == 201
    assert response.json()["summary"] == "主角推开了石门。"
    assert response.json()["events"][0]["detail"] == "石门开启"
    app.dependency_overrides.clear()
