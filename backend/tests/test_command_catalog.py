from sqlmodel import Session, select

from app.models import AppConfig, ContextWorkflow, Document, Fact, Operation, OutlineNode, WorkflowBinding, WorkflowVersion


def execute(client, name: str, payload: dict, key: str, *, approved: bool = False):
    return client.post(
        f"/api/commands/{name}/execute",
        json={
            "payload": payload,
            "idempotency_key": key,
            "actor": "test",
            "approved": approved,
        },
    )


def create_novel(client, key: str = "novel-1") -> tuple[int, int]:
    response = execute(client, "novel.create", {"title": "重建测试"}, key)
    assert response.status_code == 200, response.text
    body = response.json()
    return body["result"]["novel"]["id"], body["id"]


def workflow_payload(name: str, novel_id: int) -> dict:
    return {
        "name": name,
        "novel_id": novel_id,
        "purpose": "generation",
        "is_default": False,
        "graph": {
            "version": 1,
            "nodes": [
                {"id": "start", "type": "start", "position": {"x": 0, "y": 0}, "config": {"inputs": ["query"]}},
                {"id": "context", "type": "context", "position": {"x": 180, "y": 0}, "config": {"policy": {"version": 1, "budget": 60000, "modules": [{"id": "blueprint", "kind": "blueprint", "enabled": True}]}}},
                {"id": "prompt", "type": "prompt", "position": {"x": 360, "y": 0}, "config": {"template": "{{input}}"}},
                {"id": "model", "type": "model", "position": {"x": 540, "y": 0}, "config": {"provider_id": "default", "model_id": "test-model", "mock_output": "候选正文"}},
                {"id": "output", "type": "output", "position": {"x": 720, "y": 0}, "config": {"value": "$node.model.text"}},
            ],
            "edges": [
                {"source": "start", "target": "context"},
                {"source": "context", "target": "prompt"},
                {"source": "prompt", "target": "model"},
                {"source": "model", "target": "output"},
            ],
        },
    }


def test_function_catalog_is_the_public_contract(client) -> None:
    response = client.get("/api/functions")
    assert response.status_code == 200
    functions = {item["name"]: item for item in response.json()}
    assert {
        "novel.create",
        "outline.create",
        "document.update",
        "knowledge.create",
        "fact.create",
        "fact.approve",
        "asset.delete",
        "workflow.rename",
        "workflow.set_default",
        "workflow.create",
        "workflow.save",
        "workflow.publish",
        "workflow.delete",
    } <= functions.keys()
    assert functions["fact.approve"]["risk"] == "high"
    assert functions["workflow.delete"]["risk"] == "high"
    assert functions["document.update"]["input_schema"]["additionalProperties"] is False


def test_create_novel_seeds_one_current_workflow_per_purpose(client, db_engine) -> None:
    novel_id, _ = create_novel(client)
    with Session(db_engine) as session:
        workflows = session.exec(select(ContextWorkflow).where(ContextWorkflow.novel_id == novel_id)).all()
        bindings = session.exec(select(WorkflowBinding).where(WorkflowBinding.novel_id == novel_id)).all()

    assert {(workflow.purpose, workflow.is_default) for workflow in workflows} == {
        ("generation", True),
        ("review", True),
    }
    assert {(binding.purpose, binding.workflow_id) for binding in bindings} == {
        (workflow.purpose, workflow.id) for workflow in workflows
    }
    assert all(next(node for node in workflow.graph["nodes"] if node["type"] == "model")["config"]["provider_id"] for workflow in workflows)


def test_new_workflow_does_not_replace_a_published_system_default(client, db_engine) -> None:
    with Session(db_engine) as session:
        session.add(AppConfig(key="llm.model.draft", value="draft-model"))
        session.add(AppConfig(key="llm.model.review", value="review-model"))
        session.commit()
    novel_id, _ = create_novel(client, "novel-published")
    seeded = client.get(f"/api/workflows?novel_id={novel_id}").json()
    current = next(item for item in seeded if item["purpose"] == "review")
    assert current["is_default"] is True
    with Session(db_engine) as session:
        assert session.exec(select(WorkflowVersion).where(WorkflowVersion.workflow_id == current["id"])).first() is not None

    payload = workflow_payload("作者自检流程", novel_id)
    payload["purpose"] = "review"
    created = execute(client, "workflow.create", payload, "wf-new-review")
    assert created.status_code == 200, created.text
    new = created.json()["result"]["workflow"]
    after = client.get(f"/api/workflows/{current['id']}").json()

    assert new["is_default"] is False
    assert after["is_default"] is True
    assert after["revision"] == current["revision"]
    with Session(db_engine) as session:
        binding = session.exec(
            select(WorkflowBinding).where(
                WorkflowBinding.novel_id == novel_id,
                WorkflowBinding.purpose == "review",
            )
        ).one()
    assert binding.workflow_id == current["id"]


def test_workflow_commands_are_versioned_idempotent_and_undoable(client, db_engine) -> None:
    novel_id, _ = create_novel(client)
    first = client.post("/api/workflows", json=workflow_payload("初稿流程", novel_id)).json()
    second = client.post("/api/workflows", json=workflow_payload("审查流程", novel_id)).json()

    renamed = execute(
        client,
        "workflow.rename",
        {"workflow_id": first["id"], "name": "正文生成", "base_revision": first["revision"]},
        "workflow-rename-1",
    )
    assert renamed.status_code == 200
    renamed_workflow = renamed.json()["result"]["workflow"]
    assert renamed_workflow["name"] == "正文生成"
    assert renamed_workflow["revision"] == first["revision"] + 1

    repeated = execute(
        client,
        "workflow.rename",
        {"workflow_id": first["id"], "name": "不会再次执行", "base_revision": first["revision"]},
        "workflow-rename-1",
    )
    assert repeated.json()["id"] == renamed.json()["id"]

    stale = execute(
        client,
        "workflow.rename",
        {"workflow_id": first["id"], "name": "过期覆盖", "base_revision": first["revision"]},
        "workflow-rename-stale",
    )
    assert stale.status_code == 409

    first_default = execute(
        client,
        "workflow.set_default",
        {"workflow_id": first["id"], "base_revision": renamed_workflow["revision"]},
        "workflow-default-1",
    )
    assert first_default.status_code == 200
    second_default = execute(
        client,
        "workflow.set_default",
        {"workflow_id": second["id"], "base_revision": second["revision"]},
        "workflow-default-2",
    )
    assert second_default.status_code == 200

    undone = client.post(f"/api/operations/{second_default.json()['id']}/undo?actor=test")
    assert undone.status_code == 200
    with Session(db_engine) as session:
        restored_first = session.get(ContextWorkflow, first["id"])
        restored_second = session.get(ContextWorkflow, second["id"])
        assert restored_first is not None and restored_first.is_default is True
        assert restored_second is not None and restored_second.is_default is False
        assert session.exec(
            select(Operation).where(Operation.idempotency_key == "workflow-rename-stale")
        ).first() is None


def test_workflow_create_save_publish_share_one_command_pipeline(client, db_engine) -> None:
    novel_id, _ = create_novel(client)
    created_operation = execute(
        client,
        "workflow.create",
        workflow_payload("命令流程", novel_id),
        "workflow-create-command",
    )
    assert created_operation.status_code == 200
    created = created_operation.json()["result"]["workflow"]

    saved_operation = execute(
        client,
        "workflow.save",
        {
            **workflow_payload("命令流程二版", novel_id),
            "workflow_id": created["id"],
            "base_revision": created["revision"],
        },
        "workflow-save-command",
    )
    assert saved_operation.status_code == 200
    saved = saved_operation.json()["result"]["workflow"]
    assert saved["revision"] == 2

    published_operation = execute(
        client,
        "workflow.publish",
        {"workflow_id": saved["id"], "base_revision": saved["revision"]},
        "workflow-publish-command",
    )
    assert published_operation.status_code == 200
    published = published_operation.json()["result"]["workflow_version"]
    assert published["version"] == 1

    assert client.post(f"/api/operations/{published_operation.json()['id']}/undo?actor=test").status_code == 200
    assert client.post(f"/api/operations/{saved_operation.json()['id']}/undo?actor=test").status_code == 200
    assert client.post(f"/api/operations/{created_operation.json()['id']}/undo?actor=test").status_code == 200
    with Session(db_engine) as session:
        assert session.get(WorkflowVersion, published["id"]) is None
        assert session.get(ContextWorkflow, created["id"]) is None


def test_workflow_delete_requires_confirmation_preserves_history_and_can_undo(client, db_engine) -> None:
    novel_id, _ = create_novel(client)
    first = execute(client, "workflow.create", workflow_payload("待删流程", novel_id), "workflow-delete-create-1").json()["result"]["workflow"]
    second = execute(client, "workflow.create", workflow_payload("保留流程", novel_id), "workflow-delete-create-2").json()["result"]["workflow"]
    made_default = execute(
        client,
        "workflow.set_default",
        {"workflow_id": first["id"], "base_revision": first["revision"]},
        "workflow-delete-default",
    ).json()["result"]["workflow"]

    payload = {"workflow_id": first["id"], "base_revision": made_default["revision"]}
    preview = client.post("/api/commands/workflow.delete/preview", json={"payload": payload})
    assert preview.status_code == 200
    assert preview.json()["requires_confirmation"] is True
    assert preview.json()["diff"]["replacement_default_id"] == second["id"]
    assert execute(client, "workflow.delete", payload, "workflow-delete-unapproved").status_code == 409

    deleted = execute(client, "workflow.delete", payload, "workflow-delete-approved", approved=True)
    assert deleted.status_code == 200
    assert deleted.json()["result"]["deleted"] is True
    assert client.get(f"/api/workflows/{first['id']}").status_code == 404
    with Session(db_engine) as session:
        replacement = session.get(ContextWorkflow, second["id"])
        assert replacement is not None and replacement.is_default is True

    assert client.post(f"/api/operations/{deleted.json()['id']}/undo?actor=test").status_code == 200
    with Session(db_engine) as session:
        restored = session.get(ContextWorkflow, first["id"])
        replacement = session.get(ContextWorkflow, second["id"])
        assert restored is not None and restored.is_default is True
        assert replacement is not None and replacement.is_default is False

    published = execute(
        client,
        "workflow.publish",
        {"workflow_id": first["id"], "base_revision": restored.revision},
        "workflow-delete-publish",
    )
    assert published.status_code == 200
    blocked = execute(
        client,
        "workflow.delete",
        {"workflow_id": first["id"], "base_revision": restored.revision},
        "workflow-delete-history-block",
        approved=True,
    )
    assert blocked.status_code == 409
    assert "history" in blocked.json()["detail"]


def test_duplicate_idempotency_key_returns_the_original_operation(client, db_engine) -> None:
    novel_id, operation_id = create_novel(client)
    repeated = execute(client, "novel.create", {"title": "不会重复创建"}, "novel-1")
    assert repeated.status_code == 200
    assert repeated.json()["id"] == operation_id
    assert repeated.json()["result"]["novel"]["id"] == novel_id
    with Session(db_engine) as session:
        assert len(session.exec(select(Operation)).all()) == 1
        assert len(session.exec(select(Document)).all()) == 1


def test_a_failed_command_rolls_back_the_whole_transaction(client, db_engine) -> None:
    novel_id, _ = create_novel(client)
    failed = execute(
        client,
        "outline.create",
        {"novel_id": novel_id, "parent_id": 999, "kind": "chapter", "title": "孤儿章"},
        "bad-outline",
    )
    assert failed.status_code == 404
    with Session(db_engine) as session:
        assert session.exec(select(OutlineNode)).all() == []
        assert session.exec(select(Operation).where(Operation.idempotency_key == "bad-outline")).first() is None


def test_revision_conflict_never_overwrites_a_document(client) -> None:
    novel_id, _ = create_novel(client)
    created = execute(
        client,
        "document.update",
        {
            "novel_id": novel_id,
            "path": "notes/research.md",
            "kind": "research",
            "content": "第一版",
        },
        "document-1",
    )
    assert created.status_code == 200
    document = created.json()["result"]["document"]
    stale = execute(
        client,
        "document.update",
        {
            "novel_id": novel_id,
            "path": document["path"],
            "kind": "research",
            "content": "不应覆盖",
            "base_revision": 999,
        },
        "document-stale",
    )
    assert stale.status_code == 409
    workspace = client.get(f"/api/novels/{novel_id}/workspace").json()
    saved = next(item for item in workspace["documents"] if item["path"] == document["path"])
    assert saved["content"] == "第一版"


def test_high_risk_approval_and_undo_are_enforced(client, db_engine) -> None:
    novel_id, _ = create_novel(client)
    created = execute(
        client,
        "fact.create",
        {"novel_id": novel_id, "subject": "月城", "predicate": "天空", "value": "永远有两个月亮"},
        "fact-1",
    )
    fact = created.json()["result"]["fact"]
    preview = client.post(
        "/api/commands/fact.approve/preview",
        json={"payload": {"fact_id": fact["id"], "base_revision": fact["revision"]}},
    )
    assert preview.status_code == 200
    assert preview.json()["requires_confirmation"] is True

    refused = execute(
        client,
        "fact.approve",
        {"fact_id": fact["id"], "base_revision": fact["revision"]},
        "fact-approve-refused",
    )
    assert refused.status_code == 409

    approved = execute(
        client,
        "fact.approve",
        {"fact_id": fact["id"], "base_revision": fact["revision"]},
        "fact-approve",
        approved=True,
    )
    assert approved.status_code == 200
    assert approved.json()["result"]["fact"]["status"] == "approved"

    undone = client.post(f"/api/operations/{approved.json()['id']}/undo?actor=test")
    assert undone.status_code == 200
    with Session(db_engine) as session:
        restored = session.get(Fact, fact["id"])
        assert restored is not None
        assert restored.status == "draft"
        assert restored.revision == 1


def test_context_preview_is_deterministic_and_excludes_unapproved_facts(client) -> None:
    novel_id, _ = create_novel(client)
    character = execute(
        client,
        "knowledge.create",
        {"novel_id": novel_id, "kind": "character", "name": "林渊", "content": "林渊拒绝使用火焰。"},
        "knowledge-1",
    )
    assert character.status_code == 200
    draft_fact = execute(
        client,
        "fact.create",
        {"novel_id": novel_id, "subject": "林渊", "predicate": "武器", "value": "旧银剑"},
        "draft-fact",
    ).json()["result"]["fact"]
    approved_fact = execute(
        client,
        "fact.create",
        {"novel_id": novel_id, "subject": "月城", "predicate": "天空", "value": "两个月亮"},
        "approved-fact",
    ).json()["result"]["fact"]
    execute(
        client,
        "fact.approve",
        {"fact_id": approved_fact["id"], "base_revision": approved_fact["revision"]},
        "approved-fact-confirm",
        approved=True,
    )

    payload = {
        "novel_id": novel_id,
        "task_type": "generate",
        "query": "让林渊在月城看见天空",
        "token_budget": 2000,
    }
    first = client.post("/api/context/preview", json=payload)
    second = client.post("/api/context/preview", json=payload)
    assert first.status_code == 200
    assert first.json() == second.json()
    selected = first.json()["selected"]
    excluded = first.json()["excluded"]
    assert any(item["source"] == "mainline" and item["required"] for item in selected)
    assert any(item["key"] == f"knowledge:{character.json()['result']['knowledge_entry']['id']}" for item in selected)
    assert any(item["key"] == f"fact:{approved_fact['id']}" for item in selected)
    assert not any(item["key"] == f"fact:{draft_fact['id']}" for item in selected)
    assert any(item["key"] == f"fact:{draft_fact['id']}" and "尚未审批" in item["reason"] for item in excluded)
    assert first.json()["estimated_tokens"] <= payload["token_budget"]
