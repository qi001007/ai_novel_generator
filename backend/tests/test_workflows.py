from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import ContextWorkflow, WorkflowBinding, WorkflowVersion
from app.services.llm import LLMResult
from app.services.workflows import default_workflow_graph
from tests.planning_helpers import create_chapter


def _policy(*, budget: int = 60000) -> dict:
    return {
        "version": 1,
        "budget": budget,
        "modules": [
            {"id": "blueprint", "kind": "blueprint", "enabled": True},
            {"id": "worldview", "kind": "worldview", "enabled": True},
        ],
    }


def _graph(*, budget: int = 60000, provider: str = "default", model: str = "qwen-test") -> dict:
    return {
        "version": 1,
        "nodes": [
            {"id": "start", "type": "start", "position": {"x": 0, "y": 0}, "config": {"inputs": ["query"]}},
            {"id": "context", "type": "context", "position": {"x": 180, "y": 0}, "config": {"policy": _policy(budget=budget)}},
            {"id": "prompt", "type": "prompt", "position": {"x": 360, "y": 0}, "config": {"template": "输入：{{input}}"}},
            {"id": "model", "type": "model", "position": {"x": 540, "y": 0}, "config": {"provider_id": provider, "model_id": model, "temperature": 0.25, "mock_output": "候选正文"}},
            {"id": "output", "type": "output", "position": {"x": 720, "y": 0}, "config": {"value": "$node.model.text"}},
        ],
        "edges": [
            {"source": "start", "target": "context"},
            {"source": "context", "target": "prompt"},
            {"source": "prompt", "target": "model"},
            {"source": "model", "target": "output"},
        ],
    }


def _payload(novel_id: int, name: str, *, purpose: str = "generation", default: bool = False, graph: dict | None = None) -> dict:
    return {
        "name": name,
        "novel_id": novel_id,
        "purpose": purpose,
        "is_default": default,
        "graph": graph or _graph(),
    }


def _novel(client: TestClient, title: str = "工作流书") -> int:
    return client.post("/api/novels", json={"title": title}).json()["id"]


def test_each_purpose_has_one_independent_active_binding(client: TestClient, db_engine) -> None:
    novel_id = _novel(client)
    generation_a = client.post("/api/workflows", json=_payload(novel_id, "正文 A", default=True)).json()
    generation_b = client.post("/api/workflows", json=_payload(novel_id, "正文 B")).json()
    review = client.post("/api/workflows", json=_payload(novel_id, "自检 A", purpose="review", default=True)).json()

    assert client.post(f"/api/workflows/{generation_b['id']}/default").status_code == 200
    listed = client.get(f"/api/workflows?novel_id={novel_id}").json()
    assert {item["id"] for item in listed if item["is_default"]} == {generation_b["id"], review["id"]}
    assert next(item for item in listed if item["id"] == generation_a["id"])["is_default"] is False
    with Session(db_engine) as session:
        bindings = session.exec(select(WorkflowBinding).where(WorkflowBinding.novel_id == novel_id)).all()
        assert {(item.purpose, item.workflow_id) for item in bindings} == {
            ("generation", generation_b["id"]),
            ("review", review["id"]),
        }


def test_purpose_is_fixed_and_unsupported_nodes_are_rejected(client: TestClient) -> None:
    novel_id = _novel(client)
    workflow = client.post("/api/workflows", json=_payload(novel_id, "固定类型")).json()
    changed = client.put(f"/api/workflows/{workflow['id']}", json={"purpose": "review"})
    assert changed.status_code == 422

    invalid = _payload(novel_id, "旧节点")
    invalid["graph"]["nodes"][2]["type"] = "python"
    assert client.post("/api/workflows", json=invalid).status_code == 422


def test_graph_requires_exactly_one_context_and_configured_model_to_publish(client: TestClient) -> None:
    novel_id = _novel(client)
    no_context = _payload(novel_id, "无上下文")
    no_context["graph"]["nodes"] = [node for node in no_context["graph"]["nodes"] if node["type"] != "context"]
    no_context["graph"]["edges"] = [
        {"source": "start", "target": "prompt"},
        {"source": "prompt", "target": "model"},
        {"source": "model", "target": "output"},
    ]
    assert client.post("/api/workflows", json=no_context).status_code == 422

    blank = _graph(provider="", model="")
    workflow = client.post("/api/workflows", json=_payload(novel_id, "待配置", graph=blank)).json()
    assert client.post(f"/api/workflows/{workflow['id']}/validate").status_code == 422
    assert client.post(f"/api/workflows/{workflow['id']}/publish").status_code == 422


def test_workflow_list_exposes_latest_published_version(client: TestClient) -> None:
    novel_id = _novel(client, "发布状态书")
    created = client.post("/api/workflows", json=_payload(novel_id, "待发布")).json()
    assert created["published_version"] is None

    listed = {
        item["id"]: item for item in client.get(f"/api/workflows?novel_id={novel_id}").json()
    }
    assert listed[created["id"]]["published_version"] is None

    assert client.post(f"/api/workflows/{created['id']}/publish").status_code == 201
    published = client.get(f"/api/workflows/{created['id']}").json()
    assert published["published_version"] == 1
    listed = {
        item["id"]: item for item in client.get(f"/api/workflows?novel_id={novel_id}").json()
    }
    assert listed[created["id"]]["published_version"] == 1


def test_published_version_freezes_context_policy_and_purpose(client: TestClient, db_engine) -> None:
    novel_id = _novel(client)
    created = client.post("/api/workflows", json=_payload(novel_id, "冻结策略", graph=_graph(budget=24000))).json()
    published = client.post(f"/api/workflows/{created['id']}/publish")
    assert published.status_code == 201, published.text
    version_id = published.json()["id"]

    updated_graph = _graph(budget=88000)
    updated = client.put(f"/api/workflows/{created['id']}", json={"graph": updated_graph})
    assert updated.status_code == 200
    with Session(db_engine) as session:
        version = session.get(WorkflowVersion, version_id)
        assert version.purpose == "generation"
        assert version.definition_revision == created["revision"]
        context = next(node for node in version.graph["nodes"] if node["type"] == "context")
        assert context["config"]["policy"]["budget"] == 24000


def test_condition_named_branches_default_and_fanout_execute(client: TestClient) -> None:
    novel_id = _novel(client)
    graph = _graph()
    graph["nodes"] = [
        graph["nodes"][0],
        graph["nodes"][1],
        {
            "id": "condition",
            "type": "condition",
            "position": {"x": 360, "y": 0},
            "config": {"branches": [{"id": "match", "value": "$input.kind", "operator": "equals", "expected": "chapter"}]},
        },
        {"id": "model_a", "type": "model", "position": {"x": 540, "y": -80}, "config": {"provider_id": "default", "model_id": "qwen-test", "mock_output": "A"}},
        {"id": "model_b", "type": "model", "position": {"x": 540, "y": 80}, "config": {"provider_id": "default", "model_id": "qwen-test", "mock_output": "B"}},
        {"id": "model_else", "type": "model", "position": {"x": 540, "y": 220}, "config": {"provider_id": "default", "model_id": "qwen-test", "mock_output": "E"}},
        {"id": "output_a", "type": "output", "position": {"x": 740, "y": -80}},
        {"id": "output_b", "type": "output", "position": {"x": 740, "y": 80}},
        {"id": "output_else", "type": "output", "position": {"x": 740, "y": 220}},
    ]
    graph["edges"] = [
        {"source": "start", "target": "context"},
        {"source": "context", "target": "condition"},
        {"source": "condition", "source_handle": "match", "target": "model_a"},
        {"source": "condition", "source_handle": "match", "target": "model_b"},
        {"source": "condition", "source_handle": "else", "target": "model_else"},
        {"source": "model_a", "target": "output_a"},
        {"source": "model_b", "target": "output_b"},
        {"source": "model_else", "target": "output_else"},
    ]
    created = client.post("/api/workflows", json=_payload(novel_id, "条件分流", graph=graph))
    assert created.status_code == 201, created.text
    assert client.post(f"/api/workflows/{created.json()['id']}/publish").status_code == 201
    run = client.post("/api/workflow-runs", json={"workflow_id": created.json()["id"], "novel_id": novel_id, "input": {"kind": "chapter"}})
    assert run.status_code == 201
    statuses = {item["node_id"]: item["status"] for item in run.json()["nodes"]}
    assert statuses["model_a"] == "completed"
    assert statuses["model_b"] == "completed"
    assert "model_else" not in statuses


def test_model_node_uses_explicit_provider_and_records_usage(client: TestClient, monkeypatch) -> None:
    novel_id = _novel(client)
    calls: list[tuple[str, str, str, float | None, int | None]] = []

    class FakeRoutedClient:
        def __init__(self, _routing) -> None:
            pass

        def complete_messages_on(self, provider_id, task_type, messages, *, model, temperature=None, max_output_tokens=None):
            calls.append((provider_id, task_type, model, temperature, max_output_tokens))
            assert messages[-1]["content"]
            return LLMResult("真实路由结果", model, 31, 7, 0.0)

    monkeypatch.setattr("app.services.workflow_engine.resolve_routing", lambda _session: object())
    monkeypatch.setattr("app.services.workflow_engine.RoutedLLMClient", FakeRoutedClient)
    graph = _graph()
    model = next(node for node in graph["nodes"] if node["type"] == "model")
    model["config"].pop("mock_output")
    model["config"]["max_output_tokens"] = 2048
    workflow_id = client.post("/api/workflows", json=_payload(novel_id, "明确模型", graph=graph)).json()["id"]
    assert client.post(f"/api/workflows/{workflow_id}/publish").status_code == 201
    run = client.post("/api/workflow-runs", json={"workflow_id": workflow_id, "novel_id": novel_id, "input": {"query": "雪夜"}})
    assert run.status_code == 201, run.text
    assert (run.json()["token_input"], run.json()["token_output"]) == (31, 7)
    assert calls == [("default", "draft", "qwen-test", 0.25, 2048)]


def test_context_node_receives_frozen_policy(client: TestClient, monkeypatch) -> None:
    novel_id = _novel(client)
    calls: list[dict] = []

    def fake_preview(_session, **kwargs):
        calls.append(kwargs)
        return {"selected": [{"source": "blueprint"}]}

    monkeypatch.setattr("app.services.workflow_engine.build_context_preview", fake_preview)
    workflow_id = client.post("/api/workflows", json=_payload(novel_id, "上下文", graph=_graph(budget=32000))).json()["id"]
    assert client.post(f"/api/workflows/{workflow_id}/publish").status_code == 201
    run = client.post("/api/workflow-runs", json={"workflow_id": workflow_id, "novel_id": novel_id, "input": {"query": "雪夜", "chapter_number": 3}})
    assert run.status_code == 201
    assert calls[0]["policy"]["budget"] == 32000
    assert calls[0]["chapter_number"] == 3
    assert calls[0]["token_budget"] == 8000


def test_default_generation_graph_delivers_request_to_model(client: TestClient, monkeypatch) -> None:
    messages_seen = []

    class FakeClient:
        def __init__(self, _routing):
            pass

        def complete_messages_on(self, _provider, _task, messages, **_kwargs):
            messages_seen.extend(messages)
            return LLMResult("雪夜正文", "qwen-test", 17, 9, 0)

    monkeypatch.setattr("app.services.workflow_engine.RoutedLLMClient", FakeClient)
    novel_id = _novel(client)
    graph = default_workflow_graph("generation", "default", "qwen-test")
    workflow = client.post("/api/workflows", json=_payload(novel_id, "完整输入", graph=graph)).json()
    assert client.post(f"/api/workflows/{workflow['id']}/publish").status_code == 201
    response = client.post("/api/workflow-runs", json={
        "workflow_id": workflow["id"], "novel_id": novel_id,
        "input": {"chapter_number": 3, "request": "写雪夜追逐，结尾留下铜铃"},
    })
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "completed", response.text
    assert "写雪夜追逐，结尾留下铜铃" in messages_seen[-1]["content"]
    assert (response.json()["token_input"], response.json()["token_output"]) == (17, 9)


def test_default_review_graph_receives_full_target_chapter_and_json_contract(client: TestClient, monkeypatch) -> None:
    messages_seen = []

    class FakeClient:
        def __init__(self, _routing):
            pass

        def complete_messages_on(self, _provider, _task, messages, **_kwargs):
            messages_seen.extend(messages)
            return LLMResult('{"issues": []}', "qwen-test", 23, 4, 0)

    monkeypatch.setattr("app.services.workflow_engine.RoutedLLMClient", FakeClient)
    novel_id = _novel(client)
    target = "第一句必须被检查。" + "长正文。" * 1100 + "最后一句也必须被检查。"
    chapter = create_chapter(client, novel_id, chapter_number=3, content=target)
    graph = default_workflow_graph("review", "default", "qwen-test")
    workflow = client.post("/api/workflows", json=_payload(novel_id, "正文自检", purpose="review", default=True, graph=graph)).json()
    assert client.post(f"/api/workflows/{workflow['id']}/publish").status_code == 201
    response = client.post(f"/api/novels/{novel_id}/chapters/{chapter['id']}/auto-ai-review")
    assert response.status_code == 201, response.text
    assert target in messages_seen[-1]["content"]
    assert "JSON" in messages_seen[0]["content"]
    assert '"quote"' in messages_seen[0]["content"]


def test_review_rejects_unstructured_output_instead_of_reporting_pass(client: TestClient) -> None:
    novel_id = _novel(client)
    chapter = create_chapter(client, novel_id, content="这句话必须被检查。")
    graph = default_workflow_graph("review", "default", "qwen-test")
    next(node for node in graph["nodes"] if node["type"] == "model")["config"]["mock_output"] = '{"explanation": "模型未遵循格式"}'
    workflow = client.post("/api/workflows", json=_payload(novel_id, "格式校验", purpose="review", default=True, graph=graph)).json()
    assert client.post(f"/api/workflows/{workflow['id']}/publish").status_code == 201
    response = client.post(f"/api/novels/{novel_id}/chapters/{chapter['id']}/auto-ai-review")
    assert response.status_code == 422, response.text
    assert client.get(f"/api/novels/{novel_id}/chapters/{chapter['id']}/reviews").json() == []
