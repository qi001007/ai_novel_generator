"""The model's own reasoning has to reach the chat and stay out of the answer (批注 16.1)."""

import json

import httpx
import pytest
from sqlalchemy import create_engine, inspect
from sqlmodel import Session, select

from app import db as app_db
from app.models import ChatMessage, utc_now
from app.routers.chat import ChatMessageOut
from app.services.llm import LLMSettings, OpenAICompatibleClient


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


def test_stream_messages_keeps_reasoning_off_the_answer_channel() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=_sse([
                {"choices": [{"delta": {"reasoning_content": "先翻目录，"}}]},
                {"choices": [{"delta": {"content": "正文"}}]},
                {"choices": [{"delta": {"reasoning_content": "再核设定。"}}]},
                {"choices": [{"delta": {"content": "在这里。"}}]},
            ]),
            headers={"Content-Type": "text/event-stream"},
        )

    reasoning: list[str] = []
    text = "".join(
        _client(handler).stream_messages("chat", [{"role": "user", "content": "hi"}], reasoning_out=reasoning)
    )
    assert text == "正文在这里。"
    assert "".join(reasoning) == "先翻目录，再核设定。"


def test_stream_messages_without_an_accumulator_is_unchanged() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=_sse([
                {"choices": [{"delta": {"reasoning_content": "不必留下"}}]},
                {"choices": [{"delta": {"content": "答案"}}]},
            ]),
            headers={"Content-Type": "text/event-stream"},
        )

    assert "".join(_client(handler).stream_messages("chat", [{"role": "user", "content": "hi"}])) == "答案"


def test_migrations_add_the_reasoning_column(tmp_path, monkeypatch) -> None:
    """models.py has the field; a database built from migrations alone must have it too."""
    from alembic import command
    from alembic.config import Config

    database_path = tmp_path / "reasoning.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setattr(app_db, "DATABASE_URL", database_url)

    command.upgrade(Config("alembic.ini"), "head")

    columns = inspect(create_engine(database_url)).get_columns("chat_message")
    assert "reasoning" in {column["name"] for column in columns}


def test_the_list_endpoint_carries_the_reasoning_too() -> None:
    """The fold has to survive a reload, not only the stream that produced it. This is
    what broke first: the model had the column, the row had the text, and the response
    schema simply never mentioned it, so after a refresh the entry disappeared."""
    row = ChatMessage(
        id=41,
        novel_id=1,
        role="assistant",
        content="沈砚舟。",
        reasoning="资料里的 D 简报写着视角。",
        mode="write",
        model="MiniMax-M2.5",
        created_at=utc_now(),
    )
    out = ChatMessageOut.of(row)
    assert out.reasoning == "资料里的 D 简报写着视角。"
    assert "reasoning" in out.model_dump()
