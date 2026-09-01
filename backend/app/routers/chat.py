import json
from collections.abc import Callable, Iterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, SQLModel, select
from sqlalchemy.engine import Engine

from app.db import get_session
from app.models import ChatMessage
from app.routers.planning import get_novel_or_404
from app.services.chat import (
    ChatDomainError,
    ChatTurn,
    complete_turn,
    prepare_turn,
    stream_turn,
)
from app.services.context import collect_items
from app.services.llm import LLMClient, get_llm_client


router = APIRouter(prefix="/novels", tags=["chat"])

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    # Dev/prod proxies tend to buffer SSE bodies unless told otherwise.
    "X-Accel-Buffering": "no",
}


class ChatCreate(SQLModel):
    content: str
    mode: str = "write"
    chapter_id: int | None = None
    model: str | None = None


class ChatContextItem(SQLModel):
    kind: str
    label: str
    ref: str
    mention: str = ""


def _to_http(cause: ChatDomainError) -> HTTPException:
    return HTTPException(status_code=cause.status_code, detail=cause.detail)


def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _event_stream(
    llm: LLMClient,
    turn: ChatTurn,
    session_factory: Callable[[], Session],
) -> Iterator[str]:
    # The request-scoped session is already closed by the time this runs,
    # so the generator owns a session of its own for persisting the reply.
    try:
        for event, payload in stream_turn(llm, turn, session_factory):
            yield _sse(event, payload)
    except ChatDomainError as cause:
        yield _sse("error", {"message": cause.detail, "partial": ""})
    except Exception as cause:  # keep the stream well-formed for the client
        yield _sse("error", {"message": f"chat stream failed: {cause}", "partial": ""})
    yield _sse("end", {})


@router.get("/{novel_id}/chat/messages", response_model=list[ChatMessage])
def list_chat_messages(
    novel_id: int,
    limit: int = 200,
    session: Session = Depends(get_session),
) -> list[ChatMessage]:
    get_novel_or_404(novel_id, session)
    rows = list(
        session.exec(
            select(ChatMessage)
            .where(ChatMessage.novel_id == novel_id)
            .order_by(ChatMessage.created_at, ChatMessage.id)
        ).all()
    )
    return rows[-max(limit, 1):]


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
    try:
        turn = prepare_turn(
            session,
            novel,
            content=payload.content,
            mode=payload.mode,
            chapter_id=payload.chapter_id,
            model=payload.model,
            allowed_models=llm.settings.configured_models,
        )
        return complete_turn(session, llm, turn)
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
    try:
        turn = prepare_turn(
            session,
            novel,
            content=payload.content,
            mode=payload.mode,
            chapter_id=payload.chapter_id,
            model=payload.model,
            allowed_models=llm.settings.configured_models,
        )
    except ChatDomainError as cause:
        raise _to_http(cause) from cause

    return StreamingResponse(
        _event_stream(llm, turn, lambda: Session(bind)),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


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
