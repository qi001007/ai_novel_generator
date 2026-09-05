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

# Models reach for whichever tool-call dialect they were trained on, and one reply
# can mix them: this deployment produced our fence, vendor XML and a hashrocket block
# in three consecutive rounds (measured 2026-09-04). Anything that reads as a control
# block is taken out of what the reader sees, parsed or not - an unparsed one goes
# back to the model as a failure instead of shipping as an answer.
LT = chr(60)
GT = chr(62)

VENDOR_XML = re.compile(
    LT + "minimax:tool_call" + GT + r"\s*" + LT + r"invoke name=\"(?P<name>[^\"]+)\"" + GT
    + r"(?P<body>.*?)" + LT + "/invoke" + GT + r"\s*" + LT + "/minimax:tool_call" + GT,
    re.S,
)
XML_PARAMETER = re.compile(
    LT + r"parameter name=\"(?P<key>[^\"]+)\"" + GT + r"(?P<value>.*?)" + LT + "/parameter" + GT, re.S
)
VENDOR_HASHROCKET = re.compile(
    r"\[TOOL_CALL\]\s*(?P<body>.*?)\s*\[/TOOL_CALL\]",
    re.S,
)
HR_NAME = re.compile(r"tool\s*=\s*>\s*\"(?P<name>[^\"]+)\"")
HR_PARAMETER = re.compile(r"--(?P<key>[A-Za-z_][\w-]*)\s+\"(?P<value>[^\"]*)\"")

# What a streamed tool block starts with. While the tail of the text on screen could
# still become one of these, that tail is held back instead of shown: the reader must
# never watch our control tokens scroll past.
FENCE = chr(96) * 3
# Every way a control block can begin, with the token that closes it. The streamer
# holds back from any opener that has not been closed yet, so no dialect escapes.
CONTROL_PAIRS: tuple[tuple[str, str], ...] = (
    (FENCE + "tool", FENCE),
    (FENCE + " tool", FENCE),
    (chr(60) + "minimax:tool_call" + chr(62), chr(60) + "/minimax:tool_call" + chr(62)),
    ("[TOOL_CALL]", "[/TOOL_CALL]"),
)
CALL_OPENERS = tuple(opener for opener, _ in CONTROL_PAIRS)
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
    body would follow it. So anything from an unclosed control block onwards waits,
    and a closed fence that is not a call (a proposal block, which the reader is
    meant to see) releases.
    """
    safe = len(text) - holdback_len(text)
    for opener, closer in CONTROL_PAIRS:
        start = text.find(opener)
        if start != -1 and text.find(closer, start + len(opener)) == -1:
            safe = min(safe, start)
    # a bare unclosed fence is also held: it may still become a call, and a proposal
    # fence that never closes is not something to show mid-stream either
    fence = text.find(FENCE)
    if fence != -1 and text.find(FENCE, fence + len(FENCE)) == -1:
        safe = min(safe, fence)
    return safe

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


def _from_fence(match: re.Match[str]) -> ToolCall:
    try:
        payload = json.loads(match.group("body"))
    except ValueError:
        return ToolCall(name="", arguments={})
    if not isinstance(payload, dict) or not payload.get("name"):
        return ToolCall(name="", arguments={})
    try:
        arguments = _coerce_arguments(
            next((payload[key] for key in ARGUMENT_KEYS if key in payload), {})
        )
    except ToolError:
        return ToolCall(name="", arguments={})
    return ToolCall(name=str(payload["name"]), arguments=arguments)


def _from_xml(match: re.Match[str]) -> ToolCall:
    arguments = {
        item.group("key"): item.group("value").strip() for item in XML_PARAMETER.finditer(match.group("body"))
    }
    return ToolCall(name=match.group("name"), arguments=arguments)


def _from_hashrocket(match: re.Match[str]) -> ToolCall:
    body = match.group("body")
    named = HR_NAME.search(body)
    if named is None:
        return ToolCall(name="", arguments={})
    arguments = {item.group("key"): item.group("value") for item in HR_PARAMETER.finditer(body)}
    return ToolCall(name=named.group("name"), arguments=arguments)


# order matters only in that the fence is ours and is tried first
_DIALECTS: list[tuple[re.Pattern[str], Callable[[re.Match[str]], ToolCall]]] = [
    (CALL_BLOCK, _from_fence),
    (VENDOR_XML, _from_xml),
    (VENDOR_HASHROCKET, _from_hashrocket),
]


def parse_call_blocks(text: str) -> tuple[str, list[ToolCall]]:
    """Split a reply into what the reader sees and what the loop must execute.

    Every dialect is removed from the visible text. A block we cannot read still
    becomes an invalid call, so the model is told rather than the reader being shown
    our control tokens.
    """
    calls: list[ToolCall] = []
    visible = text or ""
    for pattern, build in _DIALECTS:
        for match in pattern.finditer(visible):
            calls.append(build(match))
        visible = pattern.sub("", visible)
    return visible.strip(), calls


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
6. 要改规划文件仍然用「直接改文件」的 markdown 提案块交主人点应用，你没有写文件的工具。
7. 同一份文件本轮只读一次：结果已在上下文里，再查一遍只是浪费主人等的这一轮。
8. 读到够用的资料就收尾，按上面的提案格式给出改后的整份文件；不要为了稳妥无限查下去。"""


def render_tool_prompt(registry: ToolRegistry) -> str:
    if len(registry) == 0:
        return ""
    return TOOL_RULES + "\n\n## 本轮可用工具\n" + registry.catalogue()
# --- the loop ---------------------------------------------------------------

# Six, not four: a plan edit measured live needs to read the arc book, the
# foreshadow book and the brief before it can propose anything, and a turn that
# dies on the ceiling after doing its reading is a budget that is wrong, not a
# model that is wrong.
DEFAULT_MAX_STEPS = 6
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
    reasoning_out: list[str] | None = None,
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
    done: set[tuple[str, str]] = set()
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
            # One accumulator for the whole turn. Deltas are pieces of a single stream
            # and get concatenated as they arrive; the paragraph break belongs between
            # the steps, so it is written here rather than by whoever joins the list.
            if reasoning_out is not None and index > 1 and reasoning_out:
                reasoning_out.append("\n\n")
            chunks = llm.stream_messages(
                task_type,
                history,
                temperature=temperature,
                usage_out=usage,
                model=model,
                tools=specs,
                # one accumulator for the whole turn: a turn that used tools has one
                # reasoning stretch per step, and the reader wants them in order
                reasoning_out=reasoning_out,
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
            signature = (call.name, json.dumps(call.arguments, ensure_ascii=False, sort_keys=True))
            if signature in done:
                # Measured live: the model re-read the arc book twice in one turn.
                # Re-running it costs the same answer; saying so lets the round end.
                step = AgentStep(
                    call=call,
                    index=index,
                    result=ToolResult(
                        call=call,
                        content="这份内容本轮已经给过你了，不必再查。请基于已有资料直接回答。",
                        ok=True,
                    ),
                )
            else:
                done.add(signature)
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
