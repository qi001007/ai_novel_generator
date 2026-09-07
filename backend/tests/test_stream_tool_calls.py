"""流式那一路的原生 `tool_calls`（UI-BACKLOG 27.1，2026-09-08 实测）。

旧前提写的是「这台网关不给原生 tool_calls」，那是**非流式**那一路观测出来的；
界面走的却是流式那一路，而 `stream_messages` 以前只读 `delta.content` 与
`delta.reasoning_content` —— 标准通道的工具调用在传输层就被丢掉，
`agent.py` 里那句 `parse_native_calls(raw)` 在流式分支永远收到 `{}`。
于是「Agent 说要去查文件，然后断掉」。下面这些分片是 2026-09-08 从真网关
（scnet / MiniMax-M2.5，带 `tools` 的流式请求，`finish_reason=tool_calls`）
原样录下来的，不是编的形状。
"""

import json

import httpx

from app.services.agent import parse_native_calls
from app.services.llm import LLMSettings, OpenAICompatibleClient

# 真机原样：一次调用被切成 4 片，arguments 是碎的，靠 index 归并
FRAGMENTS = [
    [{"id": "call_4fd4e58e1b6745d7b8221a72", "function": {"arguments": "", "name": "read_file"}, "type": "function", "index": 0}],
    [{"function": {"arguments": "{"}, "index": 0}],
    [{"function": {"arguments": '"path": "settings/worldview.md"'}, "index": 0}],
    [{"function": {"arguments": "}"}, "index": 0}],
]


def _client(handler: httpx.BaseTransport) -> OpenAICompatibleClient:
    return OpenAICompatibleClient(
        LLMSettings(
            provider="openai_compatible",
            api_base_url="https://llm.test/v1",
            api_key="test-key",
            timeout=1,
            models={"chat": "chat-model"},
        ),
        transport=httpx.MockTransport(handler),
    )


def _sse(events: list[dict]) -> bytes:
    body = "".join("data: " + json.dumps(event, ensure_ascii=False) + "\n\n" for event in events)
    return (body + "data: [DONE]\n\n").encode("utf-8")


def _stream(events: list[dict], out: list[dict]) -> str:
    """channels=True 交出来的是 ("content"|"reasoning", 片段) 两路，这里只把正文那一路拼回去。"""
    collected: list[dict] = []
    pieces: list[str] = []
    for kind, text in _client(_handler(events)).stream_messages(
        "chat",
        [{"role": "user", "content": "读一下世界观"}],
        tools=[{"type": "function", "function": {"name": "read_file"}}],
        channels=True,
        tool_calls_out=collected,
    ):
        if kind == "content":
            pieces.append(text)
    out.extend(collected)
    return "".join(pieces)


def _handler(events: list[dict]):
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=_sse(events),
            headers={"Content-Type": "text/event-stream"},
        )

    return handle


def _call_events() -> list[dict]:
    events = [{"choices": [{"delta": {"role": "assistant"}}]}]
    events += [{"choices": [{"delta": {"reasoning_content": "该读文件"}}]} for _ in range(2)]
    events += [{"choices": [{"delta": {"content": "好的"}}]}]
    events += [{"choices": [{"delta": {"tool_calls": piece}}]} for piece in FRAGMENTS]
    events.append({"choices": [{"delta": {}, "finish_reason": "tool_calls"}]})
    return events


def test_a_native_call_split_across_chunks_is_reassembled() -> None:
    calls: list[dict] = []
    prose = _stream(_call_events(), calls)
    assert prose == "好的"  # 推理与工具分片都不许混进正文
    assert calls == [
        {
            "id": "call_4fd4e58e1b6745d7b8221a72",
            "type": "function",
            "function": {"name": "read_file", "arguments": '{"path": "settings/worldview.md"}'},
        }
    ], "分片没拼回完整调用，Agent 就永远看不见标准通道"


def test_the_reassembled_call_is_what_the_loop_already_parses() -> None:
    """这条钉的是**接缝**：传输层交出的形状必须正好是 parse_native_calls 认的那个形状，
    否则修了一处、另一处照旧瞎。"""
    calls: list[dict] = []
    _stream(_call_events(), calls)
    parsed = parse_native_calls({"tool_calls": calls})
    assert [(call.name, call.arguments) for call in parsed] == [
        ("read_file", {"path": "settings/worldview.md"})
    ]


def test_two_parallel_calls_stay_in_index_order() -> None:
    events = [
        {"choices": [{"delta": {"tool_calls": [{"id": "a", "function": {"name": "read_file", "arguments": ""}, "index": 1}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"id": "b", "function": {"name": "list_files", "arguments": ""}, "index": 0}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"function": {"arguments": '{"path":"a.md"}'}, "index": 1}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"function": {"arguments": "{}"}, "index": 0}]}}]},
    ]
    calls: list[dict] = []
    _stream(events, calls)
    assert [call["id"] for call in calls] == ["b", "a"], "按 index 归并，不是按到达顺序"


def test_a_plain_answer_leaves_the_accumulator_empty() -> None:
    events = [
        {"choices": [{"delta": {"reasoning_content": "不用查"}}]},
        {"choices": [{"delta": {"content": "就这么写。"}}]},
    ]
    calls: list[dict] = []
    prose = _stream(events, calls)
    assert prose == "就这么写。"
    assert calls == []
