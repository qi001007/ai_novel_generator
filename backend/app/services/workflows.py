"""Persistence rules and defaults for saved context workflows."""

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models import ContextWorkflow, Novel, WorkflowBinding, utc_now


_DEFAULT_CONTEXT_MODULES = [
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


def default_workflow_graph(purpose: str, provider_id: str, model_id: str) -> dict:
    """Return the editable starter graph for one stable workflow purpose."""
    review = purpose == "review"
    policy = {"version": 1, "budget": 60000, "modules": _DEFAULT_CONTEXT_MODULES}
    nodes = [
        {"id": "start", "type": "start", "position": {"x": 20, "y": 180}, "label": "开始", "config": {"inputs": ["chapter_number", "request"]}},
        {"id": "context", "type": "context", "position": {"x": 220, "y": 180}, "label": "动态上下文", "config": {"task_type": "review" if review else "generate", "token_budget": 8000, "policy": policy}},
        {"id": "prompt", "type": "prompt", "position": {"x": 440, "y": 180}, "label": "自检提示词" if review else "章节提示词", "config": {"template": "请检查正文并输出结构化问题：\n{{input}}" if review else "请根据上下文与用户要求续写正文：\n{{input}}"}},
        {"id": "model", "type": "model", "position": {"x": 660, "y": 180}, "label": "调用模型", "config": {"provider_id": provider_id, "model_id": model_id, "temperature": 0.2 if review else 0.7, "max_output_tokens": 2048 if review else 4096, "output_schema": "review_issues" if review else "text"}},
        {"id": "output", "type": "output", "position": {"x": 860, "y": 180}, "label": "输出", "config": {"format": "review_issues" if review else "text"}},
    ]
    return {"version": 1, "nodes": nodes, "edges": [
        {"source": "start", "target": "context", "source_handle": "", "target_handle": ""},
        {"source": "context", "target": "prompt", "source_handle": "", "target_handle": ""},
        {"source": "prompt", "target": "model", "source_handle": "", "target_handle": ""},
        {"source": "model", "target": "output", "source_handle": "", "target_handle": ""},
    ]}


def seed_default_workflows(
    session: Session,
    novel_id: int,
    *,
    generation_provider_id: str,
    generation_model_id: str,
    review_provider_id: str,
    review_model_id: str,
) -> list[ContextWorkflow]:
    """Create the two current workflow drafts as part of the novel transaction."""
    rows: list[ContextWorkflow] = []
    for purpose, name, provider_id, model_id in (
        ("generation", "默认正文生成", generation_provider_id, generation_model_id),
        ("review", "默认 AI 自检", review_provider_id, review_model_id),
    ):
        graph = default_workflow_graph(purpose, provider_id, model_id)
        row = ContextWorkflow(
            name=name,
            scope_key=scope_key(novel_id),
            novel_id=novel_id,
            purpose=purpose,
            is_default=True,
            policy=graph["nodes"][1]["config"]["policy"],
            graph=graph,
        )
        session.add(row)
        session.flush()
        session.add(WorkflowBinding(novel_id=novel_id, purpose=purpose, workflow_id=row.id))
        rows.append(row)
    return rows


def ensure_scope(session: Session, novel_id: int | None) -> None:
    if novel_id is not None and session.get(Novel, novel_id) is None:
        raise HTTPException(status_code=404, detail="Novel not found")


def ensure_unique_name(
    session: Session,
    name: str,
    novel_id: int | None,
    *,
    exclude_id: int | None = None,
) -> None:
    statement = select(ContextWorkflow).where(
        ContextWorkflow.name == name,
        ContextWorkflow.scope_key == scope_key(novel_id),
    )
    if exclude_id is not None:
        statement = statement.where(ContextWorkflow.id != exclude_id)
    if session.exec(statement).first() is not None:
        raise HTTPException(status_code=409, detail="A workflow with this name already exists")


def scope_key(novel_id: int | None) -> str:
    return "global" if novel_id is None else f"novel:{novel_id}"


def set_default(session: Session, workflow: ContextWorkflow) -> None:
    """Bind one active workflow for this novel and stable purpose."""
    if workflow.novel_id is None:
        raise HTTPException(status_code=409, detail="Global workflows cannot be activated for a novel")
    peers = session.exec(
        select(ContextWorkflow).where(
            ContextWorkflow.novel_id == workflow.novel_id,
            ContextWorkflow.purpose == workflow.purpose,
            ContextWorkflow.id != workflow.id,
        )
    ).all()
    for peer in peers:
        if peer.is_default:
            peer.is_default = False
            peer.revision += 1
            peer.updated_at = utc_now()
            session.add(peer)
    workflow.is_default = True
    binding = session.exec(
        select(WorkflowBinding).where(
            WorkflowBinding.novel_id == workflow.novel_id,
            WorkflowBinding.purpose == workflow.purpose,
        )
    ).first()
    if binding is None:
        binding = WorkflowBinding(
            novel_id=workflow.novel_id,
            purpose=workflow.purpose,
            workflow_id=workflow.id,
        )
    else:
        binding.workflow_id = workflow.id
        binding.updated_at = utc_now()
    session.add(binding)


def list_for_scope(session: Session, novel_id: int | None) -> list[ContextWorkflow]:
    statement = select(ContextWorkflow).order_by(ContextWorkflow.id)
    if novel_id is not None:
        statement = statement.where(
            (ContextWorkflow.novel_id == novel_id) | (ContextWorkflow.novel_id.is_(None))
        )
    return list(session.exec(statement).all())


def active_workflow(session: Session, novel_id: int, purpose: str) -> ContextWorkflow | None:
    binding = session.exec(
        select(WorkflowBinding).where(
            WorkflowBinding.novel_id == novel_id,
            WorkflowBinding.purpose == purpose,
        )
    ).first()
    return session.get(ContextWorkflow, binding.workflow_id) if binding else None
