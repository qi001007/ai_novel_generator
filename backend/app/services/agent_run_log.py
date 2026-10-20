"""Durable audit records shared by launcher and workbench Agent entrypoints."""

from __future__ import annotations

import json
from typing import Any

from sqlmodel import Session, select

from app.models import AgentRun, ToolCall as StoredToolCall, utc_now
from app.services.agent import AgentStep


def decode_result(content: str) -> dict[str, Any]:
    try:
        value = json.loads(content)
    except (TypeError, ValueError):
        return {"raw": content}
    return value if isinstance(value, dict) else {"value": value}


def run_output(session: Session, run: AgentRun) -> dict[str, Any]:
    calls = session.exec(
        select(StoredToolCall)
        .where(StoredToolCall.agent_run_id == run.id)
        .order_by(StoredToolCall.id)
    ).all()
    return {
        **run.model_dump(mode="json"),
        "tool_calls": [call.model_dump(mode="json") for call in calls],
    }


def create_run(session: Session, *, novel_id: int | None, request: str) -> AgentRun:
    run = AgentRun(novel_id=novel_id, request=request.strip())
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def persist_step(session: Session, run: AgentRun, step: AgentStep) -> StoredToolCall:
    payload = decode_result(step.result.content)
    operation = payload.get("operation") if isinstance(payload.get("operation"), dict) else {}
    pending = payload.get("state") == "confirmation_required"
    row = StoredToolCall(
        agent_run_id=run.id,
        novel_id=run.novel_id,
        operation_id=operation.get("id"),
        tool_name=step.call.name,
        arguments=step.call.arguments,
        result=payload,
        status="pending" if pending else ("completed" if step.result.ok else "failed"),
        approval_state="pending" if pending else "not_required",
    )
    session.add(row)
    created_novel_id = operation.get("novel_id")
    if run.novel_id is None and isinstance(created_novel_id, int):
        run.novel_id = created_novel_id
        session.add(run)
    session.commit()
    session.refresh(row)
    return row


def finish_run(
    session: Session,
    run: AgentRun,
    *,
    response: str,
    model: str,
    token_input: int,
    token_output: int,
) -> AgentRun:
    pending = session.exec(
        select(StoredToolCall).where(
            StoredToolCall.agent_run_id == run.id,
            StoredToolCall.approval_state == "pending",
        )
    ).first()
    run.response = response
    run.model = model
    run.token_input = token_input
    run.token_output = token_output
    run.status = "awaiting_approval" if pending is not None else "completed"
    run.updated_at = utc_now()
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def fail_run(session: Session, run: AgentRun, error: str) -> AgentRun:
    run.status = "failed"
    run.error = error
    run.updated_at = utc_now()
    session.add(run)
    session.commit()
    session.refresh(run)
    return run
