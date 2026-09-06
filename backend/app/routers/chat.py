import json
from collections.abc import Callable, Iterator
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Field, Session, SQLModel, select
from sqlalchemy.engine import Engine

from app.db import get_session
from app.models import ChatMessage
from app.routers.planning import get_novel_or_404
from app.services.chat import (
    ChatDomainError,
    ChatTurn,
    complete_turn,
    current_conversation,
    extract_proposals,
    next_conversation,
    prepare_turn,
    stream_turn,
)
from app.services.agent import AgentConfig, ToolRegistry
from app.services.agent_tools import build_registry
from app.services.context import collect_items
from app.services.documents import current_text_reader
from app.services.llm import LLMClient, get_llm_client


router = APIRouter(prefix="/novels", tags=["chat"])

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    # Dev/prod proxies tend to buffer SSE bodies unless told otherwise.
    "X-Accel-Buffering": "no",
}


class ChatAttachment(SQLModel):
    """A text file the owner attached to one message.

    The bytes never outlive the request: nothing is stored on the server, and the
    content is injected as a context block for that turn only. `prepare_turn` re-checks
    every limit, so this model is a shape, not a permission.
    """

    name: str
    text: str


class ChatCreate(SQLModel):
    content: str
    mode: str = "write"
    chapter_id: int | None = None
    model: str | None = None
    attachments: list[ChatAttachment] = Field(default_factory=list)


class ChatContextItem(SQLModel):
    kind: str
    label: str
    ref: str
    mention: str = ""


class ChatProposalOut(SQLModel):
    # A fenced write the agent offered. History keeps carrying it so a
    # reload cannot silently drop a review card that was never applied.
    path: str
    text: str
    valid: bool
    error: str = ""


_MESSAGE_FIELDS = (
    "id", "novel_id", "conversation_id", "role", "content", "reasoning", "mode", "model", "mentions",
    "context_refs", "token_input", "token_output", "created_at",
)


class ChatMessageOut(SQLModel):
    id: int
    novel_id: int
    conversation_id: int = 1
    role: str
    content: str
    # Out of the list endpoint too: the fold has to survive a reload, not only the
    # stream that produced it (第十六批批注 1).
    reasoning: str = ""
    mode: str
    model: str
    mentions: list[str] = Field(default_factory=list)
    context_refs: list[dict[str, Any]] = Field(default_factory=list)
    token_input: int = 0
    token_output: int = 0
    created_at: datetime
    proposals: list[ChatProposalOut] = Field(default_factory=list)

    @classmethod
    def of(cls, row: ChatMessage, current=None) -> "ChatMessageOut":
        data = {name: getattr(row, name) for name in _MESSAGE_FIELDS}
        data["proposals"] = extract_proposals(row.content, current)
        return cls(**data)


def _to_http(cause: ChatDomainError) -> HTTPException:
    return HTTPException(status_code=cause.status_code, detail=cause.detail)


def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _event_stream(
    llm: LLMClient,
    turn: ChatTurn,
    session_factory: Callable[[], Session],
    registry: ToolRegistry | None = None,
    config: AgentConfig | None = None,
) -> Iterator[str]:
    # The request-scoped session is already closed by the time this runs,
    # so the generator owns a session of its own for persisting the reply.
    try:
        for event, payload in stream_turn(llm, turn, session_factory, registry=registry, config=config):
            yield _sse(event, payload)
    except ChatDomainError as cause:
        yield _sse("error", {"message": cause.detail, "partial": ""})
    except Exception as cause:  # keep the stream well-formed for the client
        yield _sse("error", {"message": f"chat stream failed: {cause}", "partial": ""})
    yield _sse("end", {})


@router.get("/{novel_id}/chat/messages", response_model=list[ChatMessageOut])
def list_chat_messages(
    novel_id: int,
    limit: int = 200,
    conversation: int | None = None,
    session: Session = Depends(get_session),
) -> list[ChatMessageOut]:
    get_novel_or_404(novel_id, session)
    thread = conversation or current_conversation(session, novel_id)
    rows = list(
        session.exec(
            select(ChatMessage)
            .where(ChatMessage.novel_id == novel_id)
            .where(ChatMessage.conversation_id == thread)
            .order_by(ChatMessage.created_at, ChatMessage.id)
        ).all()
    )
    reader = current_text_reader(session, novel_id)
    return [ChatMessageOut.of(row, reader) for row in rows[-max(limit, 1):]]


@router.get("/{novel_id}/chat/context", response_model=list[ChatContextItem])
def list_chat_context(
    novel_id: int,
    q: str = "",
    kind: str = "",
    limit: int = 40,
    session: Session = Depends(get_session),
) -> list[ChatContextItem]:
    """Reference candidates for the @mention list and the attachment picker."""
    get_novel_or_404(novel_id, session)
    needle = q.strip().lower()
    matches: list[ChatContextItem] = []
    for item in collect_items(session, novel_id):
        if kind and item.kind != kind:
            continue
        if needle and needle not in item.label.lower() and needle not in item.text.lower():
            continue
        matches.append(
            ChatContextItem(
                kind=item.kind,
                label=item.label,
                ref=item.ref,
                mention=item.mention,
            )
        )
        if len(matches) >= max(limit, 1):
            break
    return matches


@router.post("/{novel_id}/chat", response_model=ChatMessage, status_code=201)
def create_chat_reply(
    novel_id: int,
    payload: ChatCreate,
    session: Session = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
) -> ChatMessage:
    novel = get_novel_or_404(novel_id, session)
    bind: Engine = session.get_bind()
    registry = build_registry(lambda: Session(bind), novel_id)
    try:
        turn = prepare_turn(
            session,
            novel,
            content=payload.content,
            mode=payload.mode,
            chapter_id=payload.chapter_id,
            model=payload.model,
            allowed_models=llm.settings.configured_models,
            attachments=[item.model_dump() for item in payload.attachments],
        )
        return complete_turn(session, llm, turn, registry=registry)
    except ChatDomainError as cause:
        raise _to_http(cause) from cause


@router.post("/{novel_id}/chat/stream")
def stream_chat_reply(
    novel_id: int,
    payload: ChatCreate,
    session: Session = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
) -> StreamingResponse:
    novel = get_novel_or_404(novel_id, session)
    bind: Engine = session.get_bind()
    # Tools open their own sessions: a tool result can land after the request
    # session that resolved the turn has already gone.
    registry = build_registry(lambda: Session(bind), novel_id)
    try:
        turn = prepare_turn(
            session,
            novel,
            content=payload.content,
            mode=payload.mode,
            chapter_id=payload.chapter_id,
            model=payload.model,
            allowed_models=llm.settings.configured_models,
            attachments=[item.model_dump() for item in payload.attachments],
        )
    except ChatDomainError as cause:
        raise _to_http(cause) from cause

    return StreamingResponse(
        _event_stream(llm, turn, lambda: Session(bind), registry=registry),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@router.post("/{novel_id}/chat/conversation", response_model=dict)
def start_chat_conversation(novel_id: int, session: Session = Depends(get_session)) -> dict:
    """「新建对话」: close the current thread and open the next one.

    Only a config row moves: the old messages stay exactly where they are, so the
    snapshot and the 会话 page can still reach them.
    """
    get_novel_or_404(novel_id, session)
    return {"conversation_id": next_conversation(session, novel_id)}


@router.delete("/{novel_id}/chat/messages", status_code=204)
def clear_chat_messages(
    novel_id: int,
    session: Session = Depends(get_session),
) -> None:
    get_novel_or_404(novel_id, session)
    for row in session.exec(
        select(ChatMessage).where(ChatMessage.novel_id == novel_id)
    ).all():
        session.delete(row)
    session.commit()
    return None
