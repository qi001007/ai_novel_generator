"""Attachments (第十九批批注 1): a file the owner hangs on one message must reach the
model through the one context list, and refuse loudly rather than silently dropping."""

from fastapi.testclient import TestClient

from app.main import app
from tests.test_chat_agent import FakeChatClient, make_novel, parse_sse, payload_of, use_fake


def _post(client: TestClient, novel_id: int, payload: dict):
    return client.post(f"/api/novels/{novel_id}/chat", json=payload)


def test_an_attachment_reaches_the_prompt_and_the_record(client: TestClient) -> None:
    fake = use_fake(client, FakeChatClient(reply="收到"))
    novel_id = make_novel(client)

    response = _post(
        client,
        novel_id,
        {
            "content": "按这份设定检查第 1 章",
            "attachments": [{"name": "AGENTS.md", "text": "碑律第一条：不可靠近碑面。"}],
        },
    )

    assert response.status_code == 201, response.text
    sent = fake.calls[0]["messages"]
    joined = "\n".join(message["content"] for message in sent)
    assert "【附件 · AGENTS.md】" in joined
    assert "碑律第一条：不可靠近碑面。" in joined
    refs = [(item["kind"], item["ref"]) for item in response.json()["context_refs"]]
    assert ("附件", "attachment:AGENTS.md") in refs


def test_the_stream_reports_the_attachment_in_the_injection_list(client: TestClient) -> None:
    use_fake(client, FakeChatClient(chunks=["好"]))
    novel_id = make_novel(client)

    response = client.post(
        f"/api/novels/{novel_id}/chat/stream",
        json={
            "content": "参考这份文件",
            "attachments": [{"name": "notes.txt", "text": "星潮夜，碑上有字。"}],
        },
    )

    events = parse_sse(response.text)
    items = payload_of(events, "context")["items"]
    assert any(item["ref"] == "attachment:notes.txt" for item in items)


def test_a_binary_is_refused_with_a_reason(client: TestClient) -> None:
    use_fake(client, FakeChatClient())
    novel_id = make_novel(client)

    response = _post(
        client,
        novel_id,
        {"content": "看图", "attachments": [{"name": "cover.png", "text": "PNG\x89..."}]},
    )

    assert response.status_code == 422, response.text
    assert "cover.png" in response.json()["detail"]
    assert "文本文件" in response.json()["detail"]


def test_an_empty_file_is_refused_rather_than_dropped(client: TestClient) -> None:
    use_fake(client, FakeChatClient())
    novel_id = make_novel(client)

    response = _post(
        client,
        novel_id,
        {"content": "读它", "attachments": [{"name": "blank.md", "text": "   \n "}]},
    )

    assert response.status_code == 422
    assert "blank.md" in response.json()["detail"]


def test_an_oversized_file_is_refused_with_its_size(client: TestClient) -> None:
    use_fake(client, FakeChatClient())
    novel_id = make_novel(client)

    response = _post(
        client,
        novel_id,
        {"content": "大文件", "attachments": [{"name": "big.md", "text": "字" * 20_001}]},
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "20001" in detail and "20000" in detail


def test_too_many_files_is_refused(client: TestClient) -> None:
    use_fake(client, FakeChatClient())
    novel_id = make_novel(client)
    files = [{"name": f"n{i}.txt", "text": "内容"} for i in range(9)]

    response = _post(client, novel_id, {"content": "多文件", "attachments": files})

    assert response.status_code == 422
    assert "8" in response.json()["detail"]


def test_no_attachments_changes_nothing_about_the_prompt(client: TestClient) -> None:
    fake = use_fake(client, FakeChatClient(reply="ok"))
    novel_id = make_novel(client)

    response = _post(client, novel_id, {"content": "普通提问"})

    assert response.status_code == 201
    joined = "\n".join(m["content"] for m in fake.calls[0]["messages"])
    assert "附件 ·" not in joined
