"""批注 35.34：斜杠命令那一行结算之后留在这一条线程上，刷新回来还是同一份。

真机取证（`.scratch/g3529c.mjs`，作品 6 副本库）：一次 `/generate` 全程，卡片上那三段文案
在屏上逐字可见；`Page.reload` 之后 `.chat-card.command` 0 张，而它替人做的事全在（简报 1 份、
正文 56 字、答案气泡 18 字仍在）——**结果留痕、过程不留痕**。这几条钉的就是补上的那一半：
一条命令一行、结算几次改写同一行、那一行不进模型的上下文。
"""

from fastapi.testclient import TestClient

from tests.test_chat_agent import FakeChatClient, make_novel, use_fake

SETTLED = {
    "command": "/generate",
    "status": "done",
    "detail": "第 1 章《第一章》· 56 字 · 机械校验 通过",
    "run_id": 12,
    "chapter_id": 3,
}


def record(client: TestClient, novel_id: int, **overrides) -> dict:
    payload = {**SETTLED, **overrides}
    response = client.post(f"/api/novels/{novel_id}/chat/commands", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def command_rows(client: TestClient, novel_id: int) -> list[dict]:
    rows = client.get(f"/api/novels/{novel_id}/chat/messages").json()
    return [row for row in rows if row["role"] == "command"]


def test_a_settled_command_lands_on_the_thread(client: TestClient) -> None:
    novel_id = make_novel(client)
    saved = record(client, novel_id)
    assert set(saved) == {"id"}

    rows = command_rows(client, novel_id)
    assert len(rows) == 1
    # 验收判据：detail 逐字等于刷新前那一份。结算文案住 content，不在别处再存一份。
    assert rows[0]["content"] == SETTLED["detail"]
    assert rows[0]["command_state"] == {
        "command": "/generate",
        "status": "done",
        "run_id": 12,
        "chapter_id": 3,
    }


def test_the_same_command_rewrites_its_row_instead_of_adding_a_second_one(client: TestClient) -> None:
    """35.29c 那条接力会结算两次：先「去补简报」，简报落地后再「正文结算」。一张卡只许一行。"""
    novel_id = make_novel(client)
    first = record(
        client,
        novel_id,
        detail="第 1 章还没有 D 层简报：先补简报，它一落地就自动接着写正文",
        run_id=None,
        chapter_id=None,
    )
    record(client, novel_id, message_id=first["id"], **SETTLED)

    rows = command_rows(client, novel_id)
    assert [row["id"] for row in rows] == [first["id"]], "第二次结算不许另起一行"
    assert rows[0]["content"] == SETTLED["detail"]
    assert rows[0]["command_state"]["run_id"] == 12


def test_an_unsettled_command_is_refused(client: TestClient) -> None:
    """「运行中」不落库：刷新回来的那一条不许顶着一个永远转不完的圈。"""
    novel_id = make_novel(client)
    response = client.post(
        f"/api/novels/{novel_id}/chat/commands", json={**SETTLED, "status": "running"}
    )
    assert response.status_code == 422, response.text
    assert command_rows(client, novel_id) == []


def test_a_command_row_never_replays_into_the_model_context(client: TestClient) -> None:
    """这一行是写给主人看的账，不是 Agent 说过的话：下一轮提问不许把它带回提示词。"""
    novel_id = make_novel(client)
    record(client, novel_id)
    fake = use_fake(client, FakeChatClient(reply="好"))
    client.post(f"/api/novels/{novel_id}/chat", json={"content": "继续写"})

    sent = [call for call in fake.calls if call["kind"] == "complete"][-1]["messages"]
    assert all(SETTLED["detail"] not in item["content"] for item in sent)
    assert [item["role"] for item in sent if item["role"] == "command"] == []


def test_an_id_that_is_not_this_book_s_command_row_starts_a_fresh_one(client: TestClient) -> None:
    """线程被清掉之后还活着的那张卡：下一次结算重新起一行，而不是去改写别人的那一行。"""
    novel_id = make_novel(client)
    other = make_novel(client, "隔壁那一本书")
    use_fake(client, FakeChatClient(reply="答"))
    client.post(f"/api/novels/{other}/chat", json={"content": "别的一本书的问题"})

    saved = record(client, novel_id, message_id=1)
    assert [row["id"] for row in command_rows(client, novel_id)] == [saved["id"]]
    kept = client.get(f"/api/novels/{other}/chat/messages").json()
    assert [row["role"] for row in kept] == ["user", "assistant"], "别的那一本书一个字没动"
