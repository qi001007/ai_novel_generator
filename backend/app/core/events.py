"""Small in-process event stream for the single-user local runtime."""

from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any

from app.models import utc_now


@dataclass(frozen=True)
class DomainEvent:
    name: str
    novel_id: int | None
    payload: dict[str, Any]
    occurred_at: datetime

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["occurred_at"] = self.occurred_at.isoformat()
        return value


class EventBroker:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[DomainEvent]] = set()

    def publish(self, name: str, novel_id: int | None, payload: dict[str, Any]) -> None:
        event = DomainEvent(name=name, novel_id=novel_id, payload=payload, occurred_at=utc_now())
        for queue in tuple(self._subscribers):
            if not queue.full():
                queue.put_nowait(event)

    def subscribe(self) -> asyncio.Queue[DomainEvent]:
        queue: asyncio.Queue[DomainEvent] = asyncio.Queue(maxsize=100)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[DomainEvent]) -> None:
        self._subscribers.discard(queue)


broker = EventBroker()
