"""Start, inspect and resume immutable workflow runs."""

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlmodel import Session, select

from app.db import get_session
from app.models import (
    Chapter,
    ContextWorkflow,
    GenerationJob,
    NodeRun,
    Operation,
    Review,
    TocEntry,
    WorkflowRun,
    WorkflowVersion,
    utc_now,
)
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


def _chapter_or_404(session: Session, novel_id: int, chapter_id: int) -> Chapter:
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or chapter.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return chapter


def _chapter_runs(session: Session, novel_id: int, chapter_id: int) -> list[WorkflowRun]:
    runs = session.exec(
        select(WorkflowRun).where(WorkflowRun.novel_id == novel_id).order_by(WorkflowRun.id)
    ).all()
    return [run for run in runs if (run.input or {}).get("chapter_id") == chapter_id]


def _linked_rows(
    session: Session, novel_id: int, chapter_id: int, runs: list[WorkflowRun],
):
    """One query per linked table, keyed by workflow run id."""
    run_ids = {run.id for run in runs}
    nodes: dict[int, list[NodeRun]] = {}
    jobs: dict[int, GenerationJob] = {}
    reviews: dict[int, list[Review]] = {}
    operations: dict[int, Operation] = {}
    if not run_ids:
        return nodes, jobs, reviews, operations
    for node in session.exec(
        select(NodeRun).where(NodeRun.workflow_run_id.in_(run_ids)).order_by(NodeRun.id)
    ).all():
        nodes.setdefault(node.workflow_run_id, []).append(node)
    for job in session.exec(select(GenerationJob).where(GenerationJob.novel_id == novel_id)).all():
        run_id = (job.result or {}).get("workflow_run_id")
        if run_id in run_ids:
            jobs[run_id] = job
    for review in session.exec(
        select(Review).where(Review.novel_id == novel_id, Review.chapter_id == chapter_id)
    ).all():
        run_id = (review.evidence or {}).get("workflow_run_id")
        if run_id in run_ids:
            reviews.setdefault(run_id, []).append(review)
    for operation in session.exec(
        select(Operation).where(
            Operation.novel_id == novel_id, Operation.command == "generation.accept",
        )
    ).all():
        run_id = (operation.result or {}).get("workflow_run_id")
        if run_id in run_ids:
            operations[run_id] = operation
    return nodes, jobs, reviews, operations


def _accept_operation(operation: Operation | None) -> dict[str, Any] | None:
    if operation is None:
        return None
    write = (operation.result or {}).get("write_result") or {}
    before = operation.before or {}
    after = operation.after or {}
    return {
        "id": operation.id,
        "command": operation.command,
        "actor": operation.actor,
        "created_at": operation.created_at,
        "target_id": operation.target_id,
        "path": write.get("path") or before.get("path") or after.get("path") or "",
        "revision": write.get("revision") or after.get("revision") or "",
    }


def _review_link(review: Review | None) -> dict[str, Any] | None:
    if review is None:
        return None
    return {"id": review.id, "decision": review.decision, "reviewer": review.reviewer}


def _run_summary(
    session: Session,
    run: WorkflowRun,
    nodes: list[NodeRun],
    job: GenerationJob | None,
    reviews: list[Review],
    operation: Operation | None,
) -> dict[str, Any]:
    workflow = session.get(ContextWorkflow, run.workflow_id)
    version = session.get(WorkflowVersion, run.workflow_version_id)
    model_node = next((node for node in nodes if node.node_type == "model"), None)
    return {
        **run.model_dump(mode="json", exclude={"output"}),
        "workflow_name": workflow.name if workflow else "",
        "workflow_version": version.version if version else None,
        "purpose": (run.input or {}).get("workflow_purpose")
        or (version.purpose if version else ""),
        "node_count": len(nodes),
        "model": str((model_node.output or {}).get("model") or "") if model_node else "",
        "job": {"id": job.id, "status": job.status} if job else None,
        "review": _review_link(reviews[-1]) if reviews else None,
        "accept_operation": _accept_operation(operation),
    }


def _chapter_title(session: Session, novel_id: int, chapter: Chapter) -> str:
    toc = session.exec(
        select(TocEntry).where(
            TocEntry.novel_id == novel_id,
            TocEntry.chapter_number == chapter.chapter_number,
            TocEntry.is_active == True,  # noqa: E712
        )
    ).first()
    return toc.title if toc else chapter.title


def _run_detail(session: Session, run: WorkflowRun) -> dict[str, Any]:
    chapter_id = int((run.input or {}).get("chapter_id") or 0)
    nodes, jobs, reviews, operations = _linked_rows(session, run.novel_id, chapter_id, [run])
    data = _result(session, run)
    workflow = session.get(ContextWorkflow, run.workflow_id)
    version = session.get(WorkflowVersion, run.workflow_version_id)
    chapter = session.get(Chapter, chapter_id) if chapter_id else None
    if chapter is not None and chapter.novel_id != run.novel_id:
        chapter = None
    data["workflow"] = {
        "id": run.workflow_id,
        "name": workflow.name if workflow else "",
        "purpose": workflow.purpose if workflow else "",
    }
    data["version"] = {
        "id": run.workflow_version_id,
        "version": version.version if version else None,
        "purpose": version.purpose if version else "",
    }
    data["chapter"] = (
        {
            "id": chapter.id,
            "chapter_number": chapter.chapter_number,
            "title": _chapter_title(session, run.novel_id, chapter),
        }
        if chapter else None
    )
    data["job"] = (
        {"id": jobs[run.id].id, "status": jobs[run.id].status} if run.id in jobs else None
    )
    data["reviews"] = [
        {
            "id": item.id,
            "decision": item.decision,
            "reviewer": item.reviewer,
            "comments": item.comments,
            "evidence": item.evidence,
            "created_at": item.created_at,
        }
        for item in reviews.get(run.id, [])
    ]
    data["accept_operation"] = _accept_operation(operations.get(run.id))
    return data


@router.get("/novels/{novel_id}/chapters/{chapter_id}/workflow-runs")
def list_chapter_workflow_runs(
    novel_id: int, chapter_id: int, session: Session = Depends(get_session),
) -> list[dict[str, Any]]:
    _chapter_or_404(session, novel_id, chapter_id)
    runs = _chapter_runs(session, novel_id, chapter_id)
    nodes, jobs, reviews, operations = _linked_rows(session, novel_id, chapter_id, runs)
    return [
        _run_summary(
            session, run, nodes.get(run.id, []), jobs.get(run.id),
            reviews.get(run.id, []), operations.get(run.id),
        )
        for run in runs
    ]


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
    return _run_detail(session, run)


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
