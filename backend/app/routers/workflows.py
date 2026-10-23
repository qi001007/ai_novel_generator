"""HTTP adapter for workflow definitions and immutable versions."""

from datetime import datetime
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, func, select

from app.application.workflow_schema import (
    WorkflowGraph,
    WorkflowPayload,
    WorkflowUpdate,
)
from app.core.commands import registry as command_registry
from app.db import get_session
from app.models import ContextWorkflow, WorkflowVersion
from app.services.workflows import ensure_scope, list_for_scope

router = APIRouter(prefix="/workflows", tags=["workflows"])


class WorkflowOut(WorkflowPayload):
    id: int
    revision: int
    published_version: int | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(
        cls, row: ContextWorkflow, published_version: int | None = None,
    ) -> "WorkflowOut":
        return cls(
            id=row.id,
            revision=row.revision,
            published_version=published_version,
            name=row.name,
            novel_id=row.novel_id,
            purpose=row.purpose,
            is_default=row.is_default,
            graph=row.graph,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )


def _published_version(session: Session, workflow_id: int) -> int | None:
    latest = session.exec(
        select(func.max(WorkflowVersion.version)).where(
            WorkflowVersion.workflow_id == workflow_id
        )
    ).one()
    return int(latest) if latest is not None else None


def _saved_workflow(session: Session, workflow_id: int | None) -> WorkflowOut:
    row = session.get(ContextWorkflow, workflow_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return WorkflowOut.from_row(row, _published_version(session, row.id))


@router.get("", response_model=list[WorkflowOut])
def list_workflows(
    novel_id: int | None = Query(default=None, ge=1),
    session: Session = Depends(get_session),
) -> list[WorkflowOut]:
    ensure_scope(session, novel_id)
    rows = list_for_scope(session, novel_id)
    versions: dict[int, int] = {}
    if rows:
        versions = {
            workflow_id: int(version)
            for workflow_id, version in session.exec(
                select(WorkflowVersion.workflow_id, func.max(WorkflowVersion.version))
                .where(WorkflowVersion.workflow_id.in_([row.id for row in rows]))
                .group_by(WorkflowVersion.workflow_id)
            ).all()
        }
    return [
        WorkflowOut.from_row(row, versions.get(row.id)) for row in rows
    ]


@router.post("", response_model=WorkflowOut, status_code=201)
def create_workflow(
    payload: WorkflowPayload,
    session: Session = Depends(get_session),
) -> WorkflowOut:
    operation = command_registry.execute(
        session,
        "workflow.create",
        payload.model_dump(mode="json"),
        idempotency_key=f"legacy-workflow-create:{uuid.uuid4()}",
        actor="ui",
        approved=False,
    )
    return _saved_workflow(session, operation.target_id)


@router.get("/{workflow_id}", response_model=WorkflowOut)
def get_workflow(workflow_id: int, session: Session = Depends(get_session)) -> WorkflowOut:
    return _saved_workflow(session, workflow_id)


@router.put("/{workflow_id}", response_model=WorkflowOut)
def update_workflow(
    workflow_id: int,
    payload: WorkflowUpdate,
    session: Session = Depends(get_session),
) -> WorkflowOut:
    row = session.get(ContextWorkflow, workflow_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    changes = payload.model_dump(exclude_unset=True)
    command_payload = {
        "workflow_id": row.id,
        "base_revision": row.revision,
        "name": changes.get("name", row.name),
        "novel_id": row.novel_id,
        "purpose": row.purpose,
        "is_default": changes.get("is_default", row.is_default),
        "graph": changes.get("graph", row.graph),
    }
    operation = command_registry.execute(
        session,
        "workflow.save",
        command_payload,
        idempotency_key=f"legacy-workflow-save:{workflow_id}:{row.revision}:{uuid.uuid4()}",
        actor="ui",
        approved=False,
    )
    return _saved_workflow(session, operation.target_id)


@router.delete("/{workflow_id}", status_code=204)
def delete_workflow(workflow_id: int, session: Session = Depends(get_session)) -> None:
    row = session.get(ContextWorkflow, workflow_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    raise HTTPException(
        status_code=410,
        detail="Use workflow.delete preview and execute so confirmation, revision checks and undo are preserved",
    )


@router.post("/{workflow_id}/default", response_model=WorkflowOut)
def make_workflow_default(
    workflow_id: int,
    session: Session = Depends(get_session),
) -> WorkflowOut:
    row = session.get(ContextWorkflow, workflow_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    operation = command_registry.execute(
        session,
        "workflow.set_default",
        {"workflow_id": row.id, "base_revision": row.revision},
        idempotency_key=f"legacy-workflow-default:{row.id}:{row.revision}",
        actor="ui",
        approved=False,
    )
    return _saved_workflow(session, operation.target_id)


@router.post("/{workflow_id}/validate")
def validate_workflow(workflow_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    row = session.get(ContextWorkflow, workflow_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    graph = WorkflowGraph.model_validate(row.graph)
    try:
        graph.assert_publishable()
    except ValueError as cause:
        raise HTTPException(status_code=422, detail=str(cause)) from cause
    return {
        "valid": True,
        "workflow_id": row.id,
        "purpose": row.purpose,
        "node_count": len(graph.nodes),
        "edge_count": len(graph.edges),
    }


@router.post("/{workflow_id}/publish", status_code=201)
def publish_workflow(workflow_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    row = session.get(ContextWorkflow, workflow_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    operation = command_registry.execute(
        session,
        "workflow.publish",
        {"workflow_id": row.id, "base_revision": row.revision},
        idempotency_key=f"legacy-workflow-publish:{row.id}:{uuid.uuid4()}",
        actor="ui",
        approved=False,
    )
    return operation.result["workflow_version"]
