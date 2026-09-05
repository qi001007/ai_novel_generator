"""S2: the chat route runs a real multi-step turn.

Acceptance for the kernel, end to end over the route the UI uses: the model asks
for a document, the server reads it through the file layer, the model proposes a
change, and the only write is still the human pressing 应用 as actor=ai.
"""

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

    def __init__(self, rounds) -> None:
        self.settings = LLMSettings(
            provider="fake",
            api_base_url="https://llm.fake/v1",
            api_key="fake-key",
            timeout=5,
            models={"draft": "fake-d", "review": "fake-r", "summary": "fake-s", "chat": "fake-c"},
        )
        self.rounds = rounds
        self.seen = []

    def stream_messages(self, task_type, messages, temperature=0.6, usage_out=None, model=None, tools=None, reasoning_out=None):
        self.seen.append([dict(item) for item in messages])
        if usage_out is not None:
            usage_out.update({"model": "fake-c", "token_input": 100, "token_output": 20})
        for chunk in self.rounds[len(self.seen) - 1]:
            yield chunk

    def complete_messages(self, task_type, messages, model=None, tools=None, temperature=None):
        self.seen.append([dict(item) for item in messages])
        return LLMResult(
            content="".join(self.rounds[len(self.seen) - 1]),
            model="fake-c",
            token_input=100,
            token_output=20,
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
    assert payload_of(events, "context")["tools"] == ["list_files", "read_file", "web_search"]


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
    assert "步" in payload_of(events, "error")["message"]
    assert "done" not in names
    assert len(fake.seen) == 6  # the default ceiling, not eight
    stored = client.get(f"/api/novels/{novel_id}/chat/messages").json()
    assert [row for row in stored if row["role"] == "assistant"] == []
