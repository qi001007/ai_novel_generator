from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Column, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Novel(SQLModel, table=True):
    __tablename__ = "novel"

    id: int | None = Field(default=None, primary_key=True)
    title: str = Field(unique=True)
    description: str = ""
    target_chapters: int = 0
    style_constraints: str = ""
    cover_image: str = ""
    # Spine / cover colour the owner picks from the palette. Empty means "use the
    # workbench accent", so an unset novel is not a different-looking book.
    cover_color: str = ""
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class PlanningBlueprint(SQLModel, table=True):
    __tablename__ = "planning_blueprint"

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    version: int = 1
    is_active: bool = True
    main_line: str = ""
    ending: str = ""
    core_conflicts: str = ""
    themes: str = ""
    constraints: str = ""
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class TocEntry(SQLModel, table=True):
    __tablename__ = "toc_entry"
    __table_args__ = (UniqueConstraint("novel_id", "chapter_number"),)

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    chapter_number: int = Field(index=True)
    title: str = ""
    plot_function: str = ""
    notes: str = ""
    is_active: bool = True


class ArcPlan(SQLModel, table=True):
    __tablename__ = "arc_plan"

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    title: str = ""
    start_chapter: int = Field(index=True)
    end_chapter: int = Field(index=True)
    objective: str = ""
    conflict: str = ""
    resolution: str = ""
    status: str = "planned"
    planned_chapters: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class ChapterBrief(SQLModel, table=True):
    __tablename__ = "chapter_brief"
    __table_args__ = (UniqueConstraint("novel_id", "chapter_number"),)

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    arc_plan_id: int | None = Field(default=None, foreign_key="arc_plan.id")
    chapter_number: int = Field(index=True)
    goal: str = ""
    events: str = ""
    pov: str = ""
    characters: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    conflict: str = ""
    hook: str = ""
    required_facts: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    status: str = "draft"
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Chapter(SQLModel, table=True):
    __tablename__ = "chapter"
    __table_args__ = (UniqueConstraint("novel_id", "chapter_number"),)

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    brief_id: int | None = Field(default=None, foreign_key="chapter_brief.id")
    chapter_number: int = Field(index=True)
    title: str = ""
    content: str = ""
    word_count: int = 0
    status: str = "draft"
    final_decision: str = ""
    final_comment: str = ""
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Setting(SQLModel, table=True):
    __tablename__ = "setting"
    __table_args__ = (UniqueConstraint("novel_id", "category", "name"),)

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    category: str = Field(index=True)
    name: str
    content: str = ""
    current_state: str = ""
    is_confirmed: bool = False
    source_chapter: int | None = None
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Character(SQLModel, table=True):
    __tablename__ = "character"
    __table_args__ = (UniqueConstraint("novel_id", "name"),)

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    name: str
    level: str = "supporting"
    portrait: str = ""
    identity: str = ""
    goals: str = ""
    behavior_constraints: str = ""
    relationships: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    current_status: str = ""
    expected_start_chapter: int | None = None
    expected_end_chapter: int | None = None
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class CharacterAppearance(SQLModel, table=True):
    __tablename__ = "character_appearance"
    __table_args__ = (UniqueConstraint("character_id", "chapter_number"),)

    id: int | None = Field(default=None, primary_key=True)
    character_id: int = Field(foreign_key="character.id", index=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    chapter_number: int = Field(index=True)
    role_in_chapter: str = ""
    notes: str = ""


class Foreshadow(SQLModel, table=True):
    __tablename__ = "foreshadow"

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    title: str
    content: str = ""
    planted_chapter: int = Field(index=True)
    expected_payoff_chapter: int | None = None
    payoff_chapter: int | None = None
    status: str = "open"
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class ChapterSummary(SQLModel, table=True):
    __tablename__ = "chapter_summary"
    __table_args__ = (UniqueConstraint("novel_id", "chapter_number"),)

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    chapter_id: int = Field(foreign_key="chapter.id")
    chapter_number: int = Field(index=True)
    summary: str = ""
    events: list[dict[str, Any]] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    character_state_changes: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    foreshadow_updates: list[dict[str, Any]] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    is_confirmed: bool = True
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class PlotFeedback(SQLModel, table=True):
    __tablename__ = "plot_feedback"

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    content: str
    impact_levels: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    suggestions: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    status: str = "pending"
    applied_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class GenerationRun(SQLModel, table=True):
    __tablename__ = "generation_run"

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    chapter_id: int | None = Field(default=None, foreign_key="chapter.id", index=True)
    task_type: str = Field(index=True)
    model: str
    prompt_version: str = "v1"
    input_summary: str = ""
    output: str = ""
    token_input: int = 0
    token_output: int = 0
    cost_estimate: float = 0.0
    status: str = "completed"
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Review(SQLModel, table=True):
    __tablename__ = "review"

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    chapter_id: int = Field(foreign_key="chapter.id", index=True)
    generation_run_id: int | None = Field(
        default=None,
        foreign_key="generation_run.id",
    )
    reviewer: str = "ai"
    decision: str
    comments: str = ""
    evidence: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    scores: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class ChatMessage(SQLModel, table=True):
    __tablename__ = "chat_message"

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    role: str = Field(index=True)
    content: str = ""
    # The model's own reasoning for this answer, kept beside it and shown collapsed.
    # It is not part of `content`, so history replay and context injection never carry
    # a previous turn's thoughts along as if the model had said them out loud.
    reasoning: str = ""
    mode: str = "write"
    model: str = ""
    mentions: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    context_refs: list[dict[str, Any]] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    token_input: int = 0
    token_output: int = 0
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class AppConfig(SQLModel, table=True):
    """Runtime overrides for values that used to live only in backend/.env.

    A stored row wins even when its value is empty, so clearing a key in the UI really
    clears it instead of silently falling back to the file. .env stays the seed for a
    first run and the fallback for keys nobody has ever saved.
    """

    __tablename__ = "app_config"

    key: str = Field(primary_key=True)
    value: str = ""
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
