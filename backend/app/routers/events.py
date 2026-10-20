"""SSE stream of committed domain changes."""

import asyncio
from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app import sse
from app.core.events import broker

router = APIRouter(tags=["events"])


@router.get("/events")
def events(novel_id: int | None = None) -> StreamingResponse:
    async def stream() -> AsyncIterator[str]:
        queue = broker.subscribe()
        try:
            yield sse.encode("connected", {"novel_id": novel_id})
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    yield sse.encode("heartbeat", {})
                    continue
                if novel_id is None or event.novel_id in {None, novel_id}:
                    yield sse.encode(event.name, event.to_dict())
        finally:
            broker.unsubscribe(queue)

    return StreamingResponse(stream(), media_type="text/event-stream", headers=sse.HEADERS)
