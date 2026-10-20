"""Read model for opening a novel workspace in one request."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.db import get_session
from app.models import Document, Fact, KnowledgeEntry, Novel, OutlineNode

router = APIRouter(prefix="/novels", tags=["workspace"])


@router.get("/{novel_id}/workspace")
def workspace(novel_id: int, session: Session = Depends(get_session)) -> dict:
    novel = session.get(Novel, novel_id)
    if novel is None or novel.archived:
        raise HTTPException(status_code=404, detail="Novel not found")
    outlines = session.exec(
        select(OutlineNode).where(OutlineNode.novel_id == novel_id, OutlineNode.status != "retired").order_by(OutlineNode.position)
    ).all()
    documents = session.exec(
        select(Document).where(Document.novel_id == novel_id, Document.status != "retired").order_by(Document.path)
    ).all()
    knowledge = session.exec(
        select(KnowledgeEntry).where(KnowledgeEntry.novel_id == novel_id, KnowledgeEntry.status != "retired").order_by(KnowledgeEntry.kind, KnowledgeEntry.name)
    ).all()
    facts = session.exec(
        select(Fact).where(Fact.novel_id == novel_id, Fact.status != "retired").order_by(Fact.id)
    ).all()
    return {
        "novel": novel.model_dump(mode="json"),
        "outline": [item.model_dump(mode="json") for item in outlines],
        "documents": [item.model_dump(mode="json") for item in documents],
        "knowledge": [item.model_dump(mode="json") for item in knowledge],
        "facts": [item.model_dump(mode="json") for item in facts],
    }
