"""HTTP adapter for the canonical application function catalogue."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import Session

from app.application.functions import undo_operation
from app.core.commands import registry
from app.db import get_session
from app.models import Operation

router = APIRouter(tags=["functions"])


class PreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    payload: dict[str, Any] = Field(default_factory=dict)


class ExecuteRequest(PreviewRequest):
    idempotency_key: str = Field(min_length=1, max_length=200)
    actor: str = Field(default="user", min_length=1, max_length=100)
    approved: bool = False


@router.get("/functions")
def list_functions() -> list[dict[str, Any]]:
    return registry.list()


@router.post("/commands/{name}/preview")
def preview_command(
    name: str,
    body: PreviewRequest,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    return registry.preview(session, name, body.payload)


@router.post("/commands/{name}/execute")
def execute_command(
    name: str,
    body: ExecuteRequest,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    operation = registry.execute(
        session,
        name,
        body.payload,
        idempotency_key=body.idempotency_key,
        actor=body.actor,
        approved=body.approved,
    )
    return operation.model_dump(mode="json")


@router.post("/operations/{operation_id}/undo")
def undo(
    operation_id: int,
    actor: str = "user",
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    operation = session.get(Operation, operation_id)
    if operation is None:
        raise HTTPException(status_code=404, detail="Operation not found")
    return undo_operation(session, operation, actor)
