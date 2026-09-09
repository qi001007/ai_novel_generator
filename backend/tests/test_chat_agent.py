import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.llm import (
    LLMError,
    LLMResult,
    LLMSettings,
    LLMUnavailableError,
    get_llm_client,
)
from tests.planning_helpers import (
    create_arc,
    create_brief,
    create_chapter,
    create_character,
    create_setting,
)


@pytest.fixture(autouse=True)
def _keep_tests_offline(monkeypatch) -> None:
    """The chat agent must never reach the real API from a test."""
    monkeypatch.setenv("NOVEL_LLM_API_KEY", "")


class FakeChatClient:
    def __init__(
        self,
        reply: str = "第一段回复",
        chunks: list[str] | None = None,
        error: Exception | None = None,
        # 推理片段单独一路：真网关（MiniMax）是先吐 reasoning 再吐 content，
        # 假客户端也得是这个顺序，否则测不出主人批注 6 说的那个先后。
        reasoning: list[str] | None = None,
    ) -> None:
        self.reasoning = reasoning
        self.settings = LLMSettings(
            provider="fake",
            api_base_url="https://llm.fake/v1",
            api_key="fake-key",
            timeout=5,
            models={
                "draft": "fake-draft",
                "review": "fake-review",
                "summary": "fake-summary",
                "chat": "fake-chat",
            },
        )
        self.reply = reply
        self.chunks = chunks
        self.error = error
        self.calls: list[dict] = []

    def complete(self, task_type: str, system: str, user: str) -> LLMResult:
        return self.complete_messages(
            task_type,
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
        )

    def complete_messages(
        self,
        task_type: str,
        messages: list[dict[str, str]],
        model: str | None = None,
        tools: list[dict] | None = None,
        temperature: float | None = None,
    ) -> LLMResult:
        self.calls.append(
            {"kind": "complete", "messages": messages, "model": model}
        )
        if self.error is not None:
            raise self.error
        return LLMResult(
            content=self.reply,
            model=model or self.settings.models[task_type],
            token_input=120,
            token_output=34,
            cost_estimate=0.0,
        )

    def stream_messages(
        self,
        task_type: str,
        messages: list[dict[str, str]],
        temperature: float = 0.6,
        usage_out: dict[str, int] | None = None,
        model: str | None = None,
        tools: list[dict] | None = None,
        reasoning_out: list[str] | None = None,
        channels: bool = False,
        tool_calls_out: list[dict] | None = None,
    ) -> Iterator[Any]:
        self.calls.append(
            {
                "kind": "stream",
                "messages": messages,
                "model": model,
                "temperature": temperature,
            }
        )
        if self.error is not None:
            raise self.error
        for piece in self.reasoning or []:
            if reasoning_out is not None:
                reasoning_out.append(piece)
            if channels:
                yield ("reasoning", piece)
        for chunk in self.chunks or [self.reply]:
            yield ("content", chunk) if channels else chunk
        if usage_out is not None:
            resolved = model or self.settings.models[task_type]
            usage_out["model"] = resolved
            usage_out["token_input"] = 210
            usage_out["token_output"] = 56


def use_fake(client: TestClient, fake: FakeChatClient) -> FakeChatClient:
    app.dependency_overrides[get_llm_client] = lambda: fake
    return fake


def make_novel(client: TestClient, title: str = "九霄对话测试") -> int:
    return client.post("/api/novels", json={"title": title}).json()["id"]


def parse_sse(body: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for block in body.strip().split("\n\n"):
        name = None
        payload: dict = {}
        for line in block.split("\n"):
            if line.startswith("event: "):
                name = line[len("event: ") :]
            elif line.startswith("data: "):
                payload = json.loads(line[len("data: ") :])
        if name is not None:
            events.append((name, payload))
    return events


def payload_of(events: list[tuple[str, dict]], name: str) -> dict:
    return next(payload for event, payload in events if event == name)


def test_both_engines_bill_the_same_token_dimension(client: TestClient, monkeypatch) -> None:
    """§六 第 2 步 · 判据 31.2：换引擎不许换单位。

    generation_run 里那对数字仍是网关自己报的 prompt/completion 原值，两条通路一模一样。
    """

    def bill(engine: str) -> tuple[int, int]:
        monkeypatch.setenv("NOVEL_AGENT_ENGINE", engine)
        use_fake(client, FakeChatClient())
        novel_id = make_novel(client, f"九霄对话测试-{engine}")
        # 界面走的那一条：流式。两条引擎必须报同一对数字。
        body = client.post(
            f"/api/novels/{novel_id}/chat/stream",
            json={"content": "主角的目标是什么", "mode": "plan"},
        ).text
        assert "done" in body, body[:200]
        run = client.get(f"/api/novels/{novel_id}/generation-runs").json()[0]
        return (run["token_input"], run["token_output"])

    assert bill("legacy") == bill("pydantic") == (210, 56)


def test_chat_reply_persists_message_pair_and_run(client: TestClient) -> None:
    fake = use_fake(client, FakeChatClient())
    novel_id = make_novel(client)

    response = client.post(
        f"/api/novels/{novel_id}/chat",
        json={"content": "主角的目标是什么", "mode": "plan"},
    )

    assert response.status_code == 201
    reply = response.json()
    assert reply["role"] == "assistant"
    assert reply["content"] == "第一段回复"
    assert reply["mode"] == "plan"
    assert reply["model"] == "fake-chat"
    assert reply["token_input"] == 120
    assert reply["token_output"] == 34

    messages = client.get(f"/api/novels/{novel_id}/chat/messages").json()
    assert [row["role"] for row in messages] == ["user", "assistant"]
    assert messages[0]["content"] == "主角的目标是什么"

    runs = client.get(f"/api/novels/{novel_id}/generation-runs").json()
    assert len(runs) == 1
    assert runs[0]["task_type"] == "chat"
    assert runs[0]["model"] == "fake-chat"
    assert runs[0]["token_input"] == 120
    assert runs[0]["output"] == "第一段回复"
    assert fake.calls[0]["kind"] == "complete"


def test_plan_mode_prompt_forbids_prose(client: TestClient) -> None:
    fake = use_fake(client, FakeChatClient())
    novel_id = make_novel(client, "计划模式书")

    client.post(
        f"/api/novels/{novel_id}/chat",
        json={"content": "第三幕怎么收", "mode": "plan"},
    )

    system = fake.calls[0]["messages"][0]["content"]
    assert "《计划模式书》" in system
    assert "## 本轮模式：计划（plan）" in system
    assert "禁止输出章节正文" in system
    tail = fake.calls[0]["messages"][-1]
    assert tail == {"role": "user", "content": "第三幕怎么收"}


def test_write_mode_prompt_allows_prose(client: TestClient) -> None:
    fake = use_fake(client, FakeChatClient())
    novel_id = make_novel(client)

    client.post(
        f"/api/novels/{novel_id}/chat",
        json={"content": "写一段开场", "mode": "write"},
    )

    system = fake.calls[0]["messages"][0]["content"]
    assert "## 本轮模式：写作（write）" in system
    assert "不加解释、不加标题、不加大纲" in system


def test_the_reasoning_arrives_before_the_first_content_delta(client: TestClient) -> None:
    """主人 2026-09-07 批注 6：思考过程要**先于**正文流出来，不是答完才补一个折叠。

    这条走的是整条通路（SSE 路由 → stream_turn → agent → 假客户端），不是把某个
    解析函数单独测一遍 - 27.1 刚为「测试绿但通路不存在」记过账。
    """
    use_fake(
        client,
        FakeChatClient(chunks=["正", "文"], reasoning=["先想一想", "再决定"]),
    )
    novel_id = make_novel(client)

    events = parse_sse(
        client.post(
            f"/api/novels/{novel_id}/chat/stream",
            json={"content": "写吧", "mode": "write"},
        ).text
    )
    names = [name for name, _ in events]
    assert "reasoning" in names, names
    assert names.index("reasoning") < names.index("delta"), names
    assert [
        payload["text"] for name, payload in events if name == "reasoning"
    ] == ["先想一想", "再决定"]
    # 同一段推理仍然照 D-18 落进 reasoning 那一列，刷新后读得到同一份
    assert payload_of(events, "done")["message"]["reasoning"] == "先想一想再决定"


def test_stream_emits_context_delta_and_done(client: TestClient) -> None:
    fake = use_fake(client, FakeChatClient(chunks=["你", "好", "呀"]))
    novel_id = make_novel(client)

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "写一段开场", "mode": "write"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["x-accel-buffering"] == "no"

    events = parse_sse(response.text)
    names = [name for name, _ in events]
    assert names[0] == "context"
    assert names.count("delta") == 3
    assert names[-2:] == ["done", "end"]
    assert "".join(p["text"] for name, p in events if name == "delta") == "你好呀"
    assert payload_of(events, "context")["mode"] == "write"
    assert payload_of(events, "context")["temperature"] == 0.7

    done = payload_of(events, "done")["message"]
    assert done["content"] == "你好呀"
    assert done["token_input"] == 210
    assert done["token_output"] == 56
    assert fake.calls[0]["kind"] == "stream"
    assert fake.calls[0]["temperature"] == 0.7

    messages = client.get(f"/api/novels/{novel_id}/chat/messages").json()
    assert [row["role"] for row in messages] == ["user", "assistant"]
    runs = client.get(f"/api/novels/{novel_id}/generation-runs").json()
    assert runs[0]["token_output"] == 56


def test_plan_mode_streams_with_low_temperature(client: TestClient) -> None:
    fake = use_fake(client, FakeChatClient())
    novel_id = make_novel(client)

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "整本节奏怎么排", "mode": "plan"},
    )

    assert fake.calls[0]["temperature"] == 0.2
    assert payload_of(parse_sse(response.text), "context")["temperature"] == 0.2


def test_history_window_keeps_the_last_eight_messages(client: TestClient) -> None:
    fake = use_fake(client, FakeChatClient())
    novel_id = make_novel(client)

    for index in range(6):
        client.post(
            f"/api/novels/{novel_id}/chat",
            json={"content": f"第 {index} 个问题"},
        )

    messages = fake.calls[-1]["messages"]
    assert [row["role"] for row in messages] == [
        "system",
        "assistant",
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
    ]
    assert messages[-1]["content"] == "第 5 个问题"
    assert messages[1]["content"] == "第一段回复"


def test_resolved_mention_pins_that_material_first(client: TestClient) -> None:
    use_fake(client, FakeChatClient())
    novel_id = make_novel(client)
    character = create_character(client, novel_id, name="陈九思", goals="查清父亲失踪的真相")

    response = client.post(
        f"/api/novels/{novel_id}/chat",
        json={"content": "@人物:陈九思 的目标合理吗"},
    )

    refs = [item["ref"] for item in response.json()["context_refs"]]
    assert refs[0] == f"character:{character['id']}"
    user_rows = [
        row
        for row in client.get(f"/api/novels/{novel_id}/chat/messages").json()
        if row["role"] == "user"
    ]
    assert user_rows[0]["mentions"] == ["人物:陈九思"]


def test_unknown_mention_is_reported_to_the_model(client: TestClient) -> None:
    fake = use_fake(client, FakeChatClient())
    novel_id = make_novel(client)

    client.post(
        f"/api/novels/{novel_id}/chat",
        json={"content": "@不存在的角色 现在什么情况"},
    )

    system = fake.calls[0]["messages"][0]["content"]
    assert "## 未识别的 @引用" in system
    assert "@不存在的角色" in system


def test_context_endpoint_filters_candidates(client: TestClient) -> None:
    novel_id = make_novel(client)
    create_character(client, novel_id, name="陈九思", goals="查清真相")
    create_setting(client, novel_id, category="力量体系", name="星图", content="观星台所藏星图")

    by_kind = client.get(
        f"/api/novels/{novel_id}/chat/context", params={"kind": "character"}
    ).json()
    assert [item["label"] for item in by_kind] == ["人物 · 陈九思"]

    by_query = client.get(
        f"/api/novels/{novel_id}/chat/context", params={"q": "星图"}
    ).json()
    assert any(item["kind"] == "setting" for item in by_query)


def test_requested_model_must_be_configured(client: TestClient) -> None:
    use_fake(client, FakeChatClient())
    novel_id = make_novel(client)

    rejected = client.post(
        f"/api/novels/{novel_id}/chat",
        json={"content": "换个模型", "model": "gpt-omnipotent"},
    )
    assert rejected.status_code == 422

    accepted = client.post(
        f"/api/novels/{novel_id}/chat",
        json={"content": "换个模型", "model": "fake-chat"},
    )
    assert accepted.json()["model"] == "fake-chat"


def test_llm_failure_returns_503_without_a_reply_row(client: TestClient) -> None:
    use_fake(client, FakeChatClient(error=LLMUnavailableError("LLM 未配置")))
    novel_id = make_novel(client)

    response = client.post(
        f"/api/novels/{novel_id}/chat",
        json={"content": "还在吗"},
    )

    assert response.status_code == 503
    messages = client.get(f"/api/novels/{novel_id}/chat/messages").json()
    assert [row["role"] for row in messages] == ["user"]


def test_stream_reports_error_event(client: TestClient) -> None:
    use_fake(client, FakeChatClient(error=LLMError("上游超时")))
    novel_id = make_novel(client)

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "还在吗"},
    )

    events = parse_sse(response.text)
    assert [name for name, _ in events] == ["context", "error", "end"]
    assert payload_of(events, "error")["message"] == "上游超时"
    assert client.get(f"/api/novels/{novel_id}/generation-runs").json() == []


def test_clearing_history(client: TestClient) -> None:
    use_fake(client, FakeChatClient())
    novel_id = make_novel(client)
    client.post(f"/api/novels/{novel_id}/chat", json={"content": "先聊一句"})

    response = client.delete(f"/api/novels/{novel_id}/chat/messages")

    assert response.status_code == 204
    assert client.get(f"/api/novels/{novel_id}/chat/messages").json() == []


def test_empty_message_is_rejected(client: TestClient) -> None:
    use_fake(client, FakeChatClient())
    novel_id = make_novel(client)

    response = client.post(
        f"/api/novels/{novel_id}/chat", json={"content": "   "}
    )

    assert response.status_code == 422


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/novels/999/chat/messages"),
        ("delete", "/api/novels/999/chat/messages"),
        ("post", "/api/novels/999/chat"),
        ("post", "/api/novels/999/chat/stream"),
    ],
)
def test_chat_requires_an_existing_novel(
    client: TestClient, method: str, path: str
) -> None:
    use_fake(client, FakeChatClient())
    sender = getattr(client, method)

    response = (
        sender(path) if method in {"get", "delete"} else sender(path, json={"content": "喂"})
    )

    assert response.status_code == 404


def test_every_candidate_mention_resolves_back(client: TestClient) -> None:
    use_fake(client, FakeChatClient())
    novel_id = make_novel(client)
    character = create_character(client, novel_id, name="陈九思")
    create_chapter(client, novel_id, chapter_number=5, content="星图亮了。")

    items = client.get(f"/api/novels/{novel_id}/chat/context").json()
    mentions = {item["ref"]: item["mention"] for item in items}
    assert mentions[f"character:{character['id']}"] == "@人物:陈九思"
    assert mentions["novel"] == "@作品"
    assert "@正文:5" in mentions.values()

    for ref, mention in mentions.items():
        response = client.post(
            f"/api/novels/{novel_id}/chat",
            json={"content": f"{mention} 讲了什么"},
        )
        assert ref in [row["ref"] for row in response.json()["context_refs"]], mention


BRIEF_DOC = """# 第 42 章简报（D 层 · 单章简报）

> 文件名章号即主键。这一页是 `/generate` 的输入，也进对话上下文。「必要事实」按字面匹配校验，填能逐字找到的关键词，不填整句。

- **章节号**：42
- **所属弧**：—
- **视角**：沈曜
- **出场人物**：
  - 沈曜
- **状态**：draft

## 目标
揭开星渊碑

## 事件

## 冲突

## 钩子
碑上刻着他的名字

## 既定事实
"""


def test_prompt_teaches_the_file_proposal_format(client: TestClient) -> None:
    fake = use_fake(client, FakeChatClient())
    novel_id = make_novel(client)

    client.post(f"/api/novels/{novel_id}/chat", json={"content": "把目录第 3 章补完", "mode": "plan"})

    system = fake.calls[0]["messages"][0]["content"]
    # 35.8 推翻了本条原先钉的两件事：示例曾写在 `toc.md` 上（那五层从此只能走 propose_ 工具），
    # 以及「只改值」（D-39 改成允许追加、禁止删除与改号）。断言跟着搬到新决定上，没有删。
    assert "## 直接改文件" in system
    assert "```markdown @settings/foreshadow.md" in system
    assert "```markdown @toc.md" not in system
    assert "逐字节保持原样" in system
    assert "只改值" not in system
    assert "只允许**追加**" in system
    for tool in ("propose_blueprint", "propose_toc", "propose_arcs",
                 "propose_chapter_brief", "propose_character"):
        assert tool in system


def test_no_prompt_lets_a_hand_written_fence_stand_in_for_an_action_tool() -> None:
    """35.8：等价表述就是第二条通道，实测模型一次都没调用过 `propose_` 工具。"""
    from app.services.agent import TOOL_RULES
    from app.services.chat import FILE_EDIT_RULES

    for phrase in ("都可以", "还是直接输出", "也可以"):
        assert phrase not in FILE_EDIT_RULES, phrase
    # 五层各点名一次工具，且明说手写不算提出改动
    assert "只能走对应的 `propose_` 提案工具" in FILE_EDIT_RULES
    assert "你没有写文件的工具" in TOOL_RULES
    assert "propose_" in TOOL_RULES


# --- 35.10：意图判定，规划对象不许落进正文生成 ---

INTENT_CASES = [
    ("给第 3 章写一份简报", "plan"),
    ("把 B 层目录里第 11 到 30 章补齐", "plan"),
    ("新增一条剧情弧，讲真相与背叛", "plan"),
    ("建一个人物卡，叫沈砚", "plan"),
    ("更新 A 层蓝图里的主题", "plan"),
    ("settings/characters.md 里给沈砚加一条约束", "plan"),
    ("按简报把第 3 章的正文写出来", "write"),
    ("给第 3 章写正文，简报里那条伏笔要收", "write"),
    ("接着往下写，别停", "write"),
    # 既没点规划对象也没点成稿：这句话判不出来，照主人拨的开关走。
    ("这段节奏我觉得不对，你怎么看", None),
    ("你好", None),
]


@pytest.mark.parametrize("requested", ["write", "plan"])
@pytest.mark.parametrize("text,expected", INTENT_CASES)
def test_intent_table_decides_the_mode_symmetrically(requested, text, expected):
    """判出来的模式只跟这句话指向哪个对象有关：开关拨到 plan 说「要正文」同样得走写作。

    35.10 的复现是反方向的（write 开关 + 简报请求 → 吐正文），只修一半等于没修。
    """
    from app.services.chat import effective_mode

    assert effective_mode(text, requested) == (expected or requested)


def test_a_brief_request_under_the_write_toggle_gets_the_plan_prompt(client: TestClient) -> None:
    fake = use_fake(client, FakeChatClient())
    novel_id = make_novel(client)

    client.post(f"/api/novels/{novel_id}/chat", json={"content": "给第 1 章写一份简报", "mode": "write"})

    system = fake.calls[0]["messages"][0]["content"]
    assert "## 本轮模式：计划" in system, system
    assert "## 本轮模式：写作" not in system, system
    # 简报是 D 层，走的是提案工具这一路，不是把正文吐在对话里
    assert "propose_chapter_brief" in system


def test_a_prose_request_under_the_plan_toggle_gets_the_write_prompt(client: TestClient) -> None:
    fake = use_fake(client, FakeChatClient())
    novel_id = make_novel(client)

    client.post(f"/api/novels/{novel_id}/chat", json={"content": "把第 1 章的正文写出来", "mode": "plan"})

    system = fake.calls[0]["messages"][0]["content"]
    assert "## 本轮模式：写作" in system, system
    assert "禁止输出章节正文" not in system, system


def test_stream_emits_a_reviewable_file_proposal(client: TestClient) -> None:
    # The fenced block deliberately arrives split across deltas.
    chunks = [
        "改好了：\n\n```markdown @briefs/0042.m",
        "d\n" + BRIEF_DOC + "```\n",
    ]
    use_fake(client, FakeChatClient(chunks=chunks))
    novel_id = make_novel(client)
    create_brief(
        client,
        novel_id,
        chapter_number=42,
        goal="揭开星渊碑",
        pov="沈曜",
        characters=["沈曜"],
    )

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "把第 42 章的钩子改紧", "mode": "write"},
    )

    events = parse_sse(response.text)
    names = [name for name, _ in events]
    assert names.index("proposal") < names.index("done")
    proposal = payload_of(events, "proposal")
    assert proposal["path"] == "briefs/0042.md"
    assert proposal["valid"] is True
    assert "## 钩子\n碑上刻着他的名字" in proposal["text"]

    applied = client.put(
        f"/api/novels/{novel_id}/files/briefs/0042.md",
        json={"text": proposal["text"], "actor": "ai"},
    )
    assert applied.status_code == 200
    assert applied.json()["changed"] == ["hook"]
    briefs = client.get(f"/api/novels/{novel_id}/planning/briefs").json()
    assert briefs[0]["hook"] == "碑上刻着他的名字"


def test_streamed_initial_arc_alias_proposal_with_two_records_is_reviewable_and_applicable(
    client: TestClient,
) -> None:
    proposal = (
        "```markdown @arcs.md\n"
        "# 剧情弧（C 层）\n\n"
        "> `弧 N` 是主键。\n\n"
        "## 弧 1 觉醒·逃亡\n"
        "- **起止章节**：第 01 - 05 章\n"
        "- **核心事件**：主角获得能力\n"
        "- **弧内悬念**：谁在追捕主角\n"
        "- **人物弧光**：从普通人走向觉醒者\n"
        "## 弧 2 真相·反击\n"
        "- **起止章**：第 06 - 10 章\n"
        "- **核心事件**：主角发现追捕者的目的\n"
        "- **弧内悬念**：能力的代价是什么\n"
        "- **人物弧光**：从逃亡者走向反击者\n"
        "```"
    )
    use_fake(client, FakeChatClient(chunks=[proposal]))
    novel_id = make_novel(client)

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "生成第一幕剧情弧", "mode": "plan"},
    )

    review = payload_of(parse_sse(response.text), "proposal")
    assert review["valid"] is True, review["error"]
    applied = client.put(
        f"/api/novels/{novel_id}/files/arcs.md",
        json={"text": review["text"], "actor": "ai"},
    )
    assert applied.status_code == 200, applied.text
    arcs = client.get(f"/api/novels/{novel_id}/planning/arcs").json()
    assert len(arcs) == 2
    assert [arc["title"] for arc in arcs] == ["觉醒·逃亡", "真相·反击"]
    current = client.get(f"/api/novels/{novel_id}/files/arcs.md").json()["text"]
    history = client.get(f"/api/novels/{novel_id}/chat/messages").json()
    restored = next(
        row["proposals"][0]
        for row in history
        if row["role"] == "assistant" and row["proposals"]
    )
    assert restored["valid"] is True
    assert restored["error"] == ""
    assert restored["text"] == current


def test_a_streamed_blueprint_fence_applies_to_the_a_layer(client: TestClient) -> None:
    """批注 35.6 第 1 类：A 层也要从「模型输出」量到「库里那行变了」。"""
    use_fake(
        client,
        FakeChatClient(
            chunks=[
                "```markdown @blueprint.md\n"
                "## 主线\n沈曜要关上玄赿之门\n\n"
                "## 终局\n门开了，代价是他自己的名字\n\n"
                "## 核心冲突\n救人与救世不可兼得\n\n"
                "## 主题\n选择即身份\n\n"
                "## 约束\n不写复活\n"
                "```"
            ]
        ),
    )
    novel_id = make_novel(client)

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "A 层蓝图改成这一版", "mode": "plan"},
    )

    proposal = payload_of(parse_sse(response.text), "proposal")
    assert proposal["path"] == "blueprint.md"
    assert proposal["valid"] is True, proposal["error"]
    # 卡画出来了，库里还什么都没有：Agent 只提案，主人点应用之前不落库。
    assert client.get(f"/api/novels/{novel_id}/planning/blueprints").json() == []

    applied = client.put(
        f"/api/novels/{novel_id}/files/blueprint.md",
        json={"text": proposal["text"], "actor": "ai"},
    )
    assert applied.status_code == 200, applied.text
    assert sorted(applied.json()["changed"]) == [
        "constraints",
        "core_conflicts",
        "ending",
        "main_line",
        "themes",
    ]
    rows = client.get(f"/api/novels/{novel_id}/planning/blueprints").json()
    assert [row["main_line"] for row in rows] == ["沈曜要关上玄赿之门"]
    projection = client.get(f"/api/novels/{novel_id}/files/blueprint.md").json()["text"]
    assert "门开了，代价是他自己的名字" in projection


def test_a_streamed_prose_fence_lands_on_the_chapter_it_names(client: TestClient) -> None:
    """批注 35.6 第 4 类的正文那一半：`chapters/NNNN/draft.md` 也得从围栏量到 Chapter 行。"""
    prose = "碑上的名字是他自己的。\n\n他伸手去碰，指尖穿过了光。"
    use_fake(
        client,
        FakeChatClient(
            chunks=[f"```markdown @chapters/0001/draft.md\n# 第 0001 章正文\n\n{prose}\n```"]
        ),
    )
    novel_id = make_novel(client)
    create_chapter(client, novel_id, chapter_number=1)

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "把第 1 章的正文写出来", "mode": "write"},
    )

    proposal = payload_of(parse_sse(response.text), "proposal")
    assert proposal["path"] == "chapters/0001/draft.md"
    assert proposal["valid"] is True, proposal["error"]
    assert "指尖穿过了光" in proposal["text"]

    def chapter() -> dict:
        return next(
            item for item in client.get(f"/api/novels/{novel_id}/chapters").json()
            if item["chapter_number"] == 1
        )

    assert chapter()["content"] == ""

    applied = client.put(
        f"/api/novels/{novel_id}/files/chapters/0001/draft.md",
        json={"text": proposal["text"], "actor": "ai"},
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["changed"] == ["content"]
    saved = chapter()
    assert saved["content"] == prose
    assert saved["word_count"] == len(prose)


def test_history_carries_the_proposal_back_for_a_reload(client: TestClient) -> None:
    """A refresh must not swallow a review card the owner never applied."""
    use_fake(
        client,
        FakeChatClient(chunks=["改好了：\n\n```md @briefs/0042.md\n" + BRIEF_DOC + "```\n"]),
    )
    novel_id = make_novel(client)
    create_brief(
        client,
        novel_id,
        chapter_number=42,
        goal="揭开星渊碑",
        pov="沈曜",
        characters=["沈曜"],
    )
    client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "把第 42 章的钩子改紧", "mode": "write"},
    )

    rows = client.get(f"/api/novels/{novel_id}/chat/messages").json()
    assistant = next(row for row in rows if row["role"] == "assistant")
    reader = next(row for row in rows if row["role"] == "user")

    assert [p["path"] for p in assistant["proposals"]] == ["briefs/0042.md"]
    assert assistant["proposals"][0]["valid"] is True
    assert "碑上刻着他的名字" in assistant["proposals"][0]["text"]
    assert reader["proposals"] == []


def test_a_rewrapped_untouched_section_keeps_the_file_wrapping(client: TestClient) -> None:
    """The model re-wraps lines it was told to leave alone; that churn is not a change.

    Without stabilising, one edited value shows up as a 47-line diff and the owner
    cannot see what actually moved.
    """
    rewrapped = BRIEF_DOC.replace("## 目标\n揭开星渊碑", "## 目标\n揭开\n星渊碑").replace(
        "## 钩子\n碑上刻着他的名字", "## 钩子\n名字刻在碑上"
    )
    use_fake(client, FakeChatClient(chunks=["```md @briefs/0042.md\n" + rewrapped + "```\n"]))
    novel_id = make_novel(client)
    create_brief(
        client,
        novel_id,
        chapter_number=42,
        goal="揭开星渊碑",
        pov="沈曜",
        characters=["沈曜"],
    )
    client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "把第 42 章的钩子改一下", "mode": "write"},
    )

    rows = client.get(f"/api/novels/{novel_id}/chat/messages").json()
    assistant = next(row for row in rows if row["role"] == "assistant")
    text = assistant["proposals"][0]["text"]

    # 目标 was only re-wrapped -> restored to the file's own single line.
    assert "## 目标\n揭开星渊碑\n" in text
    assert "## 目标\n揭开\n星渊碑" not in text
    # 钩子 really changed -> the new value survives.
    assert "## 钩子\n名字刻在碑上\n" in text


def test_a_proposal_that_renumbers_a_record_is_flagged_before_the_click(client: TestClient) -> None:
    """The writer rejects a moved primary key, so the card must too.

    Measured live: the model proposed arcs.md with `弧 3` rewritten as another
    number. The card said valid and offered 应用, and only the click found out.
    """
    use_fake(
        client,
        FakeChatClient(
            chunks=["```markdown @arcs.md\n" + "## 弧 99 碑鸣\n- **起始章**：1\n- **结束章**：3\n"
                    "- **目标**：\n- **冲突**：\n- **收束**：\n- **状态**：planned\n" "```"]
        ),
    )
    novel_id = make_novel(client)
    create_arc(client, novel_id, start_chapter=1, end_chapter=3, objective="让主角第一次违律")

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "重排剧情弧", "mode": "plan"},
    )
    events = parse_sse(response.text)
    assert "proposal" in [name for name, _ in events]
    proposal = payload_of(events, "proposal")
    assert proposal["valid"] is False
    assert "主键" in proposal["error"]


def test_proposal_that_renames_keys_is_flagged(client: TestClient) -> None:
    """A card the writer must reject is not a card worth an 应用 button."""
    use_fake(
        client,
        FakeChatClient(
            chunks=[
                "```markdown @blueprint.md\n"
                "## 主线一条线\n\n"
                "## 终局\n\n"
                "## 核心冲突\n\n"
                "## 主题\n\n"
                "## 约束\n"
                "```"
            ]
        ),
    )
    novel_id = make_novel(client)

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "改蓝图", "mode": "write"},
    )

    proposal = payload_of(parse_sse(response.text), "proposal")
    assert proposal["valid"] is False
    assert "主线" in proposal["error"]
    assert "主线一条线" in proposal["error"]

    rejected = client.put(
        f"/api/novels/{novel_id}/files/blueprint.md",
        json={"text": proposal["text"], "actor": "ai"},
    )
    assert rejected.status_code == 422


def test_a_legacy_yaml_fence_still_becomes_a_proposal(client: TestClient) -> None:
    """The file surface moved to Markdown; a model mid-sentence in YAML still lands."""
    use_fake(
        client,
        FakeChatClient(chunks=["```yaml @blueprint.md\n## 主线\n一条线\n\n## 终局\n\n## 核心冲突\n\n## 主题\n\n## 约束\n```"]),
    )
    novel_id = make_novel(client)

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "改蓝图", "mode": "write"},
    )

    proposal = payload_of(parse_sse(response.text), "proposal")
    assert proposal["path"] == "blueprint.md"
    assert proposal["valid"] is True, proposal["error"]


def test_proposal_for_an_unknown_file_is_flagged(client: TestClient) -> None:
    use_fake(client, FakeChatClient(chunks=["```markdown @secrets.md\n## 任何东西\n```"]))
    novel_id = make_novel(client)

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "给我看别的文件"},
    )

    proposal = payload_of(parse_sse(response.text), "proposal")
    assert proposal["valid"] is False
    assert "没有这个文件" in proposal["error"]
