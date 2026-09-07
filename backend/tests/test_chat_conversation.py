"""「新建对话」opens a second thread and never deletes the first (第二十八批批注 8).

These pin the three things that are easy to get wrong: an opened-but-empty thread
survives a reload, the history window stops at the thread edge, and the old thread is
still readable afterwards - 「收尾」is not a synonym for delete.
"""

from fastapi.testclient import TestClient

from tests.test_chat_agent import FakeChatClient, make_novel, use_fake


def _ask(client: TestClient, novel_id: int, text: str) -> None:
    response = client.post(f"/api/novels/{novel_id}/chat", json={"content": text})
    assert response.status_code == 201, response.text


def _messages(client: TestClient, novel_id: int, **params) -> list[dict]:
    return client.get(f"/api/novels/{novel_id}/chat/messages", params=params).json()


def _threads(rows: list[dict]) -> set[int]:
    return {int(row["conversation_id"]) for row in rows}


def test_opening_a_thread_numbers_up_from_one(client: TestClient) -> None:
    novel_id = make_novel(client)
    started = client.post(f"/api/novels/{novel_id}/chat/conversation").json()
    assert started == {"conversation_id": 2}


def test_an_opened_thread_stays_open_before_it_has_a_message(client: TestClient) -> None:
    novel_id = make_novel(client)
    use_fake(client, FakeChatClient(reply="旧线程的回答"))
    _ask(client, novel_id, "旧线程的问题")
    assert _threads(_messages(client, novel_id)) == {1}

    client.post(f"/api/novels/{novel_id}/chat/conversation")
    # Nothing typed yet: the pane is empty, and it comes back empty after a reload.
    assert _messages(client, novel_id) == []


def test_the_next_message_lands_in_the_new_thread_and_the_old_one_survives(
    client: TestClient,
) -> None:
    novel_id = make_novel(client)
    use_fake(client, FakeChatClient(reply="回答"))
    _ask(client, novel_id, "第一线程的问题")
    old = _messages(client, novel_id)
    assert [row["content"] for row in old] == ["第一线程的问题", "回答"]

    client.post(f"/api/novels/{novel_id}/chat/conversation")
    _ask(client, novel_id, "第二线程的问题")

    new = _messages(client, novel_id)
    assert _threads(new) == {2}
    assert [row["content"] for row in new] == ["第二线程的问题", "回答"]
    # 收尾, not 删除: the first thread is still there under its own id.
    kept = _messages(client, novel_id, conversation=1)
    assert [row["content"] for row in kept] == ["第一线程的问题", "回答"]


def test_the_history_window_does_not_leak_across_threads(client: TestClient) -> None:
    novel_id = make_novel(client)
    fake = FakeChatClient(reply="回答")
    use_fake(client, fake)
    _ask(client, novel_id, "旧线程的话")
    client.post(f"/api/novels/{novel_id}/chat/conversation")
    _ask(client, novel_id, "新线程的话")

    sent = [call for call in fake.calls if call["kind"] == "complete"][-1]["messages"]
    contents = [item["content"] for item in sent if item["role"] != "system"]
    assert "新线程的话" in contents
    assert "旧线程的话" not in contents
    assert all("旧线程的话" not in item["content"] for item in sent)


def test_the_conversation_list_groups_by_thread(client: TestClient) -> None:
    """左栏「对话」那一页的数据源（第二十九批批注 6：开了新对话聊过以后那里还是空的）。"""
    novel_id = make_novel(client)
    use_fake(client, FakeChatClient(reply="第一线程的回答"))
    _ask(client, novel_id, "第一个问题")
    client.post(f"/api/novels/{novel_id}/chat/conversation")
    use_fake(client, FakeChatClient(reply="第二线程的回答"))
    _ask(client, novel_id, "第二个问题")

    listed = client.get(f"/api/novels/{novel_id}/chat/conversations").json()
    assert [item["conversation_id"] for item in listed] == [2, 1], "最新说话的排在前"
    # 首句取该线程第一条 user - Agent 的开场白不落库，拿它当标题每条都一样
    assert [item["first_question"] for item in listed] == ["第二个问题", "第一个问题"]
    assert [item["message_count"] for item in listed] == [2, 2]
    assert [item["is_current"] for item in listed] == [True, False]


def test_an_opened_thread_without_a_question_is_not_listed(client: TestClient) -> None:
    """开了但没说话的那一条不算历史：它没有首句可显示，列出来是个空壳。"""
    novel_id = make_novel(client)
    use_fake(client, FakeChatClient(reply="答"))
    _ask(client, novel_id, "唯一的问题")
    client.post(f"/api/novels/{novel_id}/chat/conversation")

    listed = client.get(f"/api/novels/{novel_id}/chat/conversations").json()
    assert [item["conversation_id"] for item in listed] == [1]


def test_two_opens_in_a_row_do_not_reuse_a_number(client: TestClient) -> None:
    novel_id = make_novel(client)
    use_fake(client, FakeChatClient())
    _ask(client, novel_id, "第一条")
    assert client.post(f"/api/novels/{novel_id}/chat/conversation").json() == {"conversation_id": 2}
    assert client.post(f"/api/novels/{novel_id}/chat/conversation").json() == {"conversation_id": 3}
