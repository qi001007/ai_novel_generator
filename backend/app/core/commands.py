"""One mutation pipeline shared by HTTP, Agent tools and Workflow nodes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Literal

from fastapi import HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.core.events import broker
from app.models import Operation

Risk = Literal["low", "high"]


@dataclass
class Mutation:
    result: dict[str, Any]
    novel_id: int | None = None
    target_type: str = ""
    target_id: int | None = None
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    undo_kind: str = "none"
    event: str = "asset.changed"


Handler = Callable[[Session, BaseModel, str], Mutation]
Previewer = Callable[[Session, BaseModel], dict[str, Any]]


@dataclass(frozen=True)
class CommandSpec:
    name: str
    description: str
    input_model: type[BaseModel]
    risk: Risk
    handler: Handler
    previewer: Previewer

    def public(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "risk": self.risk,
            "input_schema": self.input_model.model_json_schema(),
            "supports_preview": True,
            "supports_undo": True,
        }


class CommandRegistry:
    def __init__(self) -> None:
        self._specs: dict[str, CommandSpec] = {}

    def register(self, spec: CommandSpec) -> None:
        if spec.name in self._specs:
            raise RuntimeError(f"duplicate command: {spec.name}")
        self._specs[spec.name] = spec

    def get(self, name: str) -> CommandSpec:
        try:
            return self._specs[name]
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Function not found") from exc

    def list(self) -> list[dict[str, Any]]:
        return [self._specs[name].public() for name in sorted(self._specs)]

    def preview(self, session: Session, name: str, payload: dict[str, Any]) -> dict[str, Any]:
        spec = self.get(name)
        parsed = spec.input_model.model_validate(payload)
        return {
            "command": name,
            "risk": spec.risk,
            "requires_confirmation": spec.risk == "high",
            "diff": spec.previewer(session, parsed),
        }

    def execute(
        self,
        session: Session,
        name: str,
        payload: dict[str, Any],
        *,
        idempotency_key: str,
        actor: str,
        approved: bool,
    ) -> Operation:
        if not idempotency_key.strip():
            raise HTTPException(status_code=422, detail="idempotency_key is required")
        previous = session.exec(
            select(Operation).where(Operation.idempotency_key == idempotency_key)
        ).first()
        if previous is not None:
            return previous

        spec = self.get(name)
        if spec.risk == "high" and not approved:
            raise HTTPException(status_code=409, detail="This command requires confirmation")
        parsed = spec.input_model.model_validate(payload)
        try:
            mutation = spec.handler(session, parsed, actor)
            operation = Operation(
                novel_id=mutation.novel_id,
                command=name,
                idempotency_key=idempotency_key,
                actor=actor,
                risk=spec.risk,
                target_type=mutation.target_type,
                target_id=mutation.target_id,
                before=mutation.before or {},
                after=mutation.after or {},
                result=mutation.result,
                undo_kind=mutation.undo_kind,
            )
            session.add(operation)
            session.commit()
            session.refresh(operation)
        except Exception:
            session.rollback()
            raise
        broker.publish(
            mutation.event,
            mutation.novel_id,
            {"operation_id": operation.id, "target_type": mutation.target_type, "target_id": mutation.target_id},
        )
        return operation


registry = CommandRegistry()
