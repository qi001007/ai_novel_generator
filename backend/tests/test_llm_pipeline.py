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


class SequencedLLMClient(FakeLLMClient):
    def __init__(self, contents: list[str]) -> None:
        super().__init__(contents[0])
        self.contents = contents

    def complete(self, task_type: str, system: str, user: str) -> LLMResult:
        self.calls.append((task_type, system, user))
        content = self.contents[len(self.calls) - 1]
        return LLMResult(
            content=content,
            model="two-phase-model",
            token_input=10,
            token_output=5,
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


def review_workflow_payload(novel_id: int, quote: str) -> dict:
    result = {
        "issues": [{
            "category": "连续性",
            "severity": "medium",
            "location": "本章",
            "quote": quote,
            "suggestion": "主角谨慎地推开石门。",
            "reason": "动作缺少铺垫",
        }]
    }
    return {
        "novel_id": novel_id,
        "name": "默认 AI 自检",
        "purpose": "review",
        "is_default": True,
        "graph": {
            "version": 1,
            "nodes": [
                {"id": "start", "type": "start", "position": {"x": 0, "y": 0}, "config": {"inputs": ["query"]}},
                {"id": "context", "type": "context", "position": {"x": 180, "y": 0}, "config": {"policy": {"version": 1, "budget": 60000, "modules": [{"id": "blueprint", "kind": "blueprint", "enabled": True}]}}},
                {"id": "prompt", "type": "prompt", "position": {"x": 360, "y": 0}, "config": {"template": "检查：{{input}}"}},
                {"id": "model", "type": "model", "position": {"x": 540, "y": 0}, "config": {"provider_id": "default", "model_id": "fake-review", "mock_output": __import__("json").dumps(result, ensure_ascii=False)}},
                {"id": "output", "type": "output", "position": {"x": 720, "y": 0}, "config": {"value": "$node.model.text", "format": "review_issues"}},
            ],
            "edges": [
                {"source": "start", "target": "context"},
                {"source": "context", "target": "prompt"},
                {"source": "prompt", "target": "model"},
                {"source": "model", "target": "output"},
            ],
        },
    }


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


def test_auto_ai_review_requires_a_published_current_review_workflow(client: TestClient) -> None:
    content = "主角推开了石门。"
    novel_id = client.post("/api/novels", json={"title": "自动自检"}).json()["id"]
    chapter = create_chapter(client, novel_id, content=content)
    response = client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/auto-ai-review"
    )
    assert response.status_code == 409
    assert "当前 AI 自检流程" in response.json()["detail"]


def test_auto_ai_review_runs_the_published_workflow_and_creates_actionable_issues(client: TestClient) -> None:
    content = "主角推开了石门。"
    novel_id = client.post("/api/novels", json={"title": "Workflow 自检"}).json()["id"]
    chapter = create_chapter(client, novel_id, content=content)
    workflow = client.post("/api/workflows", json=review_workflow_payload(novel_id, content))
    assert workflow.status_code == 201, workflow.text
    published = client.post(f"/api/workflows/{workflow.json()['id']}/publish")
    assert published.status_code == 201, published.text

    response = client.post(f"/api/novels/{novel_id}/chapters/{chapter['id']}/auto-ai-review")

    assert response.status_code == 201, response.text
    review = response.json()
    assert review["reviewer"] == "ai"
    assert review["decision"] == "issues"
    suggestion = review["evidence"]["suggestions"][0]
    assert suggestion["quote"] == content
    assert suggestion["replacement"] == "主角谨慎地推开石门。"
    assert review["evidence"]["workflow_run_id"]


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
