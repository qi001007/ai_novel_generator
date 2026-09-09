"""S2: the chat route runs a real multi-step turn.

Acceptance for the kernel, end to end over the route the UI uses: the model asks
for a document, the server reads it through the file layer, the model proposes a
change, and the only write is still the human pressing 应用 as actor=ai.
"""

import json

import pytest
from fastapi.testclient import TestClient

from app.services.llm import LLMResult, LLMSettings
from tests.planning_helpers import create_arc
from tests.test_chat_agent import BRIEF_DOC, make_novel, parse_sse, payload_of, use_fake

TOOL_BLOCK_ARCS = (
    "```tool\n" + '{"name": "read_file", "arguments": {"path": "arcs.md"}}' + "\n```"
)


@pytest.fixture(autouse=True)
def _keep_tests_offline(monkeypatch) -> None:
    monkeypatch.setenv("NOVEL_LLM_API_KEY", "")


class SteppedClient:
    """A different scripted answer per round, so the loop is actually exercised."""

    def __init__(self, rounds, usage=(100, 20)) -> None:
        self.settings = LLMSettings(
            provider="fake",
            api_base_url="https://llm.fake/v1",
            api_key="fake-key",
            timeout=5,
            models={"draft": "fake-d", "review": "fake-r", "summary": "fake-s", "chat": "fake-c"},
        )
        self.rounds = rounds
        self.usage = usage
        self.seen = []

    def stream_messages(self, task_type, messages, temperature=0.6, usage_out=None, model=None, tools=None, reasoning_out=None, channels=False, tool_calls_out=None):
        self.seen.append([dict(item) for item in messages])
        if usage_out is not None:
            usage_out.update({"model": "fake-c", "token_input": self.usage[0], "token_output": self.usage[1]})
        for chunk in self.rounds[len(self.seen) - 1]:
            yield ("content", chunk) if channels else chunk

    def complete_messages(self, task_type, messages, model=None, tools=None, temperature=None):
        self.seen.append([dict(item) for item in messages])
        return LLMResult(
            content="".join(self.rounds[len(self.seen) - 1]),
            model="fake-c",
            token_input=self.usage[0],
            token_output=self.usage[1],
            cost_estimate=0.0,
        )


def test_a_turn_reads_then_proposes_without_leaking_the_protocol(client: TestClient) -> None:
    answer = "改好了：\n\n```markdown @briefs/0042.md\n" + BRIEF_DOC + "```\n就这样。"
    fake = use_fake(
        client,
        SteppedClient(
            [
                ["先查一下现有的弧。\n\n", TOOL_BLOCK_ARCS[:20], TOOL_BLOCK_ARCS[20:]],
                [answer],
            ]
        ),
    )
    novel_id = make_novel(client)
    create_arc(client, novel_id, start_chapter=1, end_chapter=30, objective="揭开星渊碑")

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "把第二个弧的收束提前两章，顺手补钩子", "mode": "plan"},
    )
    events = parse_sse(response.text)
    names = [name for name, _ in events]

    # it acted, and it said so
    assert "tool" in names
    tool = payload_of(events, "tool")
    assert tool["name"] == "read_file" and tool["ok"] is True and tool["step"] == 1
    # 6.5 第 2 步：轨迹要说得出这一步跑了多久、取回多少字
    assert isinstance(tool["ms"], int) and tool["ms"] >= 0
    assert isinstance(tool["chars"], int) and tool["chars"] > 0
    # the document it read reached the model on the second round
    assert any("揭开星渊碑" in item["content"] for item in fake.seen[1])
    # the control block never went on screen
    deltas = "".join(payload.get("text", "") for name, payload in events if name == "delta")
    assert "```tool" not in deltas
    assert "先查一下现有的弧。" in deltas and "就这样。" in deltas
    # and the proposal still arrives for the human to apply
    assert "proposal" in names
    assert payload_of(events, "proposal")["valid"] is True

    stored = client.get(f"/api/novels/{novel_id}/chat/messages").json()
    assistant = [row for row in stored if row["role"] == "assistant"][-1]
    assert "```tool" not in assistant["content"]


def test_a_turn_that_needs_nothing_costs_one_request(client: TestClient) -> None:
    fake = use_fake(client, SteppedClient([["第二个弧收在 30 章。"]]))
    novel_id = make_novel(client)
    create_arc(client, novel_id, start_chapter=1, end_chapter=30, objective="揭开星渊碑")

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "第二个弧收到哪了", "mode": "plan"},
    )
    events = parse_sse(response.text)
    assert "tool" not in [name for name, _ in events]
    assert len(fake.seen) == 1
    # 2026-09-10 (UI-BACKLOG 35.7): the five propose_* tools joined this surface when the
    # typed-action compiler landed; the expectation never followed, so the gate ran red.
    assert payload_of(events, "context")["tools"] == [
        "list_files", "propose_arcs", "propose_blueprint", "propose_chapter_brief",
        "propose_character", "propose_toc", "read_file", "web_search",
    ]


def test_over_budget_is_an_error_and_persists_no_reply(client: TestClient) -> None:
    fake = use_fake(client, SteppedClient([[TOOL_BLOCK_ARCS]] * 8))
    novel_id = make_novel(client)
    create_arc(client, novel_id, start_chapter=1, end_chapter=30, objective="揭开星渊碑")

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "把所有弧重排一遍", "mode": "plan"},
    )
    events = parse_sse(response.text)
    names = [name for name, _ in events]
    assert "error" in names
    message = payload_of(events, "error")["message"]
    # 轮=模型请求，步=工具调用，两个都要说清（判据 31.2）
    assert "6 轮上限" in message and "步工具调用" in message and "已执行" in message
    assert "done" not in names
    assert len(fake.seen) == 6  # the default ceiling, not eight
    stored = client.get(f"/api/novels/{novel_id}/chat/messages").json()
    assert [row for row in stored if row["role"] == "assistant"] == []


def test_the_ceiling_the_owner_saved_is_the_one_this_turn_runs_on(client: TestClient) -> None:
    """35.9：「可配置」要能在一轮真实请求里量出来，不然只是页面上多了两个输入框。"""
    client.put("/api/config/llm", json={"agent": {"max_steps": 2, "max_tokens": 1000}})
    # 每轮记 660 token：第 2 轮回来 1320，先撞主人存下的 1000，而不是出厂的 60000
    fake = use_fake(client, SteppedClient([[TOOL_BLOCK_ARCS]] * 6, usage=(600, 60)))
    novel_id = make_novel(client)
    create_arc(client, novel_id, start_chapter=1, end_chapter=30, objective="揭开星渊碑")

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "把所有弧重排一遍", "mode": "plan"},
    )
    message = payload_of(parse_sse(response.text), "error")["message"]
    assert "超过上限 1000（第 2 轮）" in message
    assert "当前上限 1000 token / 2 轮" in message
    assert len(fake.seen) == 2


def tool_block(name: str, payload: dict) -> str:
    return (
        "```tool\n"
        + json.dumps(
            {"name": name, "arguments": {"payload": json.dumps(payload, ensure_ascii=False)}},
            ensure_ascii=False,
        )
        + "\n```"
    )


def test_a_refused_action_returns_a_diagnostic_and_one_more_ask_lands_a_card(
    client: TestClient,
) -> None:
    """批注 35.6 判据 2 的那半句：模型输出不许直接成为可应用卡，中间必须过一次有界修复。

    校验本身由 `test_agent_tools.py` 钉；这条量的是**回路**——诊断真的回到了模型那一侧、
    并且整轮只多花一次请求（第三次是收尾那句话），不是无限重试。
    """
    # 模型真实发过的形状（35.2）：一条 `11-30` 的 B 层条目，想占住目录里一章。
    refused_ask = tool_block(
        "propose_toc", {"chapters": [{"number": "11-30", "title": "弧 3：门钥之谜"}]}
    )
    reask = tool_block(
        "propose_arcs",
        {"arcs": [{"title": "门钥之谜", "start_chapter": 11, "end_chapter": 30}]},
    )
    fake = use_fake(
        client,
        SteppedClient([[refused_ask], [reask], ["这条弧挂在第 11 到 30 章，已改到 C 层。"]]),
    )
    novel_id = make_novel(client)

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "新增一条弧，11 到 30 章", "mode": "plan"},
    )
    events = parse_sse(response.text)
    steps = [payload for name, payload in events if name == "tool"]

    assert [(step["name"], step["ok"]) for step in steps[:2]] == [
        ("propose_toc", False),
        ("propose_arcs", True),
    ]
    carried = [
        item["content"] for round_two_onwards in fake.seen[1:] for item in round_two_onwards
    ]
    assert any(
        "动作未通过校验" in text and "update_arcs" in text for text in carried
    ), "诊断没回到模型那一侧"
    assert len(fake.seen) == 3, [len(rounds) for rounds in fake.seen]

    card = payload_of(events, "proposal")
    assert card["path"] == "arcs.md"
    assert card["valid"] is True, card["error"]
    applied = client.put(
        f"/api/novels/{novel_id}/files/arcs.md",
        json={"text": card["text"], "actor": "ai"},
    )
    assert applied.status_code == 200, applied.text
    assert len(client.get(f"/api/novels/{novel_id}/planning/arcs").json()) == 1


def test_a_propose_toc_ask_lands_the_b_layer_on_the_chapter_rows(client: TestClient) -> None:
    """批注 35.6 第 2 类：B 层要从「一次工具调用」量到「Chapter 行真的存在」。

    走 tool 块而不是手写围栏，量的才是 Agent 唯一那张写表面：动作编译出的路径、
    schema 与卡上的文本，和主人点应用后文件层认的，必须是同一份。
    """
    use_fake(
        client,
        SteppedClient(
            [
                [tool_block("propose_toc", {
                    "chapters": [
                        {"number": 1, "title": "开门", "plot_function": "立谜", "notes": "第一把钥"},
                        {"number": 2, "title": "验钥", "plot_function": "抬价", "notes": ""},
                    ]
                })],
                ["目录排了两章。"],
            ]
        ),
    )
    novel_id = make_novel(client)

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "先把前两章的目录排出来", "mode": "plan"},
    )
    events = parse_sse(response.text)
    card = payload_of(events, "proposal")
    assert card["path"] == "toc.md"
    assert card["valid"] is True, card["error"]
    assert client.get(f"/api/novels/{novel_id}/chapters").json() == []

    applied = client.put(
        f"/api/novels/{novel_id}/files/toc.md",
        json={"text": card["text"], "actor": "ai"},
    )
    assert applied.status_code == 200, applied.text
    assert [row["chapter_number"] for row in client.get(
        f"/api/novels/{novel_id}/chapters").json()] == [1, 2]


def test_the_b_layer_card_arrives_while_the_stream_is_still_open(client: TestClient) -> None:
    """批注 32.4「B 层生成必须实时落到提案与渲染层」：卡跟着那一步到，不等收尾那句客套话。

    从前 `proposal` 只在整条流收尾时发一次（`stream_turn` 末尾），于是提案早就成了、
    界面却要等模型把收尾语打完字才动。这条量的是**事件顺序**，不是有没有卡。
    """
    use_fake(
        client,
        SteppedClient(
            [
                [tool_block("propose_toc", {
                    "chapters": [
                        {"number": 1, "title": "开门", "plot_function": "立谜", "notes": ""},
                        {"number": 2, "title": "验钥", "plot_function": "抬价", "notes": ""},
                    ]
                })],
                ["目录排了两章，"],
                ["后面再补。"],
            ]
        ),
    )
    novel_id = make_novel(client)

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "先把前两章的目录排出来", "mode": "plan"},
    )
    events = parse_sse(response.text)
    order = [name for name, _ in events]
    cards = [payload for name, payload in events if name == "proposal"]

    assert order.index("tool") < order.index("proposal"), order
    last_delta = max(i for i, name in enumerate(order) if name == "delta")
    assert order.index("proposal") < last_delta, order
    # 同一条提案不因中途发过一次、收尾又发一次而变成两张卡（D-40 只有一条通道）
    assert len(cards) == 1, cards
    assert cards[0]["path"] == "toc.md" and cards[0]["valid"] is True, cards[0]
    # 实时不等于越权：卡已经在界面上了，真源一行都还没写（D-37）
    assert client.get(f"/api/novels/{novel_id}/chapters").json() == []


def test_a_propose_character_ask_lands_a_real_archive(client: TestClient) -> None:
    """批注 35.6 第 5 类：建人物也要从工具量到人，且确认前不落库（D-37）。"""
    use_fake(
        client,
        SteppedClient(
            [
                [tool_block("propose_character", {"name": "沈砚", "identity": "守钥人末代"})],
                ["沈砚建档了，等他登场。"],
            ]
        ),
    )
    novel_id = make_novel(client)

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "新增一个角色沈砚，守钥人末代", "mode": "plan"},
    )
    events = parse_sse(response.text)
    card = payload_of(events, "proposal")
    assert card["path"] == "settings/characters/new.md"
    assert card["valid"] is True, card["error"]
    assert client.get(f"/api/novels/{novel_id}/characters").json() == []

    applied = client.put(
        f"/api/novels/{novel_id}/files/settings/characters/new.md",
        json={"text": card["text"], "actor": "ai"},
    )
    assert applied.status_code == 200, applied.text
    # 写入回报的是它真正落的那格（D-47），不是卡片标题上那个 new.md
    assert applied.json()["path"] != "settings/characters/new.md"
    rows = client.get(f"/api/novels/{novel_id}/characters").json()
    assert [(row["name"], row["identity"]) for row in rows] == [("沈砚", "守钥人末代")]
