"""The canonical function catalogue used by UI, agents and workflows."""

from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func
from sqlmodel import Session, select

from app.core.commands import CommandSpec, Mutation, registry
from app.models import (
    Character,
    Document,
    Fact,
    ContextWorkflow,
    Foreshadow,
    KnowledgeEntry,
    Novel,
    Operation,
    OutlineNode,
    Revision,
    Setting,
    WorkflowRun,
    WorkflowBinding,
    WorkflowVersion,
    utc_now,
)
from app.application.workflow_schema import WorkflowGraph, WorkflowPayload
from app.services.llm import resolve_routing
from app.services.workflows import ensure_scope, ensure_unique_name, scope_key, seed_default_workflows, set_default


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NovelCreateInput(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    target_chapters: int = Field(default=0, ge=0, le=100000)
    style_constraints: str = Field(default="", max_length=20000)

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("title must not be blank")
        return value


class OutlineCreateInput(StrictModel):
    novel_id: int = Field(ge=1)
    parent_id: int | None = Field(default=None, ge=1)
    kind: Literal["volume", "chapter", "section"]
    title: str = Field(min_length=1, max_length=200)
    position: int | None = Field(default=None, ge=0)


class DocumentUpdateInput(StrictModel):
    novel_id: int = Field(ge=1)
    path: str = Field(min_length=1, max_length=500)
    kind: Literal["mainline", "volume_plan", "chapter_plan", "draft", "note", "research"]
    title: str = Field(default="", max_length=200)
    content: str = Field(default="", max_length=5_000_000)
    outline_node_id: int | None = Field(default=None, ge=1)
    base_revision: int | None = Field(default=None, ge=1)


class KnowledgeCreateInput(StrictModel):
    novel_id: int = Field(ge=1)
    kind: Literal["character", "world", "location", "organisation", "foreshadow", "research"]
    name: str = Field(min_length=1, max_length=200)
    content: str = Field(default="", max_length=500000)
    data: dict[str, Any] = Field(default_factory=dict)
    source: str = Field(default="user", max_length=500)


class FactCreateInput(StrictModel):
    novel_id: int = Field(ge=1)
    subject: str = Field(min_length=1, max_length=200)
    predicate: str = Field(min_length=1, max_length=200)
    value: str = Field(min_length=1, max_length=20000)
    source_ref: str = Field(default="", max_length=500)


class FactApproveInput(StrictModel):
    fact_id: int = Field(ge=1)
    base_revision: int = Field(ge=1)


class AssetDeleteInput(StrictModel):
    asset_type: Literal["document", "knowledge", "fact", "outline"]
    asset_id: int = Field(ge=1)
    base_revision: int = Field(ge=1)


class KnowledgeApproveInput(StrictModel):
    knowledge_id: int = Field(ge=1)
    base_revision: int = Field(ge=1)


class WorkflowRenameInput(StrictModel):
    workflow_id: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=120)
    base_revision: int = Field(ge=1)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be blank")
        return value


class WorkflowSetDefaultInput(StrictModel):
    workflow_id: int = Field(ge=1)
    base_revision: int = Field(ge=1)


class WorkflowSaveInput(WorkflowPayload):
    workflow_id: int = Field(ge=1)
    base_revision: int = Field(ge=1)


class WorkflowPublishInput(StrictModel):
    workflow_id: int = Field(ge=1)
    base_revision: int = Field(ge=1)


class WorkflowDeleteInput(StrictModel):
    workflow_id: int = Field(ge=1)
    base_revision: int = Field(ge=1)


def _context_policy(graph: WorkflowGraph) -> dict[str, Any]:
    node = next(item for item in graph.nodes if item.type == "context")
    return dict(node.config["policy"])


def _validate_model_catalog(session: Session, graph: WorkflowGraph) -> None:
    try:
        graph.assert_publishable()
    except ValueError as cause:
        raise HTTPException(status_code=422, detail=str(cause)) from cause
    routing = resolve_routing(session)
    provider_ids = {provider.id for provider in routing.providers}
    for node in graph.nodes:
        if node.type != "model":
            continue
        provider_id = str(node.config["provider_id"])
        if provider_id not in provider_ids:
            raise HTTPException(status_code=422, detail=f"Model node {node.id} uses an unknown provider")


def _novel(session: Session, novel_id: int) -> Novel:
    novel = session.get(Novel, novel_id)
    if novel is None:
        raise HTTPException(status_code=404, detail="Novel not found")
    return novel


def _snapshot(row: Any) -> dict[str, Any]:
    return row.model_dump(mode="json")


def _record_revision(session: Session, row: Any, asset_type: str, actor: str) -> None:
    session.add(
        Revision(
            novel_id=row.novel_id,
            asset_type=asset_type,
            asset_id=row.id,
            revision=row.revision,
            snapshot=_snapshot(row),
            actor=actor,
        )
    )


def _create_novel(session: Session, payload: BaseModel, actor: str) -> Mutation:
    value = NovelCreateInput.model_validate(payload)
    if session.exec(select(Novel).where(Novel.title == value.title)).first() is not None:
        raise HTTPException(status_code=409, detail="A novel with this title already exists")
    row = Novel(**value.model_dump())
    session.add(row)
    session.flush()
    mainline = Document(
        novel_id=row.id,
        kind="mainline",
        path="planning/mainline.md",
        title="文章主链路",
        content="# 文章主链路\n",
    )
    session.add(mainline)
    session.flush()
    routing = resolve_routing(session)
    workflows = seed_default_workflows(
        session,
        row.id,
        generation_provider_id=routing.provider_id_for("draft"),
        generation_model_id=routing.models.get("draft", ""),
        review_provider_id=routing.provider_id_for("review"),
        review_model_id=routing.models.get("review", ""),
    )
    session.flush()
    # A configured model is what makes the seeded graph publishable; without one the
    # drafts still exist for the writer to pick a model, exactly as before.
    versions = []
    for workflow in workflows:
        model_node = next(
            (node for node in workflow.graph["nodes"] if node["type"] == "model"),
            None,
        )
        if model_node is None or not model_node["config"].get("model_id"):
            continue
        versions.append(
            _publish_workflow(
                session,
                WorkflowPublishInput(workflow_id=workflow.id, base_revision=workflow.revision),
                actor,
            ).result["workflow_version"]
        )
    after = _snapshot(row)
    return Mutation(
        result={
            "novel": after,
            "mainline_document_id": mainline.id,
            "workflow_ids": [workflow.id for workflow in workflows],
            "workflow_version_ids": [version["id"] for version in versions],
        },
        novel_id=row.id,
        target_type="novel",
        target_id=row.id,
        after=after,
        undo_kind="retire",
        event="novel.created",
    )


def _preview_create_novel(session: Session, payload: BaseModel) -> dict[str, Any]:
    value = NovelCreateInput.model_validate(payload)
    exists = session.exec(select(Novel).where(Novel.title == value.title)).first() is not None
    return {"action": "create", "type": "novel", "title": value.title, "conflict": exists}


def _create_outline(session: Session, payload: BaseModel, actor: str) -> Mutation:
    value = OutlineCreateInput.model_validate(payload)
    _novel(session, value.novel_id)
    if value.parent_id is not None:
        parent = session.get(OutlineNode, value.parent_id)
        if parent is None or parent.novel_id != value.novel_id:
            raise HTTPException(status_code=404, detail="Parent outline node not found")
        if value.kind == "volume":
            raise HTTPException(status_code=422, detail="A volume must be a root outline node")
    position = value.position
    if position is None:
        highest = session.exec(
            select(func.max(OutlineNode.position)).where(
                OutlineNode.novel_id == value.novel_id,
                OutlineNode.parent_id == value.parent_id,
            )
        ).one()
        position = int(highest or -1) + 1
    row = OutlineNode(**value.model_dump(exclude={"position"}), position=position)
    session.add(row)
    session.flush()

    documents: list[int] = []
    if row.kind == "volume":
        doc = Document(
            novel_id=row.novel_id,
            outline_node_id=row.id,
            kind="volume_plan",
            path=f"volumes/{row.id}/plan.md",
            title=f"{row.title} · 卷规划",
            content=f"# {row.title}\n",
        )
        session.add(doc)
        session.flush()
        documents.append(doc.id)
    elif row.kind == "chapter":
        for kind, filename, label in (
            ("chapter_plan", "plan.md", "章节规划"),
            ("draft", "draft.md", "正文"),
        ):
            doc = Document(
                novel_id=row.novel_id,
                outline_node_id=row.id,
                kind=kind,
                path=f"chapters/{row.id}/{filename}",
                title=f"{row.title} · {label}",
                content=f"# {row.title}\n",
            )
            session.add(doc)
            session.flush()
            documents.append(doc.id)
    after = _snapshot(row)
    return Mutation(
        result={"outline_node": after, "document_ids": documents},
        novel_id=row.novel_id,
        target_type="outline",
        target_id=row.id,
        after=after,
        undo_kind="retire",
        event="outline.created",
    )


def _preview_outline(session: Session, payload: BaseModel) -> dict[str, Any]:
    value = OutlineCreateInput.model_validate(payload)
    _novel(session, value.novel_id)
    return {"action": "create", "type": value.kind, "title": value.title, "parent_id": value.parent_id}


def _update_document(session: Session, payload: BaseModel, actor: str) -> Mutation:
    value = DocumentUpdateInput.model_validate(payload)
    _novel(session, value.novel_id)
    row = session.exec(
        select(Document).where(Document.novel_id == value.novel_id, Document.path == value.path)
    ).first()
    if row is None:
        if value.base_revision is not None:
            raise HTTPException(status_code=409, detail="Document does not exist at the requested revision")
        row = Document(**value.model_dump(exclude={"base_revision"}))
        session.add(row)
        session.flush()
        before: dict[str, Any] = {}
        undo_kind = "retire"
    else:
        if value.base_revision is None or row.revision != value.base_revision:
            raise HTTPException(status_code=409, detail="Document revision conflict")
        before = _snapshot(row)
        _record_revision(session, row, "document", actor)
        row.title = value.title
        row.content = value.content
        row.kind = value.kind
        row.outline_node_id = value.outline_node_id
        row.revision += 1
        row.updated_at = utc_now()
        session.add(row)
        undo_kind = "restore"
    session.flush()
    after = _snapshot(row)
    return Mutation(
        result={"document": after},
        novel_id=row.novel_id,
        target_type="document",
        target_id=row.id,
        before=before,
        after=after,
        undo_kind=undo_kind,
        event="document.changed",
    )


def _preview_document(session: Session, payload: BaseModel) -> dict[str, Any]:
    value = DocumentUpdateInput.model_validate(payload)
    row = session.exec(
        select(Document).where(Document.novel_id == value.novel_id, Document.path == value.path)
    ).first()
    return {
        "action": "update" if row else "create",
        "path": value.path,
        "before": row.content if row else "",
        "after": value.content,
        "current_revision": row.revision if row else None,
    }


def _create_knowledge(session: Session, payload: BaseModel, actor: str) -> Mutation:
    value = KnowledgeCreateInput.model_validate(payload)
    _novel(session, value.novel_id)
    existing = session.exec(
        select(KnowledgeEntry).where(
            KnowledgeEntry.novel_id == value.novel_id,
            KnowledgeEntry.kind == value.kind,
            KnowledgeEntry.name == value.name,
        )
    ).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Knowledge entry already exists")
    row = KnowledgeEntry(**value.model_dump())
    session.add(row)
    session.flush()
    after = _snapshot(row)
    return Mutation(
        result={"knowledge_entry": after},
        novel_id=row.novel_id,
        target_type="knowledge",
        target_id=row.id,
        after=after,
        undo_kind="retire",
        event="knowledge.created",
    )


def _preview_knowledge(session: Session, payload: BaseModel) -> dict[str, Any]:
    value = KnowledgeCreateInput.model_validate(payload)
    return {"action": "create", "type": value.kind, "name": value.name, "status": "draft"}


def _merge_knowledge(session: Session, row: KnowledgeEntry) -> str:
    """A confirmed QA draft becomes a row in its natural setting document."""
    if row.kind == "world":
        existing = session.exec(
            select(Setting).where(
                Setting.novel_id == row.novel_id,
                Setting.name == row.name,
            )
        ).first()
        if existing is not None:
            existing.content = "\n".join(part for part in (existing.content, row.content) if part)
            existing.is_confirmed = True
            session.add(existing)
        else:
            session.add(Setting(
                novel_id=row.novel_id,
                category="其他",
                name=row.name,
                content=row.content,
                current_state="来自 AI 质检",
                is_confirmed=True,
            ))
        return "settings/worldview.md"
    if row.kind == "foreshadow":
        existing = session.exec(
            select(Foreshadow).where(
                Foreshadow.novel_id == row.novel_id,
                Foreshadow.title == row.name,
            )
        ).first()
        if existing is not None:
            existing.content = "\n".join(part for part in (existing.content, row.content) if part)
            session.add(existing)
        else:
            session.add(Foreshadow(
                novel_id=row.novel_id,
                title=row.name,
                content=row.content,
                planted_chapter=0,
                status="open",
            ))
        return "settings/foreshadow.md"
    if row.kind == "character":
        existing = session.exec(
            select(Character).where(
                Character.novel_id == row.novel_id,
                Character.name == row.name,
            )
        ).first()
        if existing is not None:
            existing.custom_sections = [
                *(existing.custom_sections or []),
                {"label": f"质检补充 #{row.id}", "content": row.content},
            ]
            session.add(existing)
            return f"settings/characters/{existing.id}.md"
        person = Character(
            novel_id=row.novel_id,
            name=row.name,
            level="supporting",
            custom_sections=[{"label": "质检补充", "content": row.content}],
        )
        session.add(person)
        session.flush()
        return f"settings/characters/{person.id}.md"
    return ""


def _approve_knowledge(session: Session, payload: BaseModel, actor: str) -> Mutation:
    value = KnowledgeApproveInput.model_validate(payload)
    row = session.get(KnowledgeEntry, value.knowledge_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Knowledge entry not found")
    if row.revision != value.base_revision:
        raise HTTPException(status_code=409, detail="Knowledge revision conflict")
    if row.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft can be approved")
    before = _snapshot(row)
    _record_revision(session, row, "knowledge", actor)
    merged_into = _merge_knowledge(session, row)
    row.status = "merged" if merged_into else "approved"
    row.data = {**(row.data or {}), "merged_into": merged_into}
    row.revision += 1
    row.updated_at = utc_now()
    session.add(row)
    session.flush()
    after = _snapshot(row)
    return Mutation(
        result={"knowledge_entry": after, "merged_into": merged_into},
        novel_id=row.novel_id,
        target_type="knowledge",
        target_id=row.id,
        before=before,
        after=after,
        undo_kind="restore",
        event="knowledge.approved",
    )


def _preview_approve_knowledge(session: Session, payload: BaseModel) -> dict[str, Any]:
    value = KnowledgeApproveInput.model_validate(payload)
    row = session.get(KnowledgeEntry, value.knowledge_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Knowledge entry not found")
    return {
        "action": "approve",
        "type": row.kind,
        "name": row.name,
        "status_before": row.status,
        "status_after": "approved",
    }


def _create_fact(session: Session, payload: BaseModel, actor: str) -> Mutation:
    value = FactCreateInput.model_validate(payload)
    _novel(session, value.novel_id)
    row = Fact(**value.model_dump())
    session.add(row)
    session.flush()
    after = _snapshot(row)
    return Mutation(
        result={"fact": after},
        novel_id=row.novel_id,
        target_type="fact",
        target_id=row.id,
        after=after,
        undo_kind="retire",
        event="fact.created",
    )


def _preview_fact(session: Session, payload: BaseModel) -> dict[str, Any]:
    value = FactCreateInput.model_validate(payload)
    return {"action": "create", "fact": f"{value.subject} · {value.predicate} · {value.value}", "status": "draft"}


def _approve_fact(session: Session, payload: BaseModel, actor: str) -> Mutation:
    value = FactApproveInput.model_validate(payload)
    row = session.get(Fact, value.fact_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Fact not found")
    if row.revision != value.base_revision:
        raise HTTPException(status_code=409, detail="Fact revision conflict")
    before = _snapshot(row)
    _record_revision(session, row, "fact", actor)
    row.status = "approved"
    row.revision += 1
    row.updated_at = utc_now()
    session.add(row)
    session.flush()
    after = _snapshot(row)
    return Mutation(
        result={"fact": after},
        novel_id=row.novel_id,
        target_type="fact",
        target_id=row.id,
        before=before,
        after=after,
        undo_kind="restore",
        event="fact.approved",
    )


def _preview_approve_fact(session: Session, payload: BaseModel) -> dict[str, Any]:
    value = FactApproveInput.model_validate(payload)
    row = session.get(Fact, value.fact_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Fact not found")
    return {"action": "approve", "before": row.status, "after": "approved", "fact_id": row.id}


ASSET_MODELS = {
    "document": Document,
    "knowledge": KnowledgeEntry,
    "fact": Fact,
    "outline": OutlineNode,
}


def _retire_asset(session: Session, payload: BaseModel, actor: str) -> Mutation:
    value = AssetDeleteInput.model_validate(payload)
    model = ASSET_MODELS[value.asset_type]
    row = session.get(model, value.asset_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    if row.revision != value.base_revision:
        raise HTTPException(status_code=409, detail="Asset revision conflict")
    before = _snapshot(row)
    _record_revision(session, row, value.asset_type, actor)
    row.status = "retired"
    row.revision += 1
    row.updated_at = utc_now()
    session.add(row)
    session.flush()
    after = _snapshot(row)
    return Mutation(
        result={"asset": after},
        novel_id=row.novel_id,
        target_type=value.asset_type,
        target_id=row.id,
        before=before,
        after=after,
        undo_kind="restore",
        event="asset.retired",
    )


def _preview_retire(session: Session, payload: BaseModel) -> dict[str, Any]:
    value = AssetDeleteInput.model_validate(payload)
    row = session.get(ASSET_MODELS[value.asset_type], value.asset_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"action": "retire", "type": value.asset_type, "id": value.asset_id, "before": _snapshot(row)}


def _workflow(session: Session, workflow_id: int, base_revision: int) -> ContextWorkflow:
    row = session.get(ContextWorkflow, workflow_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if row.revision != base_revision:
        raise HTTPException(status_code=409, detail="Workflow revision conflict")
    return row


def _rename_workflow(session: Session, payload: BaseModel, actor: str) -> Mutation:
    value = WorkflowRenameInput.model_validate(payload)
    row = _workflow(session, value.workflow_id, value.base_revision)
    ensure_unique_name(session, value.name, row.novel_id, exclude_id=row.id)
    before = _snapshot(row)
    row.name = value.name
    row.revision += 1
    row.updated_at = utc_now()
    session.add(row)
    session.flush()
    after = _snapshot(row)
    return Mutation(
        result={"workflow": after},
        novel_id=row.novel_id,
        target_type="workflow",
        target_id=row.id,
        before=before,
        after=after,
        undo_kind="restore",
        event="workflow.changed",
    )


def _preview_rename_workflow(session: Session, payload: BaseModel) -> dict[str, Any]:
    value = WorkflowRenameInput.model_validate(payload)
    row = _workflow(session, value.workflow_id, value.base_revision)
    ensure_unique_name(session, value.name, row.novel_id, exclude_id=row.id)
    return {"action": "rename", "workflow_id": row.id, "before": row.name, "after": value.name}


def _set_default_workflow(session: Session, payload: BaseModel, actor: str) -> Mutation:
    value = WorkflowSetDefaultInput.model_validate(payload)
    row = _workflow(session, value.workflow_id, value.base_revision)
    peers = session.exec(
        select(ContextWorkflow).where(
            ContextWorkflow.novel_id == row.novel_id,
            ContextWorkflow.purpose == row.purpose,
        )
    ).all()
    before_rows = [_snapshot(peer) for peer in peers]
    binding = session.exec(select(WorkflowBinding).where(WorkflowBinding.novel_id == row.novel_id, WorkflowBinding.purpose == row.purpose)).first()
    set_default(session, row)
    row.revision += 1
    row.updated_at = utc_now()
    session.add(row)
    session.flush()
    after_rows = [_snapshot(peer) for peer in peers]
    return Mutation(
        result={"workflow": _snapshot(row)},
        novel_id=row.novel_id,
        target_type="workflow_defaults",
        target_id=row.id,
        before={"rows": before_rows, "binding": _snapshot(binding) if binding else None, "novel_id": row.novel_id, "purpose": row.purpose},
        after={"rows": after_rows},
        undo_kind="restore_workflow_defaults",
        event="workflow.changed",
    )


def _preview_set_default_workflow(session: Session, payload: BaseModel) -> dict[str, Any]:
    value = WorkflowSetDefaultInput.model_validate(payload)
    row = _workflow(session, value.workflow_id, value.base_revision)
    current = session.exec(
        select(ContextWorkflow).where(
            ContextWorkflow.novel_id == row.novel_id,
            ContextWorkflow.purpose == row.purpose,
            ContextWorkflow.is_default.is_(True),
        )
    ).first()
    return {
        "action": "set_default",
        "workflow_id": row.id,
        "before": current.id if current else None,
        "after": row.id,
    }


def _create_workflow(session: Session, payload: BaseModel, actor: str) -> Mutation:
    value = WorkflowPayload.model_validate(payload)
    ensure_scope(session, value.novel_id)
    ensure_unique_name(session, value.name, value.novel_id)
    default_rows = [
        _snapshot(peer)
        for peer in session.exec(select(ContextWorkflow).where(ContextWorkflow.novel_id == value.novel_id, ContextWorkflow.purpose == value.purpose, ContextWorkflow.is_default.is_(True))).all()
    ]
    existing_binding = session.exec(select(WorkflowBinding).where(WorkflowBinding.novel_id == value.novel_id, WorkflowBinding.purpose == value.purpose)).first()
    row = ContextWorkflow(
        name=value.name,
        novel_id=value.novel_id,
        scope_key=scope_key(value.novel_id),
        purpose=value.purpose,
        is_default=False,
        policy=_context_policy(value.graph),
        graph=value.graph.model_dump(mode="json"),
    )
    session.add(row)
    session.flush()
    # A seeded draft is only a placeholder until it is published: the first real
    # workflow for a purpose must take over the binding, otherwise generation and
    # review keep pointing at a graph that cannot run.
    current = session.get(ContextWorkflow, existing_binding.workflow_id) if existing_binding else None
    current_is_placeholder = (
        current is not None
        and current.name.startswith("系统 · ")
        and session.exec(
            select(WorkflowVersion.id).where(WorkflowVersion.workflow_id == current.id)
        ).first()
        is None
    )
    if value.is_default or (
        value.novel_id is not None and (current is None or current_is_placeholder)
    ):
        set_default(session, row)
    session.flush()
    after = _snapshot(row)
    return Mutation(
        result={"workflow": after},
        novel_id=row.novel_id,
        target_type="workflow",
        target_id=row.id,
        before={"default_rows": default_rows, "binding": _snapshot(existing_binding) if existing_binding else None, "novel_id": value.novel_id, "purpose": value.purpose},
        after=after,
        undo_kind="delete_workflow_restore_defaults",
        event="workflow.created",
    )


def _preview_create_workflow(session: Session, payload: BaseModel) -> dict[str, Any]:
    value = WorkflowPayload.model_validate(payload)
    ensure_scope(session, value.novel_id)
    ensure_unique_name(session, value.name, value.novel_id)
    return {
        "action": "create",
        "name": value.name,
        "novel_id": value.novel_id,
        "purpose": value.purpose,
        "is_default": value.is_default,
    }


def _save_workflow(session: Session, payload: BaseModel, actor: str) -> Mutation:
    value = WorkflowSaveInput.model_validate(payload)
    row = _workflow(session, value.workflow_id, value.base_revision)
    ensure_scope(session, value.novel_id)
    if value.novel_id != row.novel_id:
        raise HTTPException(status_code=409, detail="Workflows cannot move between novels")
    if value.purpose != row.purpose:
        raise HTTPException(status_code=409, detail="Workflow purpose is fixed at creation")
    ensure_unique_name(session, value.name, value.novel_id, exclude_id=row.id)
    before = {
        "workflow": _snapshot(row),
        "default_rows": [
            _snapshot(peer)
            for peer in session.exec(select(ContextWorkflow).where(ContextWorkflow.novel_id == row.novel_id, ContextWorkflow.purpose == row.purpose, ContextWorkflow.is_default.is_(True))).all()
        ],
        "binding": (
            _snapshot(binding)
            if (binding := session.exec(select(WorkflowBinding).where(WorkflowBinding.novel_id == row.novel_id, WorkflowBinding.purpose == row.purpose)).first())
            else None
        ),
    }
    row.name = value.name
    row.policy = _context_policy(value.graph)
    row.graph = value.graph.model_dump(mode="json")
    row.revision += 1
    row.updated_at = utc_now()
    session.add(row)
    if value.is_default:
        set_default(session, row)
    else:
        row.is_default = False
    session.flush()
    after = _snapshot(row)
    return Mutation(
        result={"workflow": after},
        novel_id=row.novel_id,
        target_type="workflow",
        target_id=row.id,
        before=before,
        after=after,
        undo_kind="restore_workflow_save",
        event="workflow.changed",
    )


def _preview_save_workflow(session: Session, payload: BaseModel) -> dict[str, Any]:
    value = WorkflowSaveInput.model_validate(payload)
    row = _workflow(session, value.workflow_id, value.base_revision)
    ensure_scope(session, value.novel_id)
    if value.novel_id != row.novel_id or value.purpose != row.purpose:
        raise HTTPException(status_code=409, detail="Workflow novel and purpose are immutable")
    ensure_unique_name(session, value.name, value.novel_id, exclude_id=row.id)
    return {
        "action": "save",
        "workflow_id": row.id,
        "revision": {"before": row.revision, "after": row.revision + 1},
        "name": {"before": row.name, "after": value.name},
        "node_count": len(value.graph.nodes),
    }


def _publish_workflow(session: Session, payload: BaseModel, actor: str) -> Mutation:
    value = WorkflowPublishInput.model_validate(payload)
    row = _workflow(session, value.workflow_id, value.base_revision)
    graph = WorkflowGraph.model_validate(row.graph)
    _validate_model_catalog(session, graph)
    latest = session.exec(
        select(func.max(WorkflowVersion.version)).where(WorkflowVersion.workflow_id == row.id)
    ).one()
    graph_data = graph.model_dump(mode="json")
    published = WorkflowVersion(
        workflow_id=row.id,
        version=int(latest or 0) + 1,
        purpose=row.purpose,
        definition_revision=row.revision,
        graph=graph_data,
        source_json=json.dumps(graph_data, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
    )
    session.add(published)
    session.flush()
    after = _snapshot(published)
    return Mutation(
        result={"workflow_version": after},
        novel_id=row.novel_id,
        target_type="workflow_version",
        target_id=published.id,
        after=after,
        undo_kind="delete_workflow_version",
        event="workflow.published",
    )


def _preview_publish_workflow(session: Session, payload: BaseModel) -> dict[str, Any]:
    value = WorkflowPublishInput.model_validate(payload)
    row = _workflow(session, value.workflow_id, value.base_revision)
    graph = WorkflowGraph.model_validate(row.graph)
    _validate_model_catalog(session, graph)
    latest = session.exec(
        select(func.max(WorkflowVersion.version)).where(WorkflowVersion.workflow_id == row.id)
    ).one()
    return {
        "action": "publish",
        "workflow_id": row.id,
        "version": int(latest or 0) + 1,
        "node_count": len(graph.nodes),
        "edge_count": len(graph.edges),
    }


def _workflow_history_counts(session: Session, workflow_id: int) -> tuple[int, int]:
    version_count = session.exec(
        select(func.count()).select_from(WorkflowVersion).where(WorkflowVersion.workflow_id == workflow_id)
    ).one()
    run_count = session.exec(
        select(func.count()).select_from(WorkflowRun).where(WorkflowRun.workflow_id == workflow_id)
    ).one()
    return int(version_count), int(run_count)


def _delete_workflow(session: Session, payload: BaseModel, actor: str) -> Mutation:
    value = WorkflowDeleteInput.model_validate(payload)
    row = _workflow(session, value.workflow_id, value.base_revision)
    version_count, run_count = _workflow_history_counts(session, row.id)
    if version_count or run_count:
        raise HTTPException(
            status_code=409,
            detail="Published or executed workflows cannot be deleted because their history must remain readable",
        )
    peers = session.exec(
        select(ContextWorkflow)
        .where(ContextWorkflow.novel_id == row.novel_id, ContextWorkflow.purpose == row.purpose, ContextWorkflow.id != row.id)
        .order_by(ContextWorkflow.id.desc())
    ).all()
    binding = session.exec(select(WorkflowBinding).where(WorkflowBinding.novel_id == row.novel_id, WorkflowBinding.purpose == row.purpose)).first()
    before = {"workflow": _snapshot(row), "peer_rows": [_snapshot(peer) for peer in peers], "binding": _snapshot(binding) if binding else None}
    replacement = peers[0] if row.is_default and peers else None
    if replacement is not None:
        set_default(session, replacement)
        replacement.revision += 1
        replacement.updated_at = utc_now()
        session.add(replacement)
    elif binding is not None and binding.workflow_id == row.id:
        session.delete(binding)
    workflow_id = row.id
    novel_id = row.novel_id
    session.delete(row)
    session.flush()
    return Mutation(
        result={"workflow_id": workflow_id, "deleted": True, "replacement_default_id": replacement.id if replacement else None},
        novel_id=novel_id,
        target_type="workflow",
        target_id=workflow_id,
        before=before,
        after={},
        undo_kind="restore_deleted_workflow",
        event="workflow.deleted",
    )


def _preview_delete_workflow(session: Session, payload: BaseModel) -> dict[str, Any]:
    value = WorkflowDeleteInput.model_validate(payload)
    row = _workflow(session, value.workflow_id, value.base_revision)
    version_count, run_count = _workflow_history_counts(session, row.id)
    replacement = session.exec(
        select(ContextWorkflow)
        .where(ContextWorkflow.novel_id == row.novel_id, ContextWorkflow.purpose == row.purpose, ContextWorkflow.id != row.id)
        .order_by(ContextWorkflow.id.desc())
    ).first()
    return {
        "action": "delete",
        "workflow_id": row.id,
        "name": row.name,
        "revision": row.revision,
        "is_default": row.is_default,
        "published_versions": version_count,
        "runs": run_count,
        "blocked": bool(version_count or run_count),
        "replacement_default_id": replacement.id if row.is_default and replacement else None,
    }


def _restore_workflow_binding(
    session: Session,
    snapshot: dict[str, Any] | None,
    novel_id: int | None,
    purpose: str | None,
) -> None:
    if novel_id is None or not purpose:
        return
    current = session.exec(
        select(WorkflowBinding).where(
            WorkflowBinding.novel_id == novel_id,
            WorkflowBinding.purpose == purpose,
        )
    ).first()
    if snapshot is None:
        if current is not None:
            session.delete(current)
        return
    if current is None:
        session.add(WorkflowBinding.model_validate(snapshot))
        return
    current.workflow_id = snapshot["workflow_id"]
    current.updated_at = utc_now()
    session.add(current)


def undo_operation(session: Session, operation: Operation, actor: str) -> dict[str, Any]:
    if operation.undone_at is not None:
        return operation.result
    if operation.undo_kind == "none" or not operation.target_type or operation.target_id is None:
        raise HTTPException(status_code=409, detail="Operation cannot be undone")
    if operation.undo_kind == "delete_workflow_restore_defaults":
        row = session.get(ContextWorkflow, operation.target_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Undo target not found")
        session.delete(row)
        for snapshot in operation.before.get("default_rows", []):
            peer = session.get(ContextWorkflow, snapshot["id"])
            if peer is not None:
                peer.is_default = True
                peer.revision = snapshot["revision"]
                peer.updated_at = utc_now()
                session.add(peer)
        _restore_workflow_binding(session, operation.before.get("binding"), operation.before.get("novel_id"), operation.before.get("purpose"))
    elif operation.undo_kind == "delete_workflow_version":
        row = session.get(WorkflowVersion, operation.target_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Undo target not found")
        session.delete(row)
    elif operation.undo_kind == "restore_workflow_save":
        snapshot = operation.before.get("workflow", {})
        row = session.get(ContextWorkflow, operation.target_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Undo target not found")
        for field, value in snapshot.items():
            if field not in {"id", "created_at", "updated_at"} and hasattr(row, field):
                setattr(row, field, value)
        row.updated_at = utc_now()
        session.add(row)
        for peer_snapshot in operation.before.get("default_rows", []):
            peer = session.get(ContextWorkflow, peer_snapshot["id"])
            if peer is not None:
                peer.is_default = True
                peer.revision = peer_snapshot["revision"]
                peer.updated_at = utc_now()
                session.add(peer)
        _restore_workflow_binding(session, operation.before.get("binding"), row.novel_id, row.purpose)
    elif operation.undo_kind == "restore_workflow_defaults":
        for snapshot in operation.before.get("rows", []):
            row = session.get(ContextWorkflow, snapshot["id"])
            if row is None:
                continue
            row.is_default = snapshot["is_default"]
            row.revision = snapshot["revision"]
            row.updated_at = utc_now()
            session.add(row)
        _restore_workflow_binding(session, operation.before.get("binding"), operation.before.get("novel_id"), operation.before.get("purpose"))
    elif operation.undo_kind == "restore_deleted_workflow":
        snapshot = operation.before.get("workflow", {})
        if not snapshot or session.get(ContextWorkflow, operation.target_id) is not None:
            raise HTTPException(status_code=409, detail="Deleted workflow cannot be restored")
        ensure_unique_name(session, snapshot["name"], snapshot.get("novel_id"))
        row = ContextWorkflow.model_validate(snapshot)
        session.add(row)
        for peer_snapshot in operation.before.get("peer_rows", []):
            peer = session.get(ContextWorkflow, peer_snapshot["id"])
            if peer is None:
                continue
            peer.is_default = peer_snapshot["is_default"]
            peer.revision = peer_snapshot["revision"]
            peer.updated_at = utc_now()
            session.add(peer)
        _restore_workflow_binding(session, operation.before.get("binding"), row.novel_id, row.purpose)
    elif operation.target_type == "novel":
        row = session.get(Novel, operation.target_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Undo target not found")
        row.archived = True
        row.revision += 1
        row.updated_at = utc_now()
        session.add(row)
    else:
        model = ContextWorkflow if operation.target_type == "workflow" else ASSET_MODELS.get(operation.target_type)
        if model is None:
            raise HTTPException(status_code=409, detail="Undo target type is unsupported")
        row = session.get(model, operation.target_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Undo target not found")
        if operation.undo_kind == "retire":
            row.status = "retired"
            row.revision += 1
        elif operation.undo_kind == "restore":
            for field, value in operation.before.items():
                if field not in {"id", "created_at"} and hasattr(row, field):
                    setattr(row, field, value)
        row.updated_at = utc_now()
        session.add(row)
    operation.undone_at = utc_now()
    operation.status = "undone"
    session.add(operation)
    session.commit()
    return {"operation_id": operation.id, "status": "undone", "actor": actor}


def _register() -> None:
    specs = (
        CommandSpec("novel.create", "Create a novel and its mainline document", NovelCreateInput, "low", _create_novel, _preview_create_novel),
        CommandSpec("outline.create", "Create a volume, chapter or section", OutlineCreateInput, "low", _create_outline, _preview_outline),
        CommandSpec("document.update", "Create or update canonical Markdown", DocumentUpdateInput, "low", _update_document, _preview_document),
        CommandSpec("knowledge.create", "Create a character, world or research entry", KnowledgeCreateInput, "low", _create_knowledge, _preview_knowledge),
        CommandSpec("knowledge.approve", "Approve a draft knowledge entry for stable context", KnowledgeApproveInput, "low", _approve_knowledge, _preview_approve_knowledge),
        CommandSpec("fact.create", "Create an unapproved fact", FactCreateInput, "low", _create_fact, _preview_fact),
        CommandSpec("fact.approve", "Approve a fact for stable context", FactApproveInput, "high", _approve_fact, _preview_approve_fact),
        CommandSpec("asset.delete", "Retire an editable asset", AssetDeleteInput, "high", _retire_asset, _preview_retire),
        CommandSpec("workflow.rename", "Rename a saved workflow", WorkflowRenameInput, "low", _rename_workflow, _preview_rename_workflow),
        CommandSpec("workflow.set_default", "Set the default workflow in its scope", WorkflowSetDefaultInput, "low", _set_default_workflow, _preview_set_default_workflow),
        CommandSpec("workflow.create", "Create a validated workflow draft", WorkflowPayload, "low", _create_workflow, _preview_create_workflow),
        CommandSpec("workflow.save", "Save a validated workflow draft", WorkflowSaveInput, "low", _save_workflow, _preview_save_workflow),
        CommandSpec("workflow.publish", "Publish an immutable workflow version", WorkflowPublishInput, "low", _publish_workflow, _preview_publish_workflow),
        CommandSpec("workflow.delete", "Delete an unpublished workflow draft", WorkflowDeleteInput, "high", _delete_workflow, _preview_delete_workflow),
    )
    for spec in specs:
        try:
            registry.register(spec)
        except RuntimeError:
            pass


_register()
