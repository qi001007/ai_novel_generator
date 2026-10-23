import json

from app.services.llm import LLMResult
from app.services.markdown_doc import render
from app.services.workflows import default_workflow_graph
from tests.planning_helpers import (
    create_arc,
    create_character,
    create_chapter,
    create_toc,
    write_document,
)

REVIEW_TEXT = json.dumps(
    {
        "issues": [
            {
                "category": "连贯",
                "severity": "low",
                "location": "第 1 段",
                "quote": "雪落在铜铃上。",
                "suggestion": "雪落在铜铃上，铃声很轻。",
                "reason": "补足声音。",
            }
        ],
        "setting_updates": [],
    },
    ensure_ascii=False,
)


def _full_chain(client, monkeypatch):
    calls = []

    class FakeClient:
        def __init__(self, _routing):
            pass

        def complete_messages_on(self, provider, task, messages, **kwargs):
            calls.append((provider, task))
            if task == "review":
                return LLMResult(REVIEW_TEXT, "test-model", 23, 4, 0)
            return LLMResult("雪落在铜铃上。", "test-model", 37, 12, 0)

    monkeypatch.setattr("app.services.workflow_engine.RoutedLLMClient", FakeClient)
    novel_id = client.post("/api/novels", json={"title": "运行记录"}).json()["id"]
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
    # Not named by the brief, so the generation policy must say why it was dropped.
    create_character(client, novel_id, name="路人")

    generation = client.post("/api/workflows", json={
        "name": "正文", "novel_id": novel_id, "purpose": "generation", "is_default": True,
        "graph": default_workflow_graph("generation", "default", "test-model"),
    }).json()
    assert client.post(f"/api/workflows/{generation['id']}/publish").status_code == 201
    review = client.post("/api/workflows", json={
        "name": "自检", "novel_id": novel_id, "purpose": "review", "is_default": True,
        "graph": default_workflow_graph("review", "default", "test-model"),
    }).json()
    assert client.post(f"/api/workflows/{review['id']}/publish").status_code == 201

    endpoint = f"/api/novels/{novel_id}/chapters/{chapter['id']}/generation-candidates"
    job = client.post(endpoint, json={"request": "雪夜铜铃"}).json()
    accepted = client.put(
        f"/api/novels/{novel_id}/files/chapters/0001/draft.md",
        json={
            "text": render("draft", {"content": job["result"]["content"]}),
            "base_revision": job["payload"]["base_revision"],
            "generation_job_id": job["id"],
        },
    )
    assert accepted.status_code == 200, accepted.text
    review_result = client.post(f"/api/novels/{novel_id}/chapters/{chapter['id']}/auto-ai-review")
    assert review_result.status_code == 201, review_result.text
    return novel_id, chapter, job, review_result.json(), accepted.json()["revision"], calls


def test_chapter_runs_list_generation_and_review_with_linked_evidence(client, monkeypatch):
    novel_id, chapter, job, review, revision, _calls = _full_chain(client, monkeypatch)

    rows = client.get(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/workflow-runs"
    ).json()

    assert [row["purpose"] for row in rows] == ["generation", "review"]
    generation = rows[0]
    assert generation["workflow_name"] == "正文"
    assert generation["status"] == "completed"
    assert generation["node_count"] == 5
    assert generation["model"] == "test-model"
    assert generation["job"] == {"id": job["id"], "status": "accepted"}
    assert generation["accept_operation"]["revision"] == revision
    assert generation["accept_operation"]["path"] == "chapters/0001/draft.md"
    review_row = rows[1]
    assert review_row["workflow_name"] == "自检"
    assert review_row["review"] == {"id": review["id"], "decision": review["decision"], "reviewer": "ai"}
    review_detail = client.get(f"/api/workflow-runs/{review_row['id']}").json()
    review_context = next(node for node in review_detail["nodes"] if node["node_type"] == "context")
    chapter_item = next(
        item for item in review_context["output"]["selected"] if item["key"].startswith("chapter:")
    )
    assert chapter_item["title"] == "正文 · 第 1 章 雪夜"


def test_generation_accept_ai_review_and_final_review_keep_one_truth(client, monkeypatch):
    novel_id, chapter, job, review, revision, _calls = _full_chain(client, monkeypatch)
    path = f"/api/novels/{novel_id}/files/chapters/0001/draft.md"

    stale = client.put(
        path,
        json={
            "text": render("draft", {"content": "用旧版本号覆盖。"}),
            "base_revision": job["payload"]["base_revision"],
            "generation_job_id": job["id"],
        },
    )
    assert stale.status_code == 409, stale.text

    final = client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/final-review",
        json={"decision": "accept", "comments": "自检后终审通过。"},
    )
    assert final.status_code == 201, final.text
    stored = client.get(f"/api/novels/{novel_id}/chapters/{chapter['id']}").json()
    assert stored["status"] == "final"
    assert stored["final_decision"] == "accept"
    assert stored["content"] == job["result"]["content"]
    file_text = client.get(path).json()["text"]
    assert job["result"]["content"] in file_text
    assert "用旧版本号覆盖。" not in file_text

    runs = client.get(f"/api/novels/{novel_id}/chapters/{chapter['id']}/workflow-runs").json()
    assert [row["purpose"] for row in runs] == ["generation", "review"]
    assert runs[0]["job"] == {"id": job["id"], "status": "accepted"}
    assert runs[0]["accept_operation"]["revision"] == revision
    assert runs[1]["review"]["id"] == review["id"]


def test_run_detail_shows_nodes_exclusion_reasons_tokens_and_write_operation(client, monkeypatch):
    novel_id, chapter, job, _review, revision, _calls = _full_chain(client, monkeypatch)
    run_id = job["result"]["workflow_run_id"]

    detail = client.get(f"/api/workflow-runs/{run_id}").json()

    assert detail["workflow"]["name"] == "正文"
    assert detail["version"]["version"] == 1
    assert detail["chapter"] == {"id": chapter["id"], "chapter_number": 1, "title": "雪夜"}
    assert {node["node_type"] for node in detail["nodes"]} == {
        "start", "context", "prompt", "model", "output",
    }
    model_nodes = [node for node in detail["nodes"] if node["node_type"] == "model"]
    assert sum(node["token_input"] for node in model_nodes) == detail["token_input"]
    assert sum(node["token_output"] for node in model_nodes) == detail["token_output"]
    context = next(node for node in detail["nodes"] if node["node_type"] == "context")
    excluded = context["output"]["excluded"]
    assert excluded
    assert all(item["reason"] for item in excluded)
    assert any("路人" in item["title"] for item in excluded)
    assert detail["accept_operation"]["revision"] == revision
    assert detail["accept_operation"]["path"] == "chapters/0001/draft.md"
    assert detail["accept_operation"]["actor"] == "human"
