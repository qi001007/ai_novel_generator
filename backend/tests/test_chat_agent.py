import json
from collections.abc import Iterator

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
    ) -> None:
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
    ) -> Iterator[str]:
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
        for chunk in self.chunks or [self.reply]:
            yield chunk
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
    character = client.post(
        f"/api/novels/{novel_id}/characters",
        json={"name": "陈九思", "goals": "查清父亲失踪的真相"},
    ).json()

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
    client.post(
        f"/api/novels/{novel_id}/characters",
        json={"name": "陈九思", "goals": "查清真相"},
    )
    client.post(
        f"/api/novels/{novel_id}/settings",
        json={"category": "力量体系", "name": "星图", "content": "观星台所藏星图"},
    )

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
    character = client.post(
        f"/api/novels/{novel_id}/characters", json={"name": "陈九思"}
    ).json()
    client.post(
        f"/api/novels/{novel_id}/chapters",
        json={"chapter_number": 5, "title": "破镜", "content": "星图亮了。"},
    )

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


BRIEF_DOC = """chapter: 42
arc: null
goal: 揭开星渊碑
events: ''
pov: 沈曜
characters: [沈曜]
conflict: ''
hook: 碑上刻着他的名字
required_facts: []
status: draft
"""


def test_prompt_teaches_the_file_proposal_format(client: TestClient) -> None:
    fake = use_fake(client, FakeChatClient())
    novel_id = make_novel(client)

    client.post(f"/api/novels/{novel_id}/chat", json={"content": "把目录第 3 章补完", "mode": "plan"})

    system = fake.calls[0]["messages"][0]["content"]
    assert "## 直接改文件" in system
    assert "```yaml @toc.yaml" in system
    assert "只改值" in system


def test_stream_emits_a_reviewable_file_proposal(client: TestClient) -> None:
    # The fenced block deliberately arrives split across deltas.
    chunks = [
        "改好了：\n\n```yaml @briefs/0042.ya",
        "ml\n" + BRIEF_DOC + "```\n",
    ]
    use_fake(client, FakeChatClient(chunks=chunks))
    novel_id = make_novel(client)
    client.post(
        f"/api/novels/{novel_id}/planning/briefs",
        json={
            "chapter_number": 42,
            "goal": "揭开星渊碑",
            "pov": "沈曜",
            "characters": ["沈曜"],
        },
    )

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "把第 42 章的钩子改紧", "mode": "write"},
    )

    events = parse_sse(response.text)
    names = [name for name, _ in events]
    assert names.index("proposal") < names.index("done")
    proposal = payload_of(events, "proposal")
    assert proposal["path"] == "briefs/0042.yaml"
    assert proposal["valid"] is True
    assert "hook: 碑上刻着他的名字" in proposal["text"]

    applied = client.put(
        f"/api/novels/{novel_id}/files/briefs/0042.yaml",
        json={"text": proposal["text"], "actor": "ai"},
    )
    assert applied.status_code == 200
    assert applied.json()["changed"] == ["hook"]
    briefs = client.get(f"/api/novels/{novel_id}/planning/briefs").json()
    assert briefs[0]["hook"] == "碑上刻着他的名字"


def test_proposal_that_renames_keys_is_flagged(client: TestClient) -> None:
    """A card the writer must reject is not a card worth an 应用 button."""
    use_fake(
        client,
        FakeChatClient(
            chunks=[
                "```yaml @blueprint.yaml\n"
                "mainline: 一条线\n"
                "ending: ''\n"
                "core_conflicts: ''\n"
                "themes: ''\n"
                "constraints: ''\n"
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
    assert "main_line" in proposal["error"]
    assert "mainline" in proposal["error"]

    rejected = client.put(
        f"/api/novels/{novel_id}/files/blueprint.yaml",
        json={"text": proposal["text"], "actor": "ai"},
    )
    assert rejected.status_code == 422


def test_proposal_for_an_unknown_file_is_flagged(client: TestClient) -> None:
    use_fake(client, FakeChatClient(chunks=["```yaml @secrets.yaml\na: 1\n```"]))
    novel_id = make_novel(client)

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={"content": "给我看别的文件"},
    )

    proposal = payload_of(parse_sse(response.text), "proposal")
    assert proposal["valid"] is False
    assert "没有这个文件" in proposal["error"]

