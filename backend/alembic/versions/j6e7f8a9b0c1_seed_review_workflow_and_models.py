"""seed current review workflows and configured model nodes

Revision ID: j6e7f8a9b0c1
Revises: i5d6e7f8a9b0
"""

from __future__ import annotations

from datetime import datetime, timezone
import json

from alembic import op
import sqlalchemy as sa


revision = "j6e7f8a9b0c1"
down_revision = "i5d6e7f8a9b0"
branch_labels = None
depends_on = None


def _policy() -> dict:
    modules = [
        {"id": "blueprint", "kind": "blueprint", "enabled": True, "before": 0, "after": 0, "tail_chars": None, "limit": None, "selection": "all"},
        {"id": "toc", "kind": "toc", "enabled": True, "before": 10, "after": 10, "tail_chars": None, "limit": None, "selection": "all"},
        {"id": "arc", "kind": "arc", "enabled": True, "before": 10, "after": 10, "tail_chars": None, "limit": None, "selection": "all", "arc_window": 10, "arc_update_threshold": "2/3"},
        {"id": "briefs", "kind": "briefs", "enabled": True, "before": 2, "after": 0, "tail_chars": None, "limit": None, "selection": "all"},
        {"id": "drafts", "kind": "drafts", "enabled": True, "before": 2, "after": 0, "tail_chars": 4000, "limit": None, "selection": "all"},
        {"id": "characters", "kind": "characters", "enabled": True, "before": 0, "after": 0, "tail_chars": None, "limit": None, "selection": "brief_mentions"},
        {"id": "worldview", "kind": "worldview", "enabled": True, "before": 0, "after": 0, "tail_chars": None, "limit": None, "selection": "all"},
        {"id": "foreshadow", "kind": "foreshadow", "enabled": True, "before": 0, "after": 0, "tail_chars": None, "limit": None, "selection": "all"},
        {"id": "author_instructions", "kind": "author_instructions", "enabled": True, "before": 0, "after": 0, "tail_chars": None, "limit": None, "selection": "all"},
    ]
    return {"version": 1, "budget": 60000, "modules": modules}


def _graph(purpose: str, provider_id: str, model_id: str) -> dict:
    review = purpose == "review"
    return {"version": 1, "nodes": [
        {"id": "start", "type": "start", "position": {"x": 20, "y": 180}, "label": "开始", "config": {"inputs": ["chapter_number", "request"]}},
        {"id": "context", "type": "context", "position": {"x": 220, "y": 180}, "label": "动态上下文", "config": {"task_type": "review" if review else "generate", "token_budget": 8000, "policy": _policy()}},
        {"id": "prompt", "type": "prompt", "position": {"x": 440, "y": 180}, "label": "自检提示词" if review else "章节提示词", "config": {"template": "请检查正文并输出结构化问题：\n{{input}}" if review else "请根据上下文与用户要求续写正文：\n{{input}}"}},
        {"id": "model", "type": "model", "position": {"x": 660, "y": 180}, "label": "调用模型", "config": {"provider_id": provider_id, "model_id": model_id, "temperature": 0.2 if review else 0.7, "max_output_tokens": 2048 if review else 4096, "output_schema": "review_issues" if review else "text"}},
        {"id": "output", "type": "output", "position": {"x": 860, "y": 180}, "label": "输出", "config": {"format": "review_issues" if review else "text"}},
    ], "edges": [
        {"source": "start", "target": "context", "source_handle": "", "target_handle": ""},
        {"source": "context", "target": "prompt", "source_handle": "", "target_handle": ""},
        {"source": "prompt", "target": "model", "source_handle": "", "target_handle": ""},
        {"source": "model", "target": "output", "source_handle": "", "target_handle": ""},
    ]}


def upgrade() -> None:
    connection = op.get_bind()
    config_rows = dict(connection.execute(sa.text("SELECT key, value FROM app_config")).all())
    generation_provider = config_rows.get("llm.route.draft", "default")
    generation_model = config_rows.get("llm.model.draft", "")
    review_provider = config_rows.get("llm.route.review", "default")
    review_model = config_rows.get("llm.model.review", "")
    now = datetime.now(timezone.utc)

    novels = connection.execute(sa.text("SELECT id FROM novel ORDER BY id")).scalars().all()
    for novel_id in novels:
        generation = connection.execute(sa.text("SELECT id, graph FROM context_workflow WHERE novel_id=:novel_id AND purpose='generation' ORDER BY is_default DESC, id LIMIT 1"), {"novel_id": novel_id}).mappings().first()
        if generation is not None:
            graph = generation["graph"] if isinstance(generation["graph"], dict) else json.loads(generation["graph"])
            for node in graph.get("nodes", []):
                if node.get("type") == "model" and not node.get("config"):
                    node["config"] = {"provider_id": generation_provider, "model_id": generation_model, "temperature": 0.7, "max_output_tokens": 4096, "output_schema": "text"}
                if node.get("type") == "output" and not node.get("config"):
                    node["config"] = {"format": "text"}
            connection.execute(sa.text("UPDATE context_workflow SET graph=:graph WHERE id=:id"), {"id": generation["id"], "graph": json.dumps(graph, ensure_ascii=False)})

        review = connection.execute(sa.text("SELECT id FROM context_workflow WHERE novel_id=:novel_id AND purpose='review' ORDER BY is_default DESC, id LIMIT 1"), {"novel_id": novel_id}).scalar_one_or_none()
        if review is None:
            graph = _graph("review", review_provider, review_model)
            result = connection.execute(sa.text("INSERT INTO context_workflow (name, scope_key, novel_id, purpose, is_default, revision, policy, graph, created_at, updated_at) VALUES (:name, :scope_key, :novel_id, 'review', 1, 1, :policy, :graph, :created_at, :updated_at)"), {"name": "AI 自检", "scope_key": f"novel:{novel_id}", "novel_id": novel_id, "policy": json.dumps(_policy(), ensure_ascii=False), "graph": json.dumps(graph, ensure_ascii=False), "created_at": now, "updated_at": now})
            review = result.lastrowid
        binding = connection.execute(sa.text("SELECT id FROM workflow_binding WHERE novel_id=:novel_id AND purpose='review'"), {"novel_id": novel_id}).scalar_one_or_none()
        if binding is None:
            connection.execute(sa.text("INSERT INTO workflow_binding (novel_id, purpose, workflow_id, created_at, updated_at) VALUES (:novel_id, 'review', :workflow_id, :created_at, :updated_at)"), {"novel_id": novel_id, "workflow_id": review, "created_at": now, "updated_at": now})


def downgrade() -> None:
    # Seeded workflows are user-visible assets after migration and are not deleted.
    pass
