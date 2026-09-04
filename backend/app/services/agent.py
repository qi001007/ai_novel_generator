"""Tool registry + the reply protocol + the step budget.

Why a text protocol instead of OpenAI `tools`: this deployment's gateway answers
with `finish_reason: stop` and no `tool_calls` field at all, and puts a vendor
private XML block in `content` when it wants a tool (measured 2026-09-04). A loop
built on the native channel would never fire and would leak that XML into the
chat body. So the prompt asks for a marker we own; a real `tool_calls` array is
still honoured when some other gateway sends one.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Iterator


class ToolError(RuntimeError):
    """A tool refused or failed. The text reaches the model, so keep it plain."""


class AgentBudgetError(RuntimeError):
    """The turn hit its step or token ceiling. Raised, never silently truncated."""


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., str]

    def signature(self) -> str:
        args = ", ".join(
            f"{name}:{spec.get('type', 'string')}"
            for name, spec in self.parameters.get("properties", {}).items()
        )
        return f"{self.name}({args}) - {self.description}"


@dataclass(frozen=True)
class ToolCall:
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ToolResult:
    call: ToolCall
    content: str
    ok: bool = True


class ToolRegistry:
    """Name to Tool, plus the two ways a call can arrive in a reply."""

    def __init__(self, tools: Iterable[Tool] = ()) -> None:
        self._tools = {tool.name: tool for tool in tools}

    def names(self) -> list[str]:
        return sorted(self._tools)

    def __len__(self) -> int:
        return len(self._tools)

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def specs(self) -> list[dict[str, Any]]:
        """OpenAI-shaped declarations, for gateways that accept `tools`."""
        return [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                },
            }
            for tool in (self._tools[name] for name in self.names())
        ]

    def catalogue(self) -> str:
        return "\n".join(self._tools[name].signature() for name in self.names())

    def run(self, call: ToolCall) -> ToolResult:
        if not call.name:
            # The reader never sees the block either way; the model does need to
            # learn that its own call was unreadable, or it will answer blind.
            return ToolResult(
                call=call,
                content="上一个 tool 块里的 JSON 读不出来。只放 {\"name\": 工具名, \"arguments\": {参数}}，不要加注释或多余文字。",
                ok=False,
            )
        tool = self.get(call.name)
        if tool is None:
            options = ", ".join(self.names()) or "（无）"
            return ToolResult(call=call, content=f"没有这个工具：{call.name}。可用的是 {options}", ok=False)
        try:
            return ToolResult(call=call, content=str(tool.handler(**call.arguments)))
        except ToolError as cause:
            return ToolResult(call=call, content=str(cause), ok=False)
        except TypeError as cause:
            table = json.dumps(tool.parameters, ensure_ascii=False)
            return ToolResult(call=call, content=f"{call.name} 的参数不对：{cause}。参数表 {table}", ok=False)
# --- how a call arrives in a reply -----------------------------------------

# Same family as the proposal fence in services/chat.py: a block the reader can
# see and a parser can find, instead of a channel this gateway does not have.
CALL_BLOCK = re.compile(r"```[ \t]*tool[ \t]*\n(?P<body>.*?)\n[ \t]*```", re.S)

# What a streamed tool block starts with. While the tail of the text on screen could
# still become one of these, that tail is held back instead of shown: the reader must
# never watch our control tokens scroll past.
FENCE = chr(96) * 3
CALL_OPENERS = (FENCE + "tool", FENCE + " tool", FENCE + "  tool")
HOLDBACK_LIMIT = max(len(opener) for opener in CALL_OPENERS)


def holdback_len(text: str) -> int:
    """How many trailing characters cannot be released yet."""
    for size in range(min(len(text), HOLDBACK_LIMIT), 0, -1):
        tail = text[-size:]
        if any(opener.startswith(tail) for opener in CALL_OPENERS):
            return size
    return 0


def releasable_len(text: str) -> int:
    """How much of a partially streamed reply is safe to put on screen.

    Guarding only the opener is not enough: once the marker has streamed past, its
    body would follow it. So anything from an unclosed fence onwards waits, and a
    closed fence (a proposal block, which is meant to be readable) releases.
    """
    start = text.find(FENCE)
    if start != -1 and text.find(FENCE, start + len(FENCE)) == -1:
        return start
    return len(text) - holdback_len(text)

ARGUMENT_KEYS = ("arguments", "params", "input", "args")


def _coerce_arguments(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value or "{}")
        except ValueError:
            raise ToolError("工具调用的 arguments 不是合法 JSON 对象")
        if isinstance(parsed, dict):
            return parsed
    raise ToolError("工具调用缺少 arguments 对象")


def parse_call_blocks(text: str) -> tuple[str, list[ToolCall]]:
    """Split a reply into what the reader sees and what the loop must execute."""
    calls: list[ToolCall] = []
    for match in CALL_BLOCK.finditer(text or ""):
        try:
            payload = json.loads(match.group("body"))
        except ValueError:
            calls.append(ToolCall(name="", arguments={}))
            continue
        if not isinstance(payload, dict) or not payload.get("name"):
            calls.append(ToolCall(name="", arguments={}))
            continue
        try:
            arguments = _coerce_arguments(
                next((payload[key] for key in ARGUMENT_KEYS if key in payload), {})
            )
        except ToolError:
            calls.append(ToolCall(name="", arguments={}))
            continue
        calls.append(ToolCall(name=str(payload["name"]), arguments=arguments))

    visible = CALL_BLOCK.sub("", text or "").strip()
    return visible, calls


def parse_native_calls(message: dict[str, Any]) -> list[ToolCall]:
    """Honour a real `tool_calls` array when a gateway does send one."""
    calls: list[ToolCall] = []
    for raw in message.get("tool_calls") or []:
        function = raw.get("function") if isinstance(raw, dict) else None
        if not isinstance(function, dict) or not function.get("name"):
            continue
        try:
            arguments = _coerce_arguments(function.get("arguments", {}))
        except ToolError:
            continue
        calls.append(ToolCall(name=str(function["name"]), arguments=arguments))
    return calls


# --- what the model is told -------------------------------------------------

TOOL_RULES = """

## 用工具，别猜
你可以调用工具拿真实资料。需要调用时，单独输出一个 tool 代码块，一次可以要多个：

```tool
{"name": "工具名", "arguments": {"参数名": "参数值"}}
```

规则：
1. 工具块里只放 JSON，不要写注释，也不要在块里放文件正文。
2. 拿不准就先查再答：涉及本书已有规划、人物、伏笔的事实，用工具读，不要凭印象复述。
3. 需要外部资料（现实制度、地名、典故、科学事实）时用 web_search，不要用你的记忆冒充查证结果。
4. 查回来的内容如果和主人已有设定冲突，点名冲突并说明你按主人的设定走。
5. 本轮没拿到工具结果之前不要编造工具输出。拿到结果后照常写回答，不要再重复工具块。
6. 要改规划文件仍然用「直接改文件」的 markdown 提案块交主人点应用，你没有写文件的工具。"""


def render_tool_prompt(registry: ToolRegistry) -> str:
    if len(registry) == 0:
        return ""
    return TOOL_RULES + "\n\n## 本轮可用工具\n" + registry.catalogue()
# --- the loop ---------------------------------------------------------------

DEFAULT_MAX_STEPS = 4
DEFAULT_MAX_TOKENS = 30_000


@dataclass
class AgentConfig:
    """Ceilings for one turn. Both are enforced by raising, never by cutting off."""

    max_steps: int = DEFAULT_MAX_STEPS
    max_tokens: int = DEFAULT_MAX_TOKENS


@dataclass
class AgentStep:
    index: int
    call: ToolCall
    result: ToolResult

    def as_line(self) -> str:
        args = ", ".join(f"{k}={v}" for k, v in self.call.arguments.items())
        state = "ok" if self.result.ok else "failed"
        return f"step {self.index}: {self.call.name}({args}) -> {state}"


@dataclass
class AgentOutcome:
    content: str
    steps: list[AgentStep]
    token_input: int
    token_output: int
    model: str


def _result_message(step: AgentStep) -> dict[str, str]:
    """Hand a result back as a labelled user turn.

    role="tool" needs an id pairing this gateway does not keep, so the block says in
    words whose utterance it is.
    """
    state = "结果" if step.result.ok else "未成功"
    return {
        "role": "user",
        "content": f"【工具 {step.call.name} 第 {step.index} 步{state}】\n{step.result.content}",
    }


def stream_agent_turn(
    llm: Any,
    messages: list[dict[str, str]],
    registry: ToolRegistry,
    *,
    task_type: str = "chat",
    model: str | None = None,
    temperature: float = 0.2,
    config: AgentConfig | None = None,
    streaming: bool = True,
) -> Iterator[tuple[str, Any]]:
    """Ask, act, feed the result back, ask again - until the model just answers.

    Yields ("delta", text) as prose becomes safe to show, ("tool", AgentStep) after
    each call, and ends with ("final", AgentOutcome). Budgets raise: an answer that
    ran out of budget is never handed over as if it were finished.

    `messages` is the turn the caller already assembled, because prepare_turn owns
    that shape - the loop appends, it does not rebuild context.
    """
    limits = config or AgentConfig()
    if limits.max_steps < 1:
        raise AgentBudgetError("max_steps 至少为 1")

    history = list(messages)
    steps: list[AgentStep] = []
    spent_in = 0
    spent_out = 0
    model_name = model or ""
    specs = registry.specs() if len(registry) else None

    for index in range(1, limits.max_steps + 1):
        released = 0
        parts: list[str] = []
        usage: dict[str, Any] = {}
        calls: list[ToolCall] = []
        raw: dict[str, Any] = {}

        if streaming:
            chunks = llm.stream_messages(
                task_type,
                history,
                temperature=temperature,
                usage_out=usage,
                model=model,
                tools=specs,
            )
            for chunk in chunks:
                parts.append(chunk)
                visible, found = parse_call_blocks("".join(parts))
                if found:
                    # A whole control block has arrived: nothing further goes on screen.
                    calls = found
                    continue
                # Hold back anything that could still grow into a control block.
                safe = releasable_len(visible)
                if safe > released:
                    yield ("delta", visible[released:safe])
                    released = safe
            content = "".join(parts)
            spent_in += int(usage.get("token_input", 0))
            spent_out += int(usage.get("token_output", 0))
            model_name = str(usage.get("model") or model_name)
        else:
            answer = llm.complete_messages(
                task_type,
                history,
                model=model,
                tools=specs,
                temperature=temperature,
            )
            content, raw = answer.content, answer.raw_message
            spent_in += answer.token_input
            spent_out += answer.token_output
            model_name = answer.model or model_name

        visible, found = parse_call_blocks(content)
        calls = found + parse_native_calls(raw)

        over = spent_in + spent_out
        if over > limits.max_tokens:
            raise AgentBudgetError(
                f"本轮已用 {over} token，超过上限 {limits.max_tokens}（第 {index} 步）。"
                "已停止，没有把截断后的内容当成回答交给你。"
            )

        if not calls:
            if streaming:
                # The stream ended, so the held-back tail can never become a block.
                if len(visible) > released:
                    yield ("delta", visible[released:])
            else:
                yield ("delta", visible.strip())
            yield (
                "final",
                AgentOutcome(
                    content=visible.strip(),
                    steps=steps,
                    token_input=spent_in,
                    token_output=spent_out,
                    model=model_name,
                ),
            )
            return

        # The control block leaves the history, the prose stays: keeping our own
        # markers in there only teaches the model to imitate them back at us.
        history.append({"role": "assistant", "content": visible})
        for call in calls:
            step = AgentStep(index=index, call=call, result=registry.run(call))
            steps.append(step)
            history.append(_result_message(step))
            yield ("tool", step)

    trail = "; ".join(step.as_line() for step in steps)
    raise AgentBudgetError(
        f"本轮到了 {limits.max_steps} 步上限仍在要求调用工具，已停止而不是继续烧钱。已执行：{trail or '（无）'}"
    )


def run_agent_turn(
    llm: Any,
    messages: list[dict[str, str]],
    registry: ToolRegistry,
    **kwargs: Any,
) -> AgentOutcome:
    """The same loop with the deltas discarded, for the non-streaming route."""
    kwargs["streaming"] = False
    outcome: AgentOutcome | None = None
    for name, payload in stream_agent_turn(llm, messages, registry, **kwargs):
        if name == "final":
            outcome = payload
    if outcome is None:  # unreachable: the generator ends with final or raises
        raise AgentBudgetError("agent loop ended without an answer")
    return outcome
