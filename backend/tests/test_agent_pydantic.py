"""The Pydantic AI engine and its gateway adapter, against the same contracts."""

from __future__ import annotations

import asyncio
import json
import threading
import time
from collections.abc import Callable
from typing import Any

import httpx
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.tools import Tool as PydanticTool
from pydantic_ai.tools import ToolDefinition
import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models import Novel
from app.services.agent import (
    AgentBudgetError,
    AgentConfig,
    Tool,
    ToolCall,
    ToolError,
    ToolRegistry,
    run_agent_turn,
    stream_agent_turn,
)
from app.services.agent_model import GatewayChatModel
from app.services.agent_tools import build_registry


class ScriptedGateway:
    """The existing client contract, replayed without touching a real gateway."""

    def __init__(self, replies: list[dict[str, Any]]) -> None:
        self.replies = replies
        self.seen: list[list[dict[str, str]]] = []
        self.tools_seen: list[Any] = []

    def complete_messages(
        self,
        task_type: str,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        temperature: float | None = None,
    ) -> Any:
        from app.services.llm import LLMResult

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

    def stream_messages(
        self,
        task_type: str,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.6,
        usage_out: dict[str, Any] | None = None,
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        reasoning_out: list[str] | None = None,
        channels: bool = False,
        tool_calls_out: list[dict[str, Any]] | None = None,
    ):
        from app.services.llm import LLMResult

        self.seen.append([dict(item) for item in messages])
        self.tools_seen.append(tools)
        reply = self.replies[len(self.seen) - 1]
        if tool_calls_out is not None and reply.get("native_tool_calls"):
            tool_calls_out.extend(reply["native_tool_calls"])
        if usage_out is not None:
            usage = reply.get("usage", (10, 5))
            usage_out.update({"model": "scripted", "token_input": usage[0], "token_output": usage[1]})
        for piece in reply.get("reasoning", []):
            if reasoning_out is not None:
                reasoning_out.append(piece)
            yield ("reasoning", piece) if channels else piece
        for piece in reply.get("chunks", [reply.get("content", "")]):
            yield ("content", piece) if channels else piece


def call_block(name: str, **arguments: Any) -> str:
    payload = {"name": name, "arguments": arguments}
    return "```tool\n" + json.dumps(payload, ensure_ascii=False) + "\n```"


def make_tool() -> ToolRegistry:
    """A registry built the way the product builds one.

    A duck-typed stand-in puts the handler in a class body, where the instance binds it as
    a method and `registry.run` calls it with the wrong first argument - the turn then
    "works" by failing every step, which is not the shape under test.
    """
    return ToolRegistry(
        [
            Tool(
                name="read_file",
                description="read one document",
                parameters={"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
                handler=lambda path: f"[{path} contents]",
            )
        ]
    )


def test_engine_switch_defaults_to_legacy_and_only_accepts_pydantic(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.agent import agent_engine

    monkeypatch.delenv("NOVEL_AGENT_ENGINE", raising=False)
    assert agent_engine() == "legacy"
    monkeypatch.setenv("NOVEL_AGENT_ENGINE", "pydantic")
    assert agent_engine() == "pydantic"
    monkeypatch.setenv("NOVEL_AGENT_ENGINE", "surprise")
    assert agent_engine() == "legacy"


def test_gateway_request_hides_a_tool_block_and_turns_it_into_a_framework_call() -> None:
    llm = ScriptedGateway(
        [{"content": "我先看一眼弧。\n\n" + call_block("read_file", path="arcs.md") + "\n\n稍等。"}]
    )
    model = GatewayChatModel(llm)
    response = asyncio.run(
        model.request(
            [
                {"role": "system", "content": "rules"},
                {"role": "user", "content": "第二个弧收到哪了？"},
            ],
            None,
            ModelRequestParameters(
                function_tools=[
                    ToolDefinition(
                        name="read_file",
                        description="read one document",
                        parameters_json_schema={
                            "type": "object",
                            "properties": {"path": {"type": "string"}},
                            "required": ["path"],
                        },
                    )
                ]
            ),
        )
    )
    text = [part for part in response.parts if getattr(part, "part_kind", "") == "text"]
    calls = [part for part in response.parts if getattr(part, "part_kind", "") == "tool-call"]
    assert [part.content for part in text] == ["我先看一眼弧。\n\n\n\n稍等。"]
    assert len(calls) == 1
    assert calls[0].tool_name == "read_file"
    assert calls[0].args == {"path": "arcs.md"}
    assert response.usage.input_tokens == 10
    assert response.usage.output_tokens == 5
    assert llm.tools_seen[0][0]["function"]["name"] == "read_file"
    assert llm.seen[0][0]["role"] == "system"


def test_gateway_stream_assembles_native_tool_calls_and_holds_back_dialect_blocks() -> None:
    block = call_block("read_file", path="arcs.md")
    llm = ScriptedGateway(
        [
            {
                "chunks": ["我先查。\n\n", block[:12], block[12:]],
                "reasoning": ["先看目录"],
                "native_tool_calls": [],
                "usage": (7, 3),
            }
        ]
    )
    model = GatewayChatModel(llm)

    async def collect() -> tuple[list[Any], Any]:
        events: list[Any] = []
        async with model.request_stream(
            [{"role": "user", "content": "q"}], None, ModelRequestParameters()
        ) as stream:
            async for event in stream:
                events.append(event)
        return events, stream.get()

    events, response = asyncio.run(collect())
    assert response.usage.input_tokens == 7
    assert response.usage.output_tokens == 3
    calls = [part for part in response.parts if getattr(part, "part_kind", "") == "tool-call"]
    assert len(calls) == 1
    assert calls[0].tool_name == "read_file"
    assert calls[0].args == {"path": "arcs.md"}
    text = [part for part in response.parts if getattr(part, "part_kind", "") == "text"]
    assert text and text[0].content == "我先查。\n\n"
    thinking = [part for part in response.parts if getattr(part, "part_kind", "") == "thinking"]
    assert thinking and thinking[0].content == "先看目录"
    assert [getattr(event, "event_kind", "") for event in events]
    assert not any("```tool" in str(event) for event in events)


@pytest.fixture()
def session_factory() -> Callable[[], Session]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(Novel(title="测试书", description="玄幻", target_chapters=10, style_constraints=""))
        session.commit()
        novel_id = session.exec(select(Novel)).first().id
    factory = lambda: Session(engine)
    factory.novel_id = novel_id  # type: ignore[attr-defined]
    return factory


def test_pydantic_engine_runs_read_search_then_proposal_with_test_model(
    session_factory: Callable[[], Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("NOVEL_AGENT_ENGINE", "pydantic")
    from pydantic_ai import ModelResponse, TextPart, ToolCallPart
    from pydantic_ai.models.test import TestModel

    class ThreeStepTestModel(TestModel):
        def __init__(self) -> None:
            super().__init__(model_name="three-step-test")

        def _request(self, messages, model_settings, model_request_parameters):
            step = sum(isinstance(message, ModelResponse) for message in messages)
            self.last_model_request_parameters = model_request_parameters
            if step == 0:
                return ModelResponse(
                    [ToolCallPart("read_file", {"path": "arcs.md"})],
                    model_name=self.model_name,
                )
            if step == 1:
                return ModelResponse(
                    [ToolCallPart("web_search", {"query": "司天监"})],
                    model_name=self.model_name,
                )
            proposal = "```markdown @toc.md\n## 第 2 章 官署旧例\n```"
            return ModelResponse([TextPart(content=proposal)], model_name=self.model_name)

    wiki_transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            json={"query": {"search": [{"pageid": 11, "title": "司天监", "snippet": "<em>司天监</em>，官署名。"}]}},
        )
    )
    messages = [
        {"role": "system", "content": "规则"},
        {"role": "user", "content": "官署怎么写？"},
    ]
    outcome = run_agent_turn(
        None,
        messages,
        build_registry(session_factory, session_factory.novel_id, search_transport=wiki_transport),
        model=ThreeStepTestModel(),
    )
    assert [step.call.name for step in outcome.steps] == ["read_file", "web_search"]
    assert outcome.steps[0].result.ok is True
    assert "司天监，官署名。" in outcome.steps[1].result.content
    assert outcome.content.startswith("```markdown @toc.md")
    assert outcome.model == "three-step-test"
    assert "arcs.md contents" not in outcome.content


def test_the_same_stream_contract_runs_on_both_engines(monkeypatch: pytest.MonkeyPatch) -> None:
    block = call_block("read_file", path="arcs.md")
    replies = [
        {"content": "先读弧。\n\n" + block, "usage": (7, 3)},
        {"content": "弧二结束在 30 章。", "usage": (5, 2)},
    ]

    def collect(engine: str) -> tuple[list[Any], Any, list[list[dict[str, str]]]]:
        monkeypatch.setenv("NOVEL_AGENT_ENGINE", engine)
        llm = ScriptedGateway(replies)
        events = list(
            stream_agent_turn(
                llm,
                [{"role": "user", "content": "第二个弧收到哪了？"}],
                make_tool(),
                model=None,
            )
        )
        return events, dict(events)["final"], llm.seen

    legacy_events, legacy_final, legacy_seen = collect("legacy")
    pydantic_events, pydantic_final, pydantic_seen = collect("pydantic")
    for final in (legacy_final, pydantic_final):
        assert final.content == "弧二结束在 30 章。"
        assert final.token_input == 12
        assert final.token_output == 5
    assert [name for name, _ in legacy_events] == [name for name, _ in pydantic_events]
    assert [item[0]["role"] for item in legacy_seen] == [item[0]["role"] for item in pydantic_seen]
    assert len(pydantic_seen) == 2
    assert any("arcs.md contents" in item["content"] for item in pydantic_seen[1])
    assert not any("```tool" in item["content"] for item in pydantic_seen[1])


@pytest.mark.parametrize("engine", ["legacy", "pydantic"])
def test_reasoning_accumulates_as_one_stream_with_a_break_only_between_steps(
    engine: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("NOVEL_AGENT_ENGINE", engine)
    llm = ScriptedGateway(
        [
            {
                "chunks": [call_block("read_file", path="arcs.md")],
                "reasoning": ["先看目录", "再定视角"],
            },
            {"chunks": ["正文在这里。"], "reasoning": ["可以回答了"]},
        ]
    )
    reasoning: list[str] = []
    events = list(
        stream_agent_turn(
            llm,
            [{"role": "user", "content": "开场怎么写？"}],
            make_tool(),
            task_type="chat",
            reasoning_out=reasoning,
        )
    )
    assert events[-1][0] == "final"
    assert "".join(reasoning) == "先看目录再定视角\n\n可以回答了"


@pytest.mark.parametrize("engine", ["legacy", "pydantic"])
def test_the_step_cap_raises_instead_of_running_on(engine: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NOVEL_AGENT_ENGINE", engine)
    hungry = {"content": "```tool\n" + json.dumps({"name": "read_file", "arguments": {"path": "a.md"}}) + "\n```"}
    llm = ScriptedGateway([hungry] * 3)
    with pytest.raises(AgentBudgetError) as caught:
        run_agent_turn(
            llm,
            [{"role": "user", "content": "q"}],
            make_tool(),
            config=AgentConfig(max_steps=2, max_tokens=10_000),
        )
    assert "2" in str(caught.value)
    assert len(llm.seen) == 2


@pytest.mark.parametrize("engine", ["legacy", "pydantic"])
def test_the_token_cap_raises_rather_than_shipping_a_cut_answer(engine: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NOVEL_AGENT_ENGINE", engine)
    llm = ScriptedGateway(
        [{"content": call_block("read_file", path="a.md"), "usage": (900, 900)}]
    )
    with pytest.raises(AgentBudgetError) as caught:
        run_agent_turn(
            llm,
            [{"role": "user", "content": "q"}],
            make_tool(),
            config=AgentConfig(max_steps=5, max_tokens=1_000),
        )
    assert "token" in str(caught.value).lower()


def test_framework_runs_two_tool_calls_concurrently(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NOVEL_AGENT_ENGINE", "pydantic")
    from pydantic_ai import ModelResponse, TextPart, ToolCallPart
    from pydantic_ai.models.test import TestModel

    barrier = threading.Barrier(2, timeout=2.0)

    def wait_for_sibling() -> str:
        assert barrier.wait(timeout=2.0) >= 0
        return "parallel"

    class TwoCallsTestModel(TestModel):
        def _request(self, messages, model_settings, model_request_parameters):
            step = sum(isinstance(message, ModelResponse) for message in messages)
            if step == 0:
                return ModelResponse(
                    [
                        ToolCallPart("probe_a", {}, tool_call_id="a"),
                        ToolCallPart("probe_b", {}, tool_call_id="b"),
                    ],
                    model_name=self.model_name,
                )
            return ModelResponse([TextPart("done")], model_name=self.model_name)

    tools = [
        PydanticTool(wait_for_sibling, name="probe_a", description="wait"),
        PydanticTool(wait_for_sibling, name="probe_b", description="wait"),
    ]
    started = time.perf_counter()
    outcome = run_agent_turn(
        None,
        [{"role": "user", "content": "q"}],
        ToolRegistry(),
        model=TwoCallsTestModel(),
        framework_tools=tools,
    )
    elapsed = time.perf_counter() - started
    assert outcome.content == "done"
    assert elapsed < 1.8


def slow_registry(delay: float = 0.05) -> ToolRegistry:
    """A registry whose one tool takes measurable time, so 「这步多久」 has a number to check."""

    def snooze(path: str) -> str:
        time.sleep(delay)
        return f"[{path} contents]"

    return ToolRegistry(
        [
            Tool(
                name="read_file",
                description="read one document",
                parameters={"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
                handler=snooze,
            )
        ]
    )


def failing_registry(message: str = "读不到 nope.md：文件不存在") -> ToolRegistry:
    """The registry's own failure path: a ToolError, exactly as a missing document raises."""

    def broken(path: str) -> str:
        raise ToolError(message)

    return ToolRegistry(
        [
            Tool(
                name="read_file",
                description="read one document",
                parameters={"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
                handler=broken,
            )
        ]
    )


@pytest.mark.parametrize("engine", ["legacy", "pydantic"])
def test_every_step_says_how_long_it_ran_and_how_much_it_brought_back(
    engine: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """6.5 第 2 步 · 判据 31.1 - both engines, because the default one is still legacy."""
    monkeypatch.setenv("NOVEL_AGENT_ENGINE", engine)
    block = call_block("read_file", path="arcs.md")
    llm = ScriptedGateway(
        [
            {"content": "先看目录。\n\n" + block, "usage": (7, 3)},
            {"content": "弧二结束在 30 章。", "usage": (5, 2)},
        ]
    )
    events = list(stream_agent_turn(llm, [{"role": "user", "content": "q"}], slow_registry()))
    steps = [payload for name, payload in events if name == "tool"]
    assert len(steps) == 1, engine
    step = steps[0]
    assert step.ms >= 30, f"{engine} 没量到这一步的耗时（ms={step.ms}）"
    assert step.chars == len(step.result.content) == len("[arcs.md contents]")
    assert f"{step.ms}ms" in step.as_line() and str(step.chars) in step.as_line()


def test_a_failing_tool_goes_back_to_the_model_instead_of_aborting_the_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The framework path must hand the model the same sentence the registry hands the loop."""
    monkeypatch.setenv("NOVEL_AGENT_ENGINE", "pydantic")
    from pydantic_ai import ModelRequest, ModelResponse, TextPart, ToolCallPart
    from pydantic_ai.models.test import TestModel

    handed_back: list[list[Any]] = []

    class OnceThenAnswer(TestModel):
        def __init__(self) -> None:
            super().__init__(model_name="failure-aware")

        def _request(self, messages, model_settings, model_request_parameters):
            if sum(isinstance(m, ModelResponse) for m in messages) == 0:
                return ModelResponse(
                    [ToolCallPart("read_file", {"path": "nope.md"}, tool_call_id="f1")],
                    model_name=self.model_name,
                )
            handed_back.append([part.content for m in messages if isinstance(m, ModelRequest) for part in m.parts])
            return ModelResponse([TextPart("那我按已有资料回答。")], model_name=self.model_name)

    outcome = run_agent_turn(None, [{"role": "user", "content": "q"}], failing_registry(), model=OnceThenAnswer())
    assert outcome.steps[0].result.ok is False
    assert "读不到 nope.md" in outcome.steps[0].result.content
    assert any("读不到 nope.md" in str(item) for item in handed_back[-1]), "失败没有回给模型"
    assert outcome.content == "那我按已有资料回答。"
    assert "failed" in outcome.steps[0].as_line()


def test_the_step_gate_names_the_step_and_the_spend(monkeypatch: pytest.MonkeyPatch) -> None:
    """6.5 第 2 步 · 判据 31.2 - the numbers come from the framework, so nothing runs a second gate."""
    monkeypatch.setenv("NOVEL_AGENT_ENGINE", "pydantic")
    hungry = {"content": call_block("read_file", path="a.md")}
    llm = ScriptedGateway([hungry] * 3)
    with pytest.raises(AgentBudgetError) as caught:
        run_agent_turn(
            llm,
            [{"role": "user", "content": "q"}],
            make_tool(),
            config=AgentConfig(max_steps=2, max_tokens=10_000),
        )
    message = str(caught.value)
    assert "到了 2 轮上限，第 3 轮仍在要求调用工具" in message
    assert "已花 30 token（输入 20 / 输出 10）" in message
    assert "跑了 2 步工具调用" in message
    assert "step 1:" in message and "step 2:" in message  # 一轮里两次调用不许都叫第 1 步
    assert "read_file(path=a.md)" in message
    assert len(llm.seen) == 2


def test_the_token_gate_reports_what_it_refused_to_spend(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NOVEL_AGENT_ENGINE", "pydantic")
    llm = ScriptedGateway([{"content": call_block("read_file", path="a.md"), "usage": (900, 900)}])
    with pytest.raises(AgentBudgetError) as caught:
        run_agent_turn(
            llm,
            [{"role": "user", "content": "q"}],
            make_tool(),
            config=AgentConfig(max_steps=5, max_tokens=1_000),
        )
    message = str(caught.value)
    assert "第 1 轮回来时已用 1800 token，过了 1000 的上限" in message
    assert "已花 1800 token（输入 900 / 输出 900）" in message


@pytest.mark.parametrize("engine", ["legacy", "pydantic"])
def test_a_model_that_only_fails_at_tools_still_stops_at_the_step_gate(
    engine: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Why `tool_calls_limit` is not the gate: it counts successes only, so failures never add up."""
    monkeypatch.setenv("NOVEL_AGENT_ENGINE", engine)
    hungry = {"content": call_block("read_file", path="nope.md")}
    llm = ScriptedGateway([hungry] * 3)
    with pytest.raises(AgentBudgetError):
        run_agent_turn(
            llm,
            [{"role": "user", "content": "q"}],
            failing_registry(),
            config=AgentConfig(max_steps=2, max_tokens=10_000),
        )
    assert len(llm.seen) == 2
