"""The agentic kernel: registry, reply protocol, step and token budgets.

These tests drive a scripted LLM, so they pin the loop itself rather than any
gateway. The gateway behaviour that forced this design (no `tool_calls` field at
all on this deployment) is covered by parse_native_calls accepting both shapes.
"""

from typing import Any

import pytest

from app.services.llm import LLMResult

from app.services.agent import (
    AgentBudgetError,
    AgentConfig,
    Tool,
    ToolCall,
    ToolError,
    ToolRegistry,
    holdback_len,
    parse_call_blocks,
    run_agent_turn,
    stream_agent_turn,
)


def make_tool() -> Tool:
    return Tool(
        name="read_file",
        description="read one document",
        parameters={
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
        handler=lambda path: f"[{path} contents]",
    )


class ScriptedLLM:
    """Answers from a script and records every message set it was shown."""

    def __init__(self, replies: list[dict[str, Any]]) -> None:
        self.replies = replies
        self.seen: list[list[dict[str, str]]] = []
        self.tools_seen: list[Any] = []

    def complete_messages(self, task_type, messages, model=None, tools=None, temperature=None):
        self.seen.append([dict(item) for item in messages])
        self.tools_seen.append(tools)
        reply = self.replies[len(self.seen) - 1]
        usage = reply.get("usage", (10, 5))
        return LLMResult(
            content=reply.get("content", ""),
            model=reply.get("model", "scripted"),
            token_input=usage[0],
            token_output=usage[1],
            cost_estimate=0.0,
            raw_message=reply.get("raw_message", {}),
        )

    def stream_messages(self, task_type, messages, temperature=0.2, usage_out=None, model=None, tools=None):
        reply = self.replies[len(self.seen)]
        self.seen.append([dict(item) for item in messages])
        self.tools_seen.append(tools)
        if usage_out is not None:
            usage = reply.get("usage", (10, 5))
            usage_out.update({"model": "scripted", "token_input": usage[0], "token_output": usage[1]})
        for piece in reply.get("chunks", [reply.get("content", "")]):
            yield piece


def call_block(name: str, **arguments: Any) -> str:
    import json

    return "```tool\n" + json.dumps({"name": name, "arguments": arguments}, ensure_ascii=False) + "\n```"


# --- registry ---------------------------------------------------------------


def test_registry_runs_a_tool_and_reports_its_result():
    registry = ToolRegistry([make_tool()])
    result = registry.run(ToolCall(name="read_file", arguments={"path": "arcs.md"}))
    assert result.ok is True
    assert result.content == "[arcs.md contents]"


def test_an_unknown_tool_names_the_options_instead_of_raising():
    registry = ToolRegistry([make_tool()])
    result = registry.run(ToolCall(name="write_file", arguments={}))
    assert result.ok is False
    assert "read_file" in result.content


def test_a_tool_that_raises_becomes_text_the_model_can_act_on():
    def boom() -> str:
        raise ToolError("上游返回 403")

    registry = ToolRegistry([Tool(name="web_search", description="", parameters={}, handler=boom)])
    result = registry.run(ToolCall(name="web_search", arguments={}))
    assert result.ok is False
    assert "403" in result.content


def test_wrong_arguments_are_reported_with_the_parameter_table():
    registry = ToolRegistry([make_tool()])
    result = registry.run(ToolCall(name="read_file", arguments={"nope": 1}))
    assert result.ok is False
    assert "path" in result.content


# --- the reply protocol -----------------------------------------------------


def test_a_call_block_is_taken_out_of_the_readers_text():
    text = "我先看一眼弧。\n\n" + call_block("read_file", path="arcs.md") + "\n\n稍等。"
    visible, calls = parse_call_blocks(text)
    assert len(calls) == 1
    assert calls[0].name == "read_file"
    assert calls[0].arguments == {"path": "arcs.md"}
    assert "tool" not in visible
    assert "我先看一眼弧。" in visible and "稍等。" in visible


def test_a_malformed_block_is_hidden_from_the_reader_and_reported_to_the_model():
    # Showing the block helps nobody; swallowing it lets the model answer blind.
    text = "前半\n```tool\nnot json\n```\n后半"
    visible, calls = parse_call_blocks(text)
    assert "not json" not in visible
    assert len(calls) == 1 and calls[0].name == ""
    result = ToolRegistry([make_tool()]).run(calls[0])
    assert result.ok is False
    assert "JSON" in result.content


def test_native_tool_calls_are_honoured_when_a_gateway_sends_them():
    from app.services.agent import parse_native_calls

    calls = parse_native_calls(
        {"tool_calls": [{"function": {"name": "read_file", "arguments": "{\"path\": \"toc.md\"}"}}]}
    )
    assert calls == [ToolCall(name="read_file", arguments={"path": "toc.md"})]


@pytest.mark.parametrize(
    "text, expected",
    [
        ("ordinary prose.", 0),
        ("", 0),
        ("写着写着三个反引号" + chr(96) * 3, 3),
        ("写着写着半个块" + chr(96) * 3 + "to", 5),
        ("完整的块头```tool\n", 0),
    ],
)
def test_the_stream_holds_back_only_a_possible_control_block(text: str, expected: int):
    assert holdback_len(text) == expected


# --- the dialects a real model actually uses --------------------------------


VENDOR_XML_REPLY = (
    "先看一眼。\n\n"
    + chr(60) + "minimax:tool_call" + chr(62) + "\n"
    + chr(60) + "invoke name=\"read_file\"" + chr(62) + "\n"
    + chr(60) + "parameter name=\"path\"" + chr(62) + "arcs.md" + chr(60) + "/parameter" + chr(62) + "\n"
    + chr(60) + "/invoke" + chr(62) + "\n"
    + chr(60) + "/minimax:tool_call" + chr(62) + "\n\n就这样。"
)

HASHROCKET_REPLY = (
    "[TOOL_CALL]\n"
    "{tool => \"read_file\", args => {\n  --path \"settings/foreshadow.md\"\n}}\n"
    "[/TOOL_CALL]"
)


def test_the_vendor_xml_dialect_is_parsed_and_hidden() -> None:
    visible, calls = parse_call_blocks(VENDOR_XML_REPLY)
    assert calls == [ToolCall(name="read_file", arguments={"path": "arcs.md"})]
    assert "minimax" not in visible
    assert "先看一眼。" in visible and "就这样。" in visible


def test_the_hashrocket_dialect_is_parsed_and_hidden() -> None:
    visible, calls = parse_call_blocks(HASHROCKET_REPLY)
    assert calls == [ToolCall(name="read_file", arguments={"path": "settings/foreshadow.md"})]
    assert visible == ""


def test_an_unreadable_block_is_never_shown_but_is_reported() -> None:
    broken = "前半\n[TOOL_CALL]\ngarbage that is not a call\n[/TOOL_CALL]\n后半"
    visible, calls = parse_call_blocks(broken)
    assert "[TOOL_CALL]" not in visible
    assert len(calls) == 1 and calls[0].name == ""
    result = ToolRegistry([make_tool()]).run(calls[0])
    assert result.ok is False


def test_a_second_round_that_uses_another_dialect_still_loops() -> None:
    """Measured live: round 1 answered with our fence, round 2 with a hashrocket block.

    The second one must be executed, not shipped to the reader as the answer.
    """
    llm = ScriptedLLM(
        [
            {"content": "先读弧。\n\n" + call_block("read_file", path="arcs.md")},
            {"content": HASHROCKET_REPLY},
            {"content": "弧 1 收在 3 章，钩子建议改成碑屑带体温。"},
        ]
    )
    outcome = run_agent_turn(llm, [{"role": "user", "content": "q"}], ToolRegistry([make_tool()]))
    assert [step.call.name for step in outcome.steps] == ["read_file", "read_file"]
    assert outcome.steps[1].call.arguments == {"path": "settings/foreshadow.md"}
    assert outcome.content == "弧 1 收在 3 章，钩子建议改成碑屑带体温。"
    assert "[TOOL_CALL]" not in outcome.content


def test_streaming_holds_back_a_foreign_control_block() -> None:
    pieces = [
        "我查一下。\n\n",
        HASHROCKET_REPLY[:14],
        HASHROCKET_REPLY[14:],
        "\n以上是过程。",
    ]
    llm = ScriptedLLM(
        [
            {"chunks": pieces, "usage": (7, 3)},
            {"chunks": ["查完了。"], "usage": (5, 2)},
        ]
    )
    events = list(stream_agent_turn(llm, [{"role": "user", "content": "q"}], ToolRegistry([make_tool()])))
    deltas = "".join(payload for name, payload in events if name == "delta")
    assert "[TOOL_CALL]" not in deltas
    assert "tool =>" not in deltas
    assert "我查一下。" in deltas
    assert "查完了。" in deltas


# --- the loop ---------------------------------------------------------------


def test_one_tool_round_then_the_answer():
    llm = ScriptedLLM(
        [
            {"content": "先查。\n\n" + call_block("read_file", path="arcs.md")},
            {"content": "弧二结束在 30 章。"},
        ]
    )
    outcome = run_agent_turn(llm, [{"role": "user", "content": "第二个弧收到哪了？"}], ToolRegistry([make_tool()]))
    assert outcome.content == "弧二结束在 30 章。"
    assert [step.call.name for step in outcome.steps] == ["read_file"]
    # the result reached the model, and the control block did not
    second_call = llm.seen[1]
    assert any("arcs.md contents" in item["content"] for item in second_call)
    assert not any("```tool" in item["content"] for item in second_call)


def test_a_failing_tool_still_loops_and_says_it_failed():
    def boom(path: str) -> str:
        raise ToolError("读不到")

    registry = ToolRegistry([Tool(name="read_file", description="", parameters={}, handler=boom)])
    llm = ScriptedLLM([{"content": call_block("read_file", path="x.md")}, {"content": "拿不到，请主人确认。"}])
    outcome = run_agent_turn(llm, [{"role": "user", "content": "q"}], registry)
    assert outcome.steps[0].result.ok is False
    assert outcome.content == "拿不到，请主人确认。"


def test_the_step_cap_raises_instead_of_running_on():
    hungry = {"content": call_block("read_file", path="arcs.md"), "usage": (5, 5)}
    llm = ScriptedLLM([hungry] * 6)
    with pytest.raises(AgentBudgetError) as caught:
        run_agent_turn(
            llm,
            [{"role": "user", "content": "q"}],
            ToolRegistry([make_tool()]),
            config=AgentConfig(max_steps=2, max_tokens=10_000),
        )
    assert "2 步" in str(caught.value)
    assert len(llm.seen) == 2


def test_the_token_cap_raises_rather_than_shipping_a_cut_answer():
    llm = ScriptedLLM([{"content": call_block("read_file", path="a.md"), "usage": (900, 900)}])
    with pytest.raises(AgentBudgetError) as caught:
        run_agent_turn(
            llm,
            [{"role": "user", "content": "q"}],
            ToolRegistry([make_tool()]),
            config=AgentConfig(max_steps=5, max_tokens=1_000),
        )
    assert "token" in str(caught.value)


def test_streaming_never_shows_the_control_block():
    block = call_block("read_file", path="arcs.md")
    llm = ScriptedLLM(
        [
            {"chunks": ["我先", "查一下。\n\n", block[:12], block[12:], "\n就这样"], "usage": (7, 3)},
            {"chunks": ["答案是 30 章。"], "usage": (11, 4)},
        ]
    )
    events = list(stream_agent_turn(llm, [{"role": "user", "content": "q"}], ToolRegistry([make_tool()])))
    deltas = "".join(payload for name, payload in events if name == "delta")
    assert "```tool" not in deltas
    assert "我先查一下。" in deltas
    assert "答案是 30 章。" in deltas
    assert [name for name, _ in events].count("tool") == 1
    final = dict(events)["final"]
    assert final.content == "答案是 30 章。"
    assert final.token_input == 18
    assert final.token_output == 7


def test_a_turn_that_needs_no_tool_costs_no_extra_round():
    llm = ScriptedLLM([{"content": "直接回答。"}])
    outcome = run_agent_turn(llm, [{"role": "user", "content": "q"}], ToolRegistry([make_tool()]))
    assert outcome.content == "直接回答。"
    assert outcome.steps == []
    assert len(llm.seen) == 1


def test_the_gateway_gets_the_tool_declarations():
    llm = ScriptedLLM([{"content": "ok"}])
    run_agent_turn(llm, [{"role": "user", "content": "q"}], ToolRegistry([make_tool()]))
    assert llm.tools_seen[0][0]["function"]["name"] == "read_file"
