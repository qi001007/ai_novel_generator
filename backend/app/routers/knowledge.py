"""Read-only view of the new-core knowledge entries, including QA drafts."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.db import get_session
from app.models import KnowledgeEntry, Novel


router = APIRouter(prefix="/novels", tags=["knowledge"])


@router.get("/{novel_id}/knowledge", response_model=list[KnowledgeEntry])
def list_knowledge(
    novel_id: int,
    status: Literal["draft", "approved", "retired"] | None = Query(default=None),
    session: Session = Depends(get_session),
) -> list[KnowledgeEntry]:
    if session.get(Novel, novel_id) is None:
        raise HTTPException(status_code=404, detail="Novel not found")
    statement = select(KnowledgeEntry).where(KnowledgeEntry.novel_id == novel_id)
    if status is not None:
        statement = statement.where(KnowledgeEntry.status == status)
    return list(session.exec(statement.order_by(KnowledgeEntry.id.desc())).all())