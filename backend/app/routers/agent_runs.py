"""Durable natural-language platform operator, available before a novel exists."""

from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.engine import Engine
from sqlmodel import Session

from app.core.commands import registry as command_registry
from app.db import get_session
from app.models import AgentRun, Novel, ToolCall as StoredToolCall, utc_now
from app.services.agent import AgentBudgetError, resolve_config, run_agent_turn
from app.services.agent_run_log import create_run, fail_run, finish_run, persist_step, run_output
from app.services.agent_tools import build_registry
from app.services.llm import LLMClient, LLMError, LLMUnavailableError, get_llm_client


router = APIRouter(prefix="/agent/runs", tags=["agent-runs"])


class AgentRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=100_000)
    novel_id: int | None = Field(default=None, ge=1)
    model: str | None = None


class AgentResume(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_call_id: int = Field(ge=1)
    decision: Literal["approved", "rejected"]


def _system_prompt(novel_id: int | None) -> str:
    scope = (
        f"当前作品 ID 是 {novel_id}。涉及这本书的函数必须显式传这个 novel_id。"
        if novel_id is not None
        else "当前在作品启动页。先读取作品列表；需要新作品时直接调用 novel.create。"
    )
    return f"""你是小说工作台的内置平台 Agent，不是只给建议的聊天机器人。
主人要求创建、修改、整理或查询平台内容时，优先调用后端工具完成，再报告结果。
页面按钮、你和 Workflow 使用同一函数目录；不要假装点击页面，不要声称执行未发生的操作。
低风险命令可以直接执行。高风险命令返回待确认差异后必须停止，等待主人批准或拒绝。
每个不同意图使用稳定且不同的幂等键；工具失败时按回执的 next_actions 修正一次，仍失败就说明阻塞。
{scope}
回答简洁，列出实际创建或修改的对象与 ID。"""


@router.post("", status_code=201)
def create_agent_run(
    payload: AgentRunCreate,
    session: Session = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
) -> dict[str, Any]:
    if payload.novel_id is not None:
        novel = session.get(Novel, payload.novel_id)
        if novel is None or novel.archived:
            raise HTTPException(status_code=404, detail="Novel not found")
    run = create_run(session, novel_id=payload.novel_id, request=payload.content)
    bind: Engine = session.get_bind()
    tools = build_registry(lambda: Session(bind), payload.novel_id)
    messages = [
        {"role": "system", "content": _system_prompt(payload.novel_id)},
        {"role": "user", "content": payload.content.strip()},
    ]
    try:
        outcome = run_agent_turn(
            llm,
            messages,
            tools,
            task_type="chat",
            model=payload.model,
            temperature=0.2,
            config=resolve_config(session),
        )
    except (LLMError, LLMUnavailableError, AgentBudgetError) as cause:
        fail_run(session, run, str(cause))
        return run_output(session, run)

    for step in outcome.steps:
        persist_step(session, run, step)
    finish_run(
        session,
        run,
        response=outcome.content,
        model=outcome.model,
        token_input=outcome.token_input,
        token_output=outcome.token_output,
    )
    return run_output(session, run)


@router.get("/{run_id}")
def get_agent_run(run_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    run = session.get(AgentRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Agent run not found")
    return run_output(session, run)


@router.post("/{run_id}/resume")
def resume_agent_run(
    run_id: int,
    payload: AgentResume,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    run = session.get(AgentRun, run_id)
    call = session.get(StoredToolCall, payload.tool_call_id)
    if run is None or call is None or call.agent_run_id != run.id:
        raise HTTPException(status_code=404, detail="Pending tool call not found")
    if call.approval_state != "pending":
        return run_output(session, run)
    if payload.decision == "rejected":
        call.status = "rejected"
        call.approval_state = "rejected"
        run.status = "rejected"
        run.response = (run.response + "\n\n已按主人的决定拒绝该操作。").strip()
        run.updated_at = utc_now()
        session.add(call)
        session.add(run)
        session.commit()
        return run_output(session, run)

    name = str(call.arguments.get("name", ""))
    raw_payload = call.arguments.get("payload", "{}")
    try:
        command_payload = json.loads(raw_payload) if isinstance(raw_payload, str) else raw_payload
    except ValueError as cause:
        raise HTTPException(status_code=422, detail="Stored command payload is invalid") from cause
    if not isinstance(command_payload, dict):
        raise HTTPException(status_code=422, detail="Stored command payload must be an object")
    operation = command_registry.execute(
        session,
        name,
        command_payload,
        idempotency_key=str(call.arguments.get("idempotency_key", "")),
        actor="agent",
        approved=True,
    )
    call.operation_id = operation.id
    call.status = "completed"
    call.approval_state = "approved"
    call.result = {
        "status": "success",
        "summary": f"已批准并执行 {name}",
        "next_actions": [],
        "artifacts": {"operation_id": operation.id},
        "operation": operation.model_dump(mode="json"),
    }
    run.status = "completed"
    run.response = (run.response + f"\n\n主人已批准，操作 {name} 已执行。").strip()
    run.updated_at = utc_now()
    session.add(call)
    session.add(run)
    session.commit()
    return run_output(session, run)
