from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from app.db import get_session
from app.models import PlotFeedback, utc_now
from app.routers.planning import get_novel_or_404


router = APIRouter(prefix="/novels", tags=["feedback"])


class PlotFeedbackCreate(SQLModel):
    content: str
    impact_levels: list[str] = []
    suggestions: dict = {}


class PlotFeedbackUpdate(SQLModel):
    impact_levels: list[str] | None = None
    suggestions: dict | None = None
    status: str | None = None


@router.get("/{novel_id}/feedback", response_model=list[PlotFeedback])
def list_feedback(
    novel_id: int,
    session: Session = Depends(get_session),
) -> list[PlotFeedback]:
    get_novel_or_404(novel_id, session)
    return list(
        session.exec(
            select(PlotFeedback)
            .where(PlotFeedback.novel_id == novel_id)
            .order_by(PlotFeedback.created_at)
        ).all()
    )


@router.post("/{novel_id}/feedback", response_model=PlotFeedback, status_code=201)
def create_feedback(
    novel_id: int,
    payload: PlotFeedbackCreate,
    session: Session = Depends(get_session),
) -> PlotFeedback:
    get_novel_or_404(novel_id, session)
    feedback = PlotFeedback(novel_id=novel_id, **payload.model_dump())
    session.add(feedback)
    session.commit()
    session.refresh(feedback)
    return feedback


@router.put("/{novel_id}/feedback/{feedback_id}", response_model=PlotFeedback)
def update_feedback(
    novel_id: int,
    feedback_id: int,
    payload: PlotFeedbackUpdate,
    session: Session = Depends(get_session),
) -> PlotFeedback:
    get_novel_or_404(novel_id, session)
    feedback = session.get(PlotFeedback, feedback_id)
    if feedback is None or feedback.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Plot feedback not found")

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(feedback, field, value)
    if data.get("status") == "applied":
        feedback.applied_at = utc_now()

    session.add(feedback)
    session.commit()
    session.refresh(feedback)
    return feedback
