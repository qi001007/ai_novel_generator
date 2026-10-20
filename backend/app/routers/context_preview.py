"""Preview the exact context selection before a model call."""

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import Session

from app.db import get_session
from app.services.context_planner import build_context_preview

router = APIRouter(prefix="/context", tags=["context"])


class ContextPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    novel_id: int = Field(ge=1)
    task_type: Literal["discuss", "plan", "generate", "review", "research"]
    outline_node_id: int | None = Field(default=None, ge=1)
    query: str = Field(default="", max_length=20000)
    token_budget: int = Field(default=8000, ge=100, le=1_000_000)


@router.post("/preview")
def preview_context(body: ContextPreviewRequest, session: Session = Depends(get_session)) -> dict:
    return build_context_preview(session, **body.model_dump())
