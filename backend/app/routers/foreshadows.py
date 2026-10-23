"""Read-only list of foreshadow rows for the wall view."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.db import get_session
from app.models import Foreshadow, Novel


router = APIRouter(prefix="/novels", tags=["foreshadows"])


@router.get("/{novel_id}/foreshadows", response_model=list[Foreshadow])
def list_foreshadows(
    novel_id: int,
    session: Session = Depends(get_session),
) -> list[Foreshadow]:
    if session.get(Novel, novel_id) is None:
        raise HTTPException(status_code=404, detail="Novel not found")
    return list(
        session.exec(
            select(Foreshadow)
            .where(Foreshadow.novel_id == novel_id)
            .order_by(Foreshadow.planted_chapter, Foreshadow.id)
        ).all()
    )