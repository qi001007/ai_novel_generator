from app.services.llm import LLMResult
from app.services.workflows import default_workflow_graph
from app.services.markdown_doc import render
from tests.planning_helpers import create_arc, create_chapter, create_toc, write_document


def setup_generation(client, monkeypatch, text="雪落在铜铃上。"):
    calls = []

    class FakeClient:
        def __init__(self, _routing):
            pass

        def complete_messages_on(self, provider, task, messages, **kwargs):
            calls.append((provider, task, messages, kwargs))
            return LLMResult(text, "test-model", 37, 12, 0)

    monkeypatch.setattr("app.services.workflow_engine.RoutedLLMClient", FakeClient)
    novel_id = client.post("/api/novels", json={"title": "候选接线"}).json()["id"]
    chapter = create_chapter(client, novel_id, content="已有工作稿。")
    write_document(client, novel_id, "blueprint.md", "blueprint", {
        "main_line": "雪夜铜铃", "ending": "", "core_conflicts": "",
        "themes": "", "constraints": "冷峻",
    })
    create_toc(client, novel_id, chapter_number=1, title="雪夜")
    create_arc(client, novel_id, start_chapter=1, end_chapter=1, title="初雪")
    write_document(client, novel_id, "chapters/0001/brief.md", "brief", {
        "chapter": 1, "arc": 1, "goal": "听见铜铃", "events": "雪落，铜铃响",
        "pov": "主角", "characters": [], "conflict": "无人应答",
        "hook": "铃声来自地下", "required_facts": [], "status": "draft",
    }, chapter=1)
    workflow = client.post("/api/workflows", json={
        "name": "正文", "novel_id": novel_id, "purpose": "generation", "is_default": True,
        "graph": default_workflow_graph("generation", "default", "test-model"),
    }).json()
    return novel_id, chapter, workflow, calls


def test_candidate_requires_published_workflow_then_accepts_once_through_file_put(client, monkeypatch):
    novel_id, chapter, workflow, calls = setup_generation(client, monkeypatch)
    endpoint = f"/api/novels/{novel_id}/chapters/{chapter['id']}/generation-candidates"
    assert client.post(endpoint, json={"request": "雪夜铜铃"}).status_code == 409
    assert calls == []
    assert client.post(f"/api/workflows/{workflow['id']}/publish").status_code == 201
    response = client.post(endpoint, json={"request": "雪夜铜铃"})
    assert response.status_code == 201, response.text
    job = response.json()
    assert job["status"] == "completed"
    assert job["result"]["content"] == "雪落在铜铃上。"
    assert "雪夜铜铃" in calls[0][2][-1]["content"]
    assert client.get(f"/api/novels/{novel_id}/chapters/{chapter['id']}").json()["content"] == "已有工作稿。"
    assert client.get(endpoint).json()[0]["id"] == job["id"]
    run = client.get(f"/api/workflow-runs/{job['result']['workflow_run_id']}").json()
    assert len(run["nodes"]) == 5
    assert (run["token_input"], run["token_output"]) == (37, 12)
    payload = {
        "text": render("draft", {"content": job["result"]["content"]}),
        "base_revision": job["payload"]["base_revision"], "generation_job_id": job["id"],
    }
    path = f"/api/novels/{novel_id}/files/chapters/0001/draft.md"
    accepted = client.put(path, json=payload)
    assert accepted.status_code == 200, accepted.text
    assert client.put(path, json=payload).json() == accepted.json()
    assert client.get(endpoint).json()[0]["status"] == "accepted"
    assert client.get(f"/api/novels/{novel_id}/chapters/{chapter['id']}").json()["content"] == "雪落在铜铃上。"


def test_candidate_with_trailing_whitespace_is_stored_trimmed_and_accepts(client, monkeypatch):
    novel_id, chapter, workflow, _calls = setup_generation(
        client, monkeypatch, "雪落在铜铃上。\n\n第二段。 \n\n",
    )
    assert client.post(f"/api/workflows/{workflow['id']}/publish").status_code == 201
    endpoint = f"/api/novels/{novel_id}/chapters/{chapter['id']}/generation-candidates"
    job = client.post(endpoint, json={}).json()
    assert job["result"]["content"] == "雪落在铜铃上。\n\n第二段。"
    payload = {
        "text": render("draft", {"content": job["result"]["content"]}),
        "base_revision": job["payload"]["base_revision"], "generation_job_id": job["id"],
    }
    path = f"/api/novels/{novel_id}/files/chapters/0001/draft.md"
    accepted = client.put(path, json=payload)
    assert accepted.status_code == 200, accepted.text
    assert client.get(f"/api/novels/{novel_id}/chapters/{chapter['id']}").json()["content"] == "雪落在铜铃上。\n\n第二段。"


def test_candidate_rejects_stale_working_draft_wrong_novel_path_and_content(client, monkeypatch):
    novel_id, chapter, workflow, _calls = setup_generation(client, monkeypatch)
    assert client.post(f"/api/workflows/{workflow['id']}/publish").status_code == 201
    endpoint = f"/api/novels/{novel_id}/chapters/{chapter['id']}/generation-candidates"
    job = client.post(endpoint, json={}).json()
    path = f"/api/novels/{novel_id}/files/chapters/0001/draft.md"
    payload = {"text": render("draft", {"content": job["result"]["content"]}),
               "base_revision": job["payload"]["base_revision"], "generation_job_id": job["id"]}
    other = client.post("/api/novels", json={"title": "另一本书"}).json()["id"]
    assert client.put(path.replace(f"novels/{novel_id}", f"novels/{other}"), json=payload).status_code == 404
    assert client.put(path.replace("0001", "0002"), json=payload).status_code == 409
    assert client.put(path, json={**payload, "text": render("draft", {"content": "伪造候选"})}).status_code == 409
    assert client.put(path, json={"text": render("draft", {"content": "主人新改的正文"}), "base_revision": payload["base_revision"]}).status_code == 200
    assert client.put(path, json=payload).status_code == 409
    assert client.get(endpoint).json()[0]["status"] == "completed"
    assert client.get(f"/api/novels/{novel_id}/chapters/{chapter['id']}").json()["content"] == "主人新改的正文"


def test_candidate_refuses_to_spend_a_model_call_without_abc_context(client, monkeypatch):
    calls = []

    class FakeClient:
        def __init__(self, _routing):
            pass

        def complete_messages_on(self, provider, task, messages, **kwargs):
            calls.append((provider, task, messages, kwargs))
            return LLMResult("不该出现。", "test-model", 1, 1, 0)

    monkeypatch.setattr("app.services.workflow_engine.RoutedLLMClient", FakeClient)
    novel_id = client.post("/api/novels", json={"title": "空上下文"}).json()["id"]
    chapter = create_chapter(client, novel_id)
    workflow = client.post("/api/workflows", json={
        "name": "空上下文正文", "novel_id": novel_id, "purpose": "generation", "is_default": True,
        "graph": default_workflow_graph("generation", "default", "test-model"),
    }).json()
    assert client.post(f"/api/workflows/{workflow['id']}/publish").status_code == 201

    response = client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/generation-candidates",
        json={},
    )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "A 层" in detail and "B 层" in detail and "C 层" in detail and "D 层" in detail
    assert calls == []
