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
    revision: int = 1
    status: str = "draft"
    pinned: bool = False
    archived: bool = False
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
    # Author-defined Markdown sections (for example `## 核心意象`) are persisted
    # in document order so the projection can round-trip without a second schema.
    custom_sections: list[dict[str, str]] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
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
    # The brief's standard sections remain indexed above; this list carries any
    # additional `##` sections the author adds to the Markdown document.
    custom_sections: list[dict[str, str]] = Field(
        default_factory=list,
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
    # Author-defined sub-sections inside each worldview record.
    custom_sections: list[dict[str, str]] = Field(
        default_factory=list,
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
    # Open-ended Markdown sections such as 特殊能力, preserved in source order.
    custom_sections: list[dict[str, str]] = Field(
        default_factory=list,
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
    # Author-defined sub-sections inside each foreshadow record.
    custom_sections: list[dict[str, str]] = Field(
        default_factory=list,
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
    updated_at: datetime = Field(
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
    # One book holds several conversations: 「新建对话」retires the current thread and
    # opens a fresh one, it never deletes the old messages (第二十八批批注 8).
    conversation_id: int = Field(default=1, index=True)
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
    # Every step this answer executed, in order, field for field what the `tool` event
    # carried while it streamed. The trace fold is built from these lines, so a reload
    # shows the same text the live stream showed (批注 31.4).
    steps: list[dict[str, Any]] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    # 批注 35.34: 一条斜杠命令最后结算成的那张卡。它原先只活在浏览器的行列表里，
    # Page.reload 之后整张卡消失，而它替人做的事全在——结果留痕、过程不留痕。
    # 结算文案住 `content`（一个事实一个主人），这一列只装「画这张卡还差的三样」。
    command_state: dict[str, Any] = Field(
        default_factory=dict,
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


class ContextWorkflow(SQLModel, table=True):
    """A saved, validated context assembly plan and its visual graph."""

    __tablename__ = "context_workflow"
    __table_args__ = (UniqueConstraint("scope_key", "name"),)

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    # Internal scope key lets a book-specific preset reuse a global preset name while
    # keeping names unique inside one scope.
    scope_key: str = Field(index=True)
    novel_id: int | None = Field(default=None, foreign_key="novel.id", index=True)
    # A workflow has one stable contract. Generation returns candidate prose;
    # review returns structured findings. Published definitions cannot switch it.
    purpose: str = Field(default="generation", index=True)
    is_default: bool = False
    revision: int = 1
    policy: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    graph: dict[str, Any] = Field(
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


class WorkflowBinding(SQLModel, table=True):
    """The one active workflow for a novel and purpose."""

    __tablename__ = "workflow_binding"
    __table_args__ = (UniqueConstraint("novel_id", "purpose"),)

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    purpose: str = Field(index=True)
    workflow_id: int = Field(foreign_key="context_workflow.id", index=True)
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))


class OutlineNode(SQLModel, table=True):
    """A single ordered node in the book -> volume -> chapter tree."""

    __tablename__ = "outline_node"
    __table_args__ = (UniqueConstraint("novel_id", "parent_id", "position"),)

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    parent_id: int | None = Field(default=None, foreign_key="outline_node.id", index=True)
    kind: str = Field(index=True)
    title: str
    position: int = Field(default=0, index=True)
    status: str = "draft"
    revision: int = 1
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))


class Document(SQLModel, table=True):
    """Canonical Markdown owned by the database and addressed by a stable path."""

    __tablename__ = "document"
    __table_args__ = (UniqueConstraint("novel_id", "path"),)

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    outline_node_id: int | None = Field(default=None, foreign_key="outline_node.id", index=True)
    kind: str = Field(index=True)
    path: str = Field(index=True)
    title: str = ""
    content: str = ""
    status: str = "draft"
    revision: int = 1
    source: str = "user"
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))


class KnowledgeEntry(SQLModel, table=True):
    """Characters, world rules, locations and organisations share one lifecycle."""

    __tablename__ = "knowledge_entry"
    __table_args__ = (UniqueConstraint("novel_id", "kind", "name"),)

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    kind: str = Field(index=True)
    name: str = Field(index=True)
    content: str = ""
    data: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    status: str = "draft"
    revision: int = 1
    source: str = "user"
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))


class Fact(SQLModel, table=True):
    """Only approved facts are eligible for stable generation context."""

    __tablename__ = "fact"

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    subject: str = Field(index=True)
    predicate: str
    value: str
    status: str = "draft"
    revision: int = 1
    source_ref: str = ""
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))


class Revision(SQLModel, table=True):
    __tablename__ = "revision"

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    asset_type: str = Field(index=True)
    asset_id: int = Field(index=True)
    revision: int
    snapshot: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    actor: str = "user"
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))


class Operation(SQLModel, table=True):
    """Auditable, idempotent mutation with enough data for a bounded undo."""

    __tablename__ = "operation"

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int | None = Field(default=None, foreign_key="novel.id", index=True)
    command: str = Field(index=True)
    idempotency_key: str = Field(unique=True, index=True)
    actor: str = "user"
    risk: str = "low"
    status: str = "completed"
    target_type: str = ""
    target_id: int | None = Field(default=None, index=True)
    before: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    after: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    result: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    undo_kind: str = "none"
    undone_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))


class WorkflowVersion(SQLModel, table=True):
    __tablename__ = "workflow_version"
    __table_args__ = (UniqueConstraint("workflow_id", "version"),)

    id: int | None = Field(default=None, primary_key=True)
    workflow_id: int = Field(foreign_key="context_workflow.id", index=True)
    version: int
    purpose: str = Field(default="generation", index=True)
    definition_revision: int = 1
    graph: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    source_json: str = ""
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))


class WorkflowRun(SQLModel, table=True):
    __tablename__ = "workflow_run"

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int | None = Field(default=None, foreign_key="novel.id", index=True)
    workflow_id: int = Field(foreign_key="context_workflow.id", index=True)
    workflow_version_id: int = Field(foreign_key="workflow_version.id", index=True)
    status: str = Field(default="queued", index=True)
    input: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    output: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    error: str = ""
    token_input: int = 0
    token_output: int = 0
    paused_node_id: str = ""
    started_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    ended_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))


class NodeRun(SQLModel, table=True):
    __tablename__ = "node_run"

    id: int | None = Field(default=None, primary_key=True)
    workflow_run_id: int = Field(foreign_key="workflow_run.id", index=True)
    node_id: str = Field(index=True)
    node_type: str
    status: str = "queued"
    input: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    output: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    error: str = ""
    retry_count: int = 0
    token_input: int = 0
    token_output: int = 0
    started_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    ended_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))


class Conversation(SQLModel, table=True):
    __tablename__ = "conversation"

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    title: str = "新对话"
    status: str = "active"
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))


class AgentRun(SQLModel, table=True):
    """One durable natural-language request to the platform operator."""

    __tablename__ = "agent_run"

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int | None = Field(default=None, foreign_key="novel.id", index=True)
    status: str = Field(default="running", index=True)
    request: str
    response: str = ""
    error: str = ""
    model: str = ""
    token_input: int = 0
    token_output: int = 0
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))


class ToolCall(SQLModel, table=True):
    __tablename__ = "tool_call"

    id: int | None = Field(default=None, primary_key=True)
    agent_run_id: int | None = Field(default=None, foreign_key="agent_run.id", index=True)
    novel_id: int | None = Field(default=None, foreign_key="novel.id", index=True)
    conversation_id: int | None = Field(default=None, foreign_key="conversation.id", index=True)
    operation_id: int | None = Field(default=None, foreign_key="operation.id")
    tool_name: str = Field(index=True)
    arguments: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    result: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    status: str = "completed"
    approval_state: str = "not_required"
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))


class MapProject(SQLModel, table=True):
    __tablename__ = "map_project"

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    name: str
    status: str = "draft"
    revision: int = 1
    settings: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))


class MapTile(SQLModel, table=True):
    __tablename__ = "map_tile"
    __table_args__ = (UniqueConstraint("map_project_id", "x", "y", "revision"),)

    id: int | None = Field(default=None, primary_key=True)
    map_project_id: int = Field(foreign_key="map_project.id", index=True)
    x: int = Field(index=True)
    y: int = Field(index=True)
    revision: int = 1
    status: str = "draft"
    image_path: str = ""
    prompt: str = ""
    seed: int | None = None
    provider: str = ""
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))


class GenerationJob(SQLModel, table=True):
    __tablename__ = "generation_job"

    id: int | None = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novel.id", index=True)
    kind: str = Field(index=True)
    status: str = Field(default="queued", index=True)
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    result: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    error: str = ""
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))
