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
from pydantic_ai.usage import RunUsage, UsageLimits

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
    event: FunctionToolResultEvent,
    pending: dict[str, FunctionToolCallEvent],
    timings: dict[str, int],
    index: int,
) -> AgentStep | None:
    part = event.part
    call_event = pending.pop(part.tool_call_id, None)
    if call_event is None:
        return None
    call = ToolCall(name=call_event.part.tool_name, arguments=call_event.part.args or {})
    content = _message_content(part.content)
    ok = getattr(part, "outcome", "success") == "success"
    return AgentStep(
        index=index,
        call=call,
        result=ToolResult(call=call, content=content, ok=ok),
        ms=timings.pop(part.tool_call_id, 0),
    )


def _event_consumer(sink: list[AgentStep], timings: dict[str, int]) -> Any:
    async def handler(_context: Any, stream: Any) -> None:
        # The handler runs once per model request, so the step number is read off the
        # turn's own list - a counter kept in here would restart at 1 on every round.
        pending: dict[str, FunctionToolCallEvent] = {}
        async for event in stream:
            if isinstance(event, FunctionToolCallEvent):
                pending[event.part.tool_call_id] = event
            elif isinstance(event, FunctionToolResultEvent):
                step = _step_from_event(event, pending, timings, len(sink) + 1)
                if step is not None:
                    sink.append(step)

    return handler


class BudgetGate(UsageLimits):
    """The framework's own limits, with a memory.

    It decides nothing: every check still runs the framework's method and raises there.
    It only keeps the usage the framework showed it and which gate fired, so the sentence
    the owner reads can name the step it stopped at and what it cost (6.5 step 2) without a
    second hand-written gate standing beside the framework's.
    """

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.usage = RunUsage()
        self.gate = ""

    def check_before_request(self, usage: RunUsage) -> None:
        self.usage = usage
        try:
            super().check_before_request(usage)
        except UsageLimitExceeded:
            self.gate = "request"
            raise

    def check_tokens(self, usage: RunUsage) -> None:
        self.usage = usage
        try:
            super().check_tokens(usage)
        except UsageLimitExceeded:
            self.gate = "token"
            raise


def _limits(config: AgentConfig | None) -> BudgetGate:
    """Two gates, both the framework's.

    Deliberately not `tool_calls_limit`: it counts only calls that came back successful, so
    a model that keeps failing at the same call never runs into it and keeps burning requests.
    """
    limits = config or AgentConfig()
    return BudgetGate(request_limit=limits.max_steps, total_tokens_limit=limits.max_tokens)


def _budget_error(gate: BudgetGate, steps: list[AgentStep]) -> AgentBudgetError:
    """Where it stopped, what it cost, and what it did on the way there."""
    usage = gate.usage
    spent = usage.input_tokens + usage.output_tokens
    # 一个词一个意思（真机量出来的：模型一轮里可以并行要 10 步工具）：
    # 「轮」= 一次模型请求，「步」= 一次工具调用，和界面轨迹里的「第 N 步」同一个意思。
    if gate.gate == "request":
        reason = f"到了 {gate.request_limit} 轮上限，第 {usage.requests + 1} 轮仍在要求调用工具"
    else:
        reason = f"第 {usage.requests} 轮回来时已用 {spent} token，过了 {gate.total_tokens_limit} 的上限"
    trail = "; ".join(step.as_line() for step in steps)
    return AgentBudgetError(
        f"本轮已停止：{reason}。已花 {spent} token（输入 {usage.input_tokens} / 输出 {usage.output_tokens}）、"
        f"跑了 {len(steps)} 步工具调用。已执行：{trail or '（无）'}"
    )


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
    timings: dict[str, int] = {}
    framework_tools = framework_tools or framework_tools_from_registry(registry, timings)
    steps: list[AgentStep] = []
    handler = _event_consumer(steps, timings)
    gate = _limits(config)
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
            usage_limits=gate,
            event_stream_handler=handler,
        )
    except UsageLimitExceeded as cause:
        raise _budget_error(gate, steps) from cause
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
    timings: dict[str, int] = {}
    framework_tools = framework_tools or framework_tools_from_registry(registry, timings)
    events: queue.Queue[tuple[str, Any] | tuple[str, None] | tuple[str, BaseException]] = queue.Queue()
    steps: list[AgentStep] = []
    gate = _limits(config)

    async def drive() -> None:
        pending: dict[str, FunctionToolCallEvent] = {}

        async def handler(_context: Any, stream: Any) -> None:
            # Same reason as _event_consumer: 第 N 步 is the Nth tool call of the turn.
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
                    step = _step_from_event(event, pending, timings, len(steps) + 1)
                    if step is not None:
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
                usage_limits=gate,
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
            raise _budget_error(gate, steps) from error
        if isinstance(error, Exception):
            raise error
        raise error
