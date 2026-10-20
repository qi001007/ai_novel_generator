"""Start, inspect and resume immutable workflow runs."""

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlmodel import Session, select

from app.db import get_session
from app.models import ContextWorkflow, NodeRun, WorkflowRun, WorkflowVersion, utc_now
from app.services.workflow_engine import execute_workflow

router = APIRouter(tags=["workflow-runs"])


class WorkflowRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_id: int = Field(ge=1)
    novel_id: int | None = Field(default=None, ge=1)
    input: dict[str, Any] = Field(default_factory=dict)


class ResumeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["approved", "rejected"]
    comment: str = Field(default="", max_length=10000)


def _result(session: Session, run: WorkflowRun) -> dict[str, Any]:
    nodes = session.exec(
        select(NodeRun).where(NodeRun.workflow_run_id == run.id).order_by(NodeRun.id)
    ).all()
    return {
        **run.model_dump(mode="json"),
        "nodes": [node.model_dump(mode="json") for node in nodes],
    }


@router.post("/workflow-runs", status_code=201)
def start_workflow(body: WorkflowRunRequest, session: Session = Depends(get_session)) -> dict[str, Any]:
    workflow = session.get(ContextWorkflow, body.workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if body.novel_id is not None and workflow.novel_id not in {None, body.novel_id}:
        raise HTTPException(status_code=409, detail="Workflow belongs to another novel")
    latest = session.exec(
        select(WorkflowVersion).where(WorkflowVersion.workflow_id == body.workflow_id).order_by(WorkflowVersion.version.desc())
    ).first()
    if latest is None:
        raise HTTPException(status_code=409, detail="Workflow must be published before it can run")
    run = WorkflowRun(
        novel_id=body.novel_id,
        workflow_id=workflow.id,
        workflow_version_id=latest.id,
        input={**body.input, "workflow_purpose": latest.purpose},
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    execute_workflow(session, run)
    return _result(session, session.get(WorkflowRun, run.id))


@router.get("/workflow-runs/{run_id}")
def get_workflow_run(run_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    run = session.get(WorkflowRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    return _result(session, run)


@router.post("/workflow-runs/{run_id}/resume")
def resume_workflow(run_id: int, body: ResumeRequest, session: Session = Depends(get_session)) -> dict[str, Any]:
    run = session.get(WorkflowRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    if run.status != "paused" or not run.paused_node_id:
        raise HTTPException(status_code=409, detail="Workflow run is not awaiting approval")
    node = session.exec(
        select(NodeRun).where(
            NodeRun.workflow_run_id == run.id,
            NodeRun.node_id == run.paused_node_id,
            NodeRun.status == "paused",
        )
    ).first()
    if node is None:
        raise HTTPException(status_code=409, detail="Paused node record not found")
    node.output = {"decision": body.decision, "comment": body.comment}
    node.ended_at = utc_now()
    if body.decision == "rejected":
        node.status = "completed"
        run.status = "cancelled"
        run.output = {"approval": node.output}
        run.paused_node_id = ""
        run.ended_at = utc_now()
        session.add(node)
        session.add(run)
        session.commit()
        return _result(session, run)
    node.status = "completed"
    run.paused_node_id = ""
    session.add(node)
    session.add(run)
    session.commit()
    execute_workflow(session, run)
    return _result(session, session.get(WorkflowRun, run.id))
