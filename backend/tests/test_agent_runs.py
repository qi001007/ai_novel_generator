"""Platform Agent runs: the launcher can act before a novel exists."""

import json

from sqlmodel import Session, select

from app.models import KnowledgeEntry, Novel, Operation, ToolCall as StoredToolCall
from app.services.agent import AgentOutcome, AgentStep, ToolCall, ToolResult


def _parse_sse(body: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for block in body.strip().split("\n\n"):
        name = ""
        payload: dict = {}
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                payload = json.loads(line[6:])
        if name:
            events.append((name, payload))
    return events


def _create_novel_outcome(_llm, _messages, registry, **_kwargs):
    call = ToolCall(
        name="execute_platform_command",
        arguments={
            "name": "novel.create",
            "payload": json.dumps(
                {
                    "title": "Agent 创建的验收作品",
                    "description": "从空书架进入平台 Agent 创建",
                    "target_chapters": 24,
                    "style_constraints": "克制、清晰",
                },
                ensure_ascii=False,
            ),
            "idempotency_key": "launcher-create-acceptance",
        },
    )
    result = registry.run(call)
    return AgentOutcome(
        content="作品已创建，可以直接打开。",
        steps=[AgentStep(index=1, call=call, result=result, ms=1)],
        token_input=12,
        token_output=8,
        model="fake-platform-agent",
    )


def test_launcher_agent_creates_a_novel_and_persists_the_run(client, db_engine, monkeypatch) -> None:
    monkeypatch.setattr("app.routers.agent_runs.run_agent_turn", _create_novel_outcome)

    response = client.post("/api/agent/runs", json={"content": "创建一部 24 章的验收作品"})

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "completed"
    assert body["novel_id"] is not None
    assert body["response"] == "作品已创建，可以直接打开。"
    assert body["tool_calls"][0]["status"] == "completed"
    assert body["tool_calls"][0]["operation_id"] is not None
    with Session(db_engine) as session:
        assert session.exec(select(Novel)).one().title == "Agent 创建的验收作品"
        assert len(session.exec(select(Operation)).all()) == 1
        assert len(session.exec(select(StoredToolCall)).all()) == 1

    restored = client.get(f"/api/agent/runs/{body['id']}")
    assert restored.status_code == 200
    assert restored.json()["response"] == body["response"]


def test_high_risk_agent_call_waits_and_can_resume(client, db_engine, monkeypatch) -> None:
    with Session(db_engine) as session:
        novel = Novel(title="待审批作品")
        session.add(novel)
        session.commit()
        session.refresh(novel)
        entry = KnowledgeEntry(novel_id=novel.id, kind="world", name="天律", content="不可改写")
        session.add(entry)
        session.commit()
        session.refresh(entry)
        novel_id, entry_id, revision = novel.id, entry.id, entry.revision

    def pending_outcome(_llm, _messages, registry, **_kwargs):
        call = ToolCall(
            name="execute_platform_command",
            arguments={
                "name": "asset.delete",
                "payload": json.dumps(
                    {"asset_type": "knowledge", "asset_id": entry_id, "base_revision": revision}
                ),
                "idempotency_key": "retire-world-rule",
            },
        )
        result = registry.run(call)
        return AgentOutcome(
            content="这项操作需要主人确认。",
            steps=[AgentStep(index=1, call=call, result=result, ms=1)],
            token_input=10,
            token_output=5,
            model="fake-platform-agent",
        )

    monkeypatch.setattr("app.routers.agent_runs.run_agent_turn", pending_outcome)
    response = client.post(
        "/api/agent/runs",
        json={"content": "删除天律", "novel_id": novel_id},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "awaiting_approval"
    pending = body["tool_calls"][0]
    assert pending["approval_state"] == "pending"

    with Session(db_engine) as session:
        assert session.get(KnowledgeEntry, entry_id).status == "draft"
        assert session.exec(select(Operation)).all() == []

    resumed = client.post(
        f"/api/agent/runs/{body['id']}/resume",
        json={"tool_call_id": pending["id"], "decision": "approved"},
    )
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "completed"
    assert resumed.json()["tool_calls"][0]["approval_state"] == "approved"
    with Session(db_engine) as session:
        assert session.get(KnowledgeEntry, entry_id).status == "retired"
        assert len(session.exec(select(Operation)).all()) == 1


def test_rejecting_a_pending_agent_call_writes_nothing(client, db_engine, monkeypatch) -> None:
    with Session(db_engine) as session:
        novel = Novel(title="拒绝审批作品")
        session.add(novel)
        session.commit()
        session.refresh(novel)
        entry = KnowledgeEntry(novel_id=novel.id, kind="world", name="边界", content="保留")
        session.add(entry)
        session.commit()
        session.refresh(entry)
        novel_id, entry_id, revision = novel.id, entry.id, entry.revision

    def pending_outcome(_llm, _messages, registry, **_kwargs):
        call = ToolCall(
            name="execute_platform_command",
            arguments={
                "name": "asset.delete",
                "payload": json.dumps(
                    {"asset_type": "knowledge", "asset_id": entry_id, "base_revision": revision}
                ),
                "idempotency_key": "reject-retire-world-rule",
            },
        )
        result = registry.run(call)
        return AgentOutcome(
            content="等待确认。",
            steps=[AgentStep(index=1, call=call, result=result, ms=1)],
            token_input=1,
            token_output=1,
            model="fake-platform-agent",
        )

    monkeypatch.setattr("app.routers.agent_runs.run_agent_turn", pending_outcome)
    created = client.post("/api/agent/runs", json={"content": "删除边界", "novel_id": novel_id}).json()
    pending = created["tool_calls"][0]
    rejected = client.post(
        f"/api/agent/runs/{created['id']}/resume",
        json={"tool_call_id": pending["id"], "decision": "rejected"},
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    with Session(db_engine) as session:
        assert session.get(KnowledgeEntry, entry_id).status == "draft"
        assert session.exec(select(Operation)).all() == []


def test_workbench_chat_persists_high_risk_tool_call_and_restores_approval(
    client, db_engine, monkeypatch
) -> None:
    """The visible middle chat is the durable platform Agent, not a second loop."""
    with Session(db_engine) as session:
        novel = Novel(title="中栏 Agent 验收")
        session.add(novel)
        session.commit()
        session.refresh(novel)
        entry = KnowledgeEntry(novel_id=novel.id, kind="world", name="不可删除的边界", content="保留")
        session.add(entry)
        session.commit()
        session.refresh(entry)
        novel_id, entry_id, revision = novel.id, entry.id, entry.revision

    call = ToolCall(
        name="execute_platform_command",
        arguments={
            "name": "asset.delete",
            "payload": json.dumps(
                {"asset_type": "knowledge", "asset_id": entry_id, "base_revision": revision}
            ),
            "idempotency_key": "chat-retire-world-boundary",
        },
    )
    preview = {
        "command": "asset.delete",
        "risk": "high",
        "requires_confirmation": True,
        "diff": {"before": {"status": "draft"}, "after": {"status": "retired"}},
    }
    result = ToolResult(
        call=call,
        ok=True,
        content=json.dumps(
            {
                "status": "warning",
                "state": "confirmation_required",
                "command": "asset.delete",
                "preview": preview,
            }
        ),
    )
    step = AgentStep(index=1, call=call, result=result, ms=3)
    outcome = AgentOutcome(
        content="删除属于高风险操作，已等待主人确认。",
        steps=[step],
        token_input=9,
        token_output=6,
        model="fake-workbench-agent",
    )

    def fake_stream(*_args, **_kwargs):
        yield "tool", step
        yield "final", outcome

    monkeypatch.setattr("app.services.chat.stream_agent_turn", fake_stream)
    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "删除不可删除的边界", "mode": "plan"},
    )

    assert response.status_code == 200
    events = _parse_sse(response.text)
    run_event = next(payload for name, payload in events if name == "agent_run")
    tool_event = next(payload for name, payload in events if name == "tool")
    assert run_event["status"] == "running"
    assert tool_event["agent_run_id"] == run_event["id"]
    assert tool_event["tool_call"]["approval_state"] == "pending"
    assert tool_event["result"]["preview"] == preview

    history = client.get(f"/api/novels/{novel_id}/chat/messages").json()
    restored_step = history[-1]["steps"][0]
    assert restored_step["agent_run_id"] == run_event["id"]
    assert restored_step["tool_call"]["approval_state"] == "pending"

    resumed = client.post(
        f"/api/agent/runs/{run_event['id']}/resume",
        json={"tool_call_id": tool_event["tool_call"]["id"], "decision": "approved"},
    )
    assert resumed.status_code == 200
    assert resumed.json()["tool_calls"][0]["approval_state"] == "approved"
    with Session(db_engine) as session:
        assert session.get(KnowledgeEntry, entry_id).status == "retired"
        assert len(session.exec(select(Operation)).all()) == 1
