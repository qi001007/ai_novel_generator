import os

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


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
}


def test_migrations_create_core_schema(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "novel_generator.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("NOVEL_GENERATOR_DATABASE_URL", database_url)

    alembic_config = Config("alembic.ini")
    command.upgrade(alembic_config, "head")

    inspector = inspect(create_engine(database_url))
    assert EXPECTED_TABLES.issubset(set(inspector.get_table_names()))
