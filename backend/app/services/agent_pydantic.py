"""The framework-owned loop bridge for the Pydantic AI engine."""

from __future__ import annotations

import asyncio
import queue
import threading
from collections.abc import Iterator
from typing import Any

from pydantic_ai import (
    Agent,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ModelRequest,
    ModelResponse,
    PartDeltaEvent,
    PartStartEvent,
    SystemPromptPart,
    UsageLimitExceeded,
    UserPromptPart,
    TextPart,
)
from pydantic_ai.usage import UsageLimits

from app.services.agent import (
    AgentBudgetError,
    AgentConfig,
    AgentOutcome,
    AgentStep,
    ToolCall,
    ToolRegistry,
    ToolResult,
)
from app.services.agent_model import GatewayChatModel
from app.services.agent_tools import framework_tools_from_registry


def _message_content(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        import json

        return json.dumps(value, ensure_ascii=False)
    return "\n".join(str(item) for item in value)


def to_framework_messages(messages: list[dict[str, str]]) -> list[ModelRequest | ModelResponse]:
    """Build one framework message per prepared turn; never use framework history."""
    framework: list[ModelRequest | ModelResponse] = []
    for item in messages:
        role = item.get("role")
        content = item.get("content", "")
        if role == "assistant":
            framework.append(ModelResponse([TextPart(content=content)]))
        elif role == "system":
            framework.append(ModelRequest([SystemPromptPart(content=content)]))
        else:
            framework.append(ModelRequest([UserPromptPart(content=content)]))
    return framework


def _step_from_event(
    event: FunctionToolResultEvent, pending: dict[str, FunctionToolCallEvent], index: int
) -> AgentStep | None:
    part = event.part
    call_event = pending.pop(part.tool_call_id, None)
    if call_event is None:
        return None
    call = ToolCall(name=call_event.part.tool_name, arguments=call_event.part.args or {})
    content = _message_content(part.content)
    ok = getattr(part, "outcome", "success") == "success"
    return AgentStep(index=index, call=call, result=ToolResult(call=call, content=content, ok=ok))


def _event_consumer(
    sink: list[AgentStep],
) -> Any:
    async def handler(_context: Any, stream: Any) -> None:
        pending: dict[str, FunctionToolCallEvent] = {}
        index = 0
        async for event in stream:
            if isinstance(event, FunctionToolCallEvent):
                pending[event.part.tool_call_id] = event
            elif isinstance(event, FunctionToolResultEvent):
                step = _step_from_event(event, pending, index + 1)
                if step is not None:
                    index += 1
                    sink.append(step)

    return handler


def _limits(config: AgentConfig | None) -> UsageLimits:
    limits = config or AgentConfig()
    return UsageLimits(request_limit=limits.max_steps, total_tokens_limit=limits.max_tokens)


def _agent(
    llm: Any,
    *,
    task_type: str,
    model: Any,
    temperature: float,
    framework_tools: list[Any] | None,
    ) -> Agent:
    agent = Agent(
        model or GatewayChatModel(llm, task_type=task_type),
        tools=framework_tools or [],
        model_settings={"temperature": temperature},
        retries=0,
    )
    agent.instrument = False
    return agent


def _result_outcome(result: Any, steps: list[AgentStep], model_name: str | None) -> AgentOutcome:
    usage = result.usage
    resolved_model = model_name or ""
    responses = [message for message in result.all_messages() if isinstance(message, ModelResponse)]
    for response in responses:
        if response.model_name:
            resolved_model = response.model_name
    return AgentOutcome(
        content=result.output.strip(),
        steps=steps,
        token_input=int(getattr(usage, "input_tokens", 0)),
        token_output=int(getattr(usage, "output_tokens", 0)),
        model=resolved_model,
    )


def run_pydantic_agent_turn(
    llm: Any,
    messages: list[dict[str, str]],
    registry: ToolRegistry,
    *,
    task_type: str = "chat",
    model: str | Any | None = None,
    temperature: float = 0.2,
    config: AgentConfig | None = None,
    framework_tools: list[Any] | None = None,
    **_: Any,
) -> AgentOutcome:
    """Run the framework loop without streaming, with the same event contract."""
    framework_tools = framework_tools or framework_tools_from_registry(registry)
    steps: list[AgentStep] = []
    handler = _event_consumer(steps)
    agent = _agent(
        llm,
        task_type=task_type,
        model=model,
        temperature=temperature,
        framework_tools=framework_tools,
    )
    try:
        result = agent.run_sync(
            None,
            message_history=to_framework_messages(messages),
            usage_limits=_limits(config),
            event_stream_handler=handler,
        )
    except UsageLimitExceeded as cause:
        trail = "; ".join(step.as_line() for step in steps)
        raise AgentBudgetError(
            f"本轮预算已用完：{cause}. 已执行：{trail or '（无）'}"
        ) from cause
    return _result_outcome(result, steps, model if isinstance(model, str) else None)


def stream_pydantic_agent_turn(
    llm: Any,
    messages: list[dict[str, str]],
    registry: ToolRegistry,
    *,
    task_type: str = "chat",
    model: str | Any | None = None,
    temperature: float = 0.2,
    config: AgentConfig | None = None,
    reasoning_out: list[str] | None = None,
    framework_tools: list[Any] | None = None,
) -> Iterator[tuple[str, Any]]:
    """Yield the legacy event tuple from a background framework event loop."""
    framework_tools = framework_tools or framework_tools_from_registry(registry)
    events: queue.Queue[tuple[str, Any] | tuple[str, None] | tuple[str, BaseException]] = queue.Queue()
    steps: list[AgentStep] = []

    async def drive() -> None:
        pending: dict[str, FunctionToolCallEvent] = {}
        step_index = 0

        async def handler(_context: Any, stream: Any) -> None:
            nonlocal step_index
            async for event in stream:
                if isinstance(event, PartStartEvent):
                    part = event.part
                    kind = getattr(part, "part_kind", "")
                    if kind == "thinking" and part.content:
                        events.put(("reasoning", part.content))
                    elif kind == "text" and part.content:
                        events.put(("delta", part.content))
                elif isinstance(event, PartDeltaEvent):
                    delta = event.delta
                    kind = getattr(delta, "part_delta_kind", "")
                    if kind == "thinking" and delta.content_delta:
                        events.put(("reasoning", delta.content_delta))
                    elif kind == "text" and delta.content_delta:
                        events.put(("delta", delta.content_delta))
                elif isinstance(event, FunctionToolCallEvent):
                    pending[event.part.tool_call_id] = event
                elif isinstance(event, FunctionToolResultEvent):
                    step = _step_from_event(event, pending, step_index + 1)
                    if step is not None:
                        step_index += 1
                        steps.append(step)
                        events.put(("tool", step))

        agent = _agent(
            llm,
            task_type=task_type,
            model=model,
            temperature=temperature,
            framework_tools=framework_tools,
        )
        try:
            result = await agent.run(
                None,
                message_history=to_framework_messages(messages),
                usage_limits=_limits(config),
                event_stream_handler=handler,
            )
        except BaseException as cause:
            events.put(("error", cause))
            return
        events.put(("final", _result_outcome(result, steps, model if isinstance(model, str) else None)))
        events.put(("done", None))

    def runner() -> None:
        try:
            asyncio.run(drive())
        except BaseException as cause:
            events.put(("error", cause))
        finally:
            events.put(("done", None))

    thread = threading.Thread(target=runner, name="novel-agent-pydantic", daemon=True)
    thread.start()
    error: BaseException | None = None
    seen_steps = 0
    reasoning_breaks = 0
    while True:
        name, payload = events.get()
        if name == "done":
            break
        if name == "error":
            error = payload
            continue
        if name == "tool":
            seen_steps += 1
        if name == "reasoning" and reasoning_out is not None:
            if reasoning_out and seen_steps > reasoning_breaks:
                reasoning_out.append("\n\n")
                reasoning_breaks = seen_steps
            reasoning_out.append(str(payload))
        yield name, payload
    thread.join()
    if error is not None:
        if isinstance(error, UsageLimitExceeded):
            trail = "; ".join(step.as_line() for step in steps)
            raise AgentBudgetError(f"本轮预算已用完：{error}. 已执行：{trail or '（无）'}") from error
        if isinstance(error, Exception):
            raise error
        raise error
