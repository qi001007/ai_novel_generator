import json
import os

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from app import db as app_db


EXPECTED_TABLES = {
    "novel",
    "planning_blueprint",
    "toc_entry",
    "arc_plan",
    "chapter_brief",
    "chapter",
    "setting",
    "character",
    "character_appearance",
    "foreshadow",
    "chapter_summary",
    "plot_feedback",
    "generation_run",
    "review",
    "chat_message",
}


def test_migrations_create_core_schema(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "novel_generator.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setattr(app_db, "DATABASE_URL", database_url)

    alembic_config = Config("alembic.ini")
    command.upgrade(alembic_config, "head")

    inspector = inspect(create_engine(database_url))
    assert EXPECTED_TABLES.issubset(set(inspector.get_table_names()))
    for table in ("planning_blueprint", "chapter_brief", "character"):
        assert "custom_sections" in {column["name"] for column in inspector.get_columns(table)}
    assert "revision" in {column["name"] for column in inspector.get_columns("context_workflow")}


def test_custom_sections_migration_downgrades_and_upgrades(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "round_trip.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setattr(app_db, "DATABASE_URL", database_url)

    alembic_config = Config("alembic.ini")
    command.upgrade(alembic_config, "head")
    command.downgrade(alembic_config, "d8f3b6c05a17")
    inspector = inspect(create_engine(database_url))
    for table in ("planning_blueprint", "chapter_brief", "character"):
        assert "custom_sections" not in {column["name"] for column in inspector.get_columns(table)}

    command.upgrade(alembic_config, "head")
    inspector = inspect(create_engine(database_url))
    for table in ("planning_blueprint", "chapter_brief", "character"):
        assert "custom_sections" in {column["name"] for column in inspector.get_columns(table)}


def test_workflow_migration_removes_legacy_source_field(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "workflow_legacy.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setattr(app_db, "DATABASE_URL", database_url)
    alembic_config = Config("alembic.ini")
    command.upgrade(alembic_config, "d1e2f3a4b5c6")

    engine = create_engine(database_url)
    graph = {"version": 1, "nodes": [{"id": "start", "type": "start", "position": {"x": 0, "y": 0}, "source": None, "label": "开始", "config": {}}], "edges": []}
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO context_workflow (name, scope_key, novel_id, is_default, revision, policy, graph, created_at, updated_at) VALUES (:name, :scope_key, NULL, 0, 1, :policy, :graph, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"), {"name": "旧流程", "scope_key": "global", "policy": json.dumps({}), "graph": json.dumps(graph)})

    command.upgrade(alembic_config, "head")
    with engine.connect() as connection:
        migrated = json.loads(connection.execute(text("SELECT graph FROM context_workflow")).scalar_one())
    assert "source" not in migrated["nodes"][0]


def test_workflow_migration_seeds_review_binding_and_model_config(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "workflow_defaults.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setattr(app_db, "DATABASE_URL", database_url)
    alembic_config = Config("alembic.ini")
    command.upgrade(alembic_config, "i5d6e7f8a9b0")
    engine = create_engine(database_url)
    graph = {
        "version": 1,
        "nodes": [
            {"id": "start", "type": "start", "position": {"x": 0, "y": 0}, "label": "开始", "config": {}},
            {"id": "context", "type": "context", "position": {"x": 1, "y": 0}, "label": "上下文", "config": {"policy": {"version": 1, "budget": 100, "modules": [{"id": "blueprint", "kind": "blueprint", "enabled": True}]}}},
            {"id": "prompt", "type": "prompt", "position": {"x": 2, "y": 0}, "label": "提示词", "config": {"template": "{{input}}"}},
            {"id": "model", "type": "model", "position": {"x": 3, "y": 0}, "label": "模型", "config": {}},
            {"id": "output", "type": "output", "position": {"x": 4, "y": 0}, "label": "输出", "config": {}},
        ],
        "edges": [],
    }
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO novel (title, description, target_chapters, style_constraints, created_at, updated_at) VALUES ('迁移作品', '', 0, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
        novel_id = connection.execute(text("SELECT id FROM novel WHERE title='迁移作品'")).scalar_one()
        connection.execute(text("INSERT INTO app_config (key, value, updated_at) VALUES ('llm.route.draft', 'default', CURRENT_TIMESTAMP), ('llm.route.review', 'default', CURRENT_TIMESTAMP), ('llm.model.draft', 'draft-model', CURRENT_TIMESTAMP), ('llm.model.review', 'review-model', CURRENT_TIMESTAMP)"))
        connection.execute(text("INSERT INTO context_workflow (name, scope_key, novel_id, purpose, is_default, revision, policy, graph, created_at, updated_at) VALUES ('旧正文流程', :scope_key, :novel_id, 'generation', 1, 1, '{}', :graph, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"), {"scope_key": f"novel:{novel_id}", "novel_id": novel_id, "graph": json.dumps(graph)})
        workflow_id = connection.execute(text("SELECT id FROM context_workflow WHERE novel_id=:novel_id"), {"novel_id": novel_id}).scalar_one()
        connection.execute(text("INSERT INTO workflow_binding (novel_id, purpose, workflow_id, created_at, updated_at) VALUES (:novel_id, 'generation', :workflow_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"), {"novel_id": novel_id, "workflow_id": workflow_id})

    command.upgrade(alembic_config, "head")
    with engine.connect() as connection:
        rows = connection.execute(text("SELECT purpose, graph FROM context_workflow WHERE novel_id=:novel_id ORDER BY purpose"), {"novel_id": novel_id}).all()
        bindings = connection.execute(text("SELECT purpose FROM workflow_binding WHERE novel_id=:novel_id ORDER BY purpose"), {"novel_id": novel_id}).scalars().all()
    graphs = {purpose: json.loads(graph) for purpose, graph in rows}
    assert bindings == ["generation", "review"]
    assert next(node for node in graphs["generation"]["nodes"] if node["type"] == "model")["config"]["model_id"] == "draft-model"
    assert next(node for node in graphs["review"]["nodes"] if node["type"] == "model")["config"]["model_id"] == "review-model"
