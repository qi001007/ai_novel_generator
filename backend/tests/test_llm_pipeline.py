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
        }],
        "setting_updates": [
            {
                "kind": "character",
                "name": "石门守门人",
                "content": "守在石门前的老人，知道石门的代价。",
                "conflict": False,
            },
            {
                "kind": "worldview",
                "name": "石门的代价",
                "content": "每次开启石门会失去一段记忆。",
                "conflict": True,
                "conflict_with": "既有设定：石门没有代价",
            },
        ],
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
    created = review["evidence"]["created_knowledge"]
    assert created[0]["name"] == "石门守门人" and created[0]["status"] == "draft"
    conflicts = review["evidence"]["setting_conflicts"]
    assert conflicts[0]["name"] == "石门的代价"
    report = client.get(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/reviews/{review['id']}/remediation-report"
    )
    assert report.status_code == 200
    markdown = report.json()["markdown"]
    assert "设定补充建议" in markdown
    assert "石门守门人" in markdown and "待主人确认" in markdown
    assert "石门的代价" in markdown and "需人工处理" in markdown
    drafts = client.get(f"/api/novels/{novel_id}/knowledge?status=draft").json()
    assert any(item["name"] == "石门守门人" and item["kind"] == "character" for item in drafts)
    entry = next(item for item in drafts if item["name"] == "石门守门人")
    approved = client.post("/api/commands/knowledge.approve/execute", json={
        "payload": {"knowledge_id": entry["id"], "base_revision": entry["revision"]},
        "idempotency_key": "approve-doorman",
    })
    assert approved.status_code == 200, approved.text
    approved_entry = approved.json()["result"]["knowledge_entry"]
    assert approved_entry["status"] == "merged"
    merged_into = approved.json()["result"]["merged_into"]
    assert merged_into.startswith("settings/characters/")
    merged_file = client.get(f"/api/novels/{novel_id}/files/{merged_into}")
    assert merged_file.status_code == 200
    assert "石门守门人" in merged_file.json()["text"]
    assert not any(
        item["id"] == entry["id"]
        for item in client.get(f"/api/novels/{novel_id}/knowledge?status=draft").json()
    )
    retired = client.post("/api/commands/asset.delete/execute", json={
        "payload": {
            "asset_type": "knowledge",
            "asset_id": entry["id"],
            "base_revision": approved_entry["revision"],
        },
        "idempotency_key": "retire-doorman",
        "approved": True,
    })
    assert retired.status_code == 200, retired.text
    assert retired.json()["result"]["asset"]["status"] == "retired"


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


def test_review_replacement_keeps_prose_and_drops_the_model_instruction() -> None:
    from app.services.reviews import clean_replacement

    assert clean_replacement("视网膜边缘悄然烙下一枚暗红几何印记。") == "视网膜边缘悄然烙下一枚暗红几何印记。"
    assert (
        clean_replacement("建议改为更符合整体文学质感的表述，例如‘视网膜边缘悄然烙下一枚暗红几何印记。’")
        == "视网膜边缘悄然烙下一枚暗红几何印记。"
    )
    assert clean_replacement("在该句后追加一句体现角色决断的描写，例如：‘林澈缓缓握拳。’") == "林澈缓缓握拳。"
    assert (
        clean_replacement("简报目标包含“被迫做出选择”，建议改为更具体的描写，例如‘林澈缓缓握拳，指节发响。’")
        == "林澈缓缓握拳，指节发响。"
    )
    assert clean_replacement("建议扩展这一句，增强氛围") == ""


def test_setting_search_matches_body_text_not_only_file_names(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "设定搜索"}).json()["id"]
    created = client.post("/api/commands/knowledge.create/execute", json={
        "payload": {
            "novel_id": novel_id,
            "kind": "world",
            "name": "规则区",
            "content": "重力方向可以局部改写。",
        },
        "idempotency_key": "search-knowledge",
    })
    assert created.status_code == 200, created.text

    response = client.get(f"/api/novels/{novel_id}/settings-search?q=重力方向")
    assert response.status_code == 200
    results = response.json()
    assert any(item["label"] == "世界观 · 规则区" and "重力方向" in item["snippet"] for item in results)
